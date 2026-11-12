// Declarative records. Each product describes its resources (fields, computed values, views, hooks)
// and gets storage, validation, CRUD, search, sorting and paging for free.
import { HttpError, nowISO, parseFlexibleDate, parseMoney, parseNumber, parseBool, isEmail } from './util.js';

const SQL_TYPE = {
  text: 'TEXT', textarea: 'TEXT', markdown: 'TEXT', email: 'TEXT', url: 'TEXT', phone: 'TEXT', select: 'TEXT',
  multiselect: 'TEXT', date: 'TEXT', refs: 'TEXT', number: 'REAL', money: 'REAL', percent: 'REAL', int: 'INTEGER', bool: 'INTEGER', ref: 'INTEGER',
};
export const isBlank = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);

function toArray(raw) {
  if (Array.isArray(raw)) return raw.filter((x) => !isBlank(x));
  if (isBlank(raw)) return [];
  const s = String(raw).trim();
  if (s.startsWith('[')) {
    try {
      const a = JSON.parse(s);
      if (Array.isArray(a)) return a.filter((x) => !isBlank(x));
    } catch { /* not JSON */ }
  }
  return s.split(/[;|]|,(?!\s*\d{3})/).map((x) => x.trim()).filter(Boolean);
}

function cmp(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' || typeof b === 'boolean') return (a ? 1 : 0) - (b ? 1 : 0);
  return String(a).localeCompare(String(b), 'en-GB', { numeric: true, sensitivity: 'base' });
}

export function createResources({ db, definition }) {
  const all = definition.resources || [];
  const byName = new Map();
  for (const r of all) {
    r.table = `r_${r.name}`;
    r.singular ||= r.label.replace(/s$/, '');
    r.titleField ||= r.fields[0].key;
    r.computedFields ||= [];
    for (const f of r.fields) {
      f.type ||= 'text';
      f.label ||= f.key;
    }
    r.fieldMap = new Map(r.fields.map((f) => [f.key, f]));
    r.colMap = new Map([...r.fields, ...r.computedFields].map((f) => [f.key, f]));
    byName.set(r.name, r);
  }
  for (const r of all) {
    db.exec(`CREATE TABLE IF NOT EXISTS "${r.table}" (id INTEGER PRIMARY KEY, org_id INTEGER NOT NULL REFERENCES orgs(id) ON DELETE CASCADE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, created_by INTEGER, is_sample INTEGER NOT NULL DEFAULT 0)`);
    db.exec(`CREATE INDEX IF NOT EXISTS "idx_${r.table}_org" ON "${r.table}"(org_id)`);
    db.ensureColumns(r.table, r.fields.map((f) => [f.key, SQL_TYPE[f.type] || 'TEXT']));
    for (const f of r.fields) if (f.type === 'ref') db.exec(`CREATE INDEX IF NOT EXISTS "idx_${r.table}_${f.key}" ON "${r.table}"(org_id, "${f.key}")`);
  }

  const get = (name) => {
    const r = byName.get(name);
    if (!r) throw new HttpError(404, 'Page not found');
    return r;
  };

  function decode(r, row) {
    if (!row) return null;
    for (const f of r.fields) {
      const v = row[f.key];
      if (f.type === 'bool') row[f.key] = Boolean(v);
      else if (f.type === 'refs' || f.type === 'multiselect') {
        let a = [];
        if (typeof v === 'string' && v) {
          try { a = JSON.parse(v); } catch { a = []; }
        }
        row[f.key] = Array.isArray(a) ? a : [];
      }
    }
    row.is_sample = Boolean(row.is_sample);
    return row;
  }
  const encode = (f, v) => (v === undefined ? null : f.type === 'bool' ? (v ? 1 : 0) : Array.isArray(v) ? JSON.stringify(v) : v);

  const rows = (orgId, r, where = '', ...params) =>
    db.all(`SELECT * FROM "${r.table}" WHERE org_id = ?${where ? ` AND (${where})` : ''} ORDER BY id`, orgId, ...params).map((x) => decode(r, x));
  const one = (orgId, r, id) => decode(r, db.get(`SELECT * FROM "${r.table}" WHERE org_id = ? AND id = ?`, orgId, Number(id)));
  const options = (f, ctx) => (typeof f.options === 'function' ? f.options(ctx) : f.options || []);
  const invalidate = (ctx, r) => {
    if (ctx.cache) for (const k of Object.keys(ctx.cache)) if (k === `labels:${r.name}` || k.startsWith(`${r.name}:`) || k.startsWith('rel:')) delete ctx.cache[k];
  };

  function labelMap(ctx, refName) {
    ctx.cache ||= {};
    const key = `labels:${refName}`;
    if (!ctx.cache[key]) {
      const rr = get(refName);
      const m = new Map();
      ctx.cache[key] = m;
      if (rr.rowLabel) for (const row of computeRows(ctx, rr, rows(ctx.org.id, rr))) m.set(row.id, row.__title);
      else for (const x of db.all(`SELECT id, "${rr.titleField}" AS t FROM "${rr.table}" WHERE org_id = ?`, ctx.org.id)) m.set(x.id, x.t || `#${x.id}`);
    }
    return ctx.cache[key];
  }

  function computeRows(ctx, r, list) {
    r.prepare?.(list, ctx);
    for (const row of list) {
      for (const f of r.fields) {
        if (f.type === 'ref' && row[f.key] != null) row[`${f.key}__label`] = labelMap(ctx, f.ref).get(row[f.key]) ?? `#${row[f.key]}`;
        if (f.type === 'refs') row[`${f.key}__labels`] = (row[f.key] || []).map((id) => labelMap(ctx, f.ref).get(id) ?? `#${id}`);
      }
      if (r.compute) Object.assign(row, r.compute(row, ctx) || {});
      row.__title = r.rowLabel ? r.rowLabel(row, ctx) : row[r.titleField] || `${r.singular} #${row.id}`;
    }
    return list;
  }

  function query(ctx, r, { q = '', filters = {}, view = '', sort = '', dir = '', page = 1, pageSize = 50, all: everything = false, where = '', params = [] } = {}) {
    let list = computeRows(ctx, r, rows(ctx.org.id, r, where, ...params));
    const v = (r.views || []).find((x) => x.id === view);
    if (v?.filter) list = list.filter((row) => v.filter(row, ctx));
    for (const [k, val] of Object.entries(filters || {})) {
      const f = r.colMap.get(k);
      if (!f || isBlank(val)) continue;
      list = list.filter((row) => {
        const x = row[k];
        if (Array.isArray(x)) return x.map(String).includes(String(val));
        if (f.type === 'bool') return Boolean(x) === (parseBool(val) === true);
        return String(x ?? '') === String(val);
      });
    }
    if (!isBlank(q)) {
      const needle = String(q).toLowerCase().trim();
      const keys = r.fields.filter((f) => f.search || f.key === r.titleField).map((f) => (f.type === 'ref' ? `${f.key}__label` : f.key));
      list = list.filter((row) => [row.__title, ...keys.map((k) => row[k])].some((x) => String(x ?? '').toLowerCase().includes(needle)));
    }
    const sortKey = r.colMap.has(sort) ? sort : r.defaultSort?.key || r.titleField;
    const sortDir = (dir || (sort ? 'asc' : r.defaultSort?.dir) || 'asc') === 'desc' ? -1 : 1;
    const sf = r.colMap.get(sortKey);
    const val = (row) => (sf?.type === 'ref' ? row[`${sortKey}__label`] : row[sortKey]);
    list.sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      const ea = isBlank(va);
      const eb = isBlank(vb);
      if (ea || eb) return ea && eb ? a.id - b.id : ea ? 1 : -1;
      return cmp(va, vb) * sortDir || a.id - b.id;
    });
    const total = list.length;
    const meta = { total, sort: sortKey, dir: sortDir < 0 ? 'desc' : 'asc' };
    if (everything) return { rows: list, page: 1, pages: 1, pageSize: total, ...meta };
    const size = Math.min(Math.max(Number(pageSize) || 50, 1), 500);
    const pages = Math.max(1, Math.ceil(total / size));
    const p = Math.min(Math.max(1, Math.floor(Number(page)) || 1), pages);
    return { rows: list.slice((p - 1) * size, p * size), page: p, pages, pageSize: size, ...meta };
  }

  function find(ctx, r, id) {
    const row = one(ctx.org.id, r, id);
    if (!row) throw new HttpError(404, `${r.singular} not found`);
    return computeRows(ctx, r, [row])[0];
  }

  function refId(ctx, f, raw) {
    const rr = get(f.ref);
    const s = String(raw).trim();
    let id = /^\d+$/.test(s) ? Number(s) : null;
    if (id !== null && !db.get(`SELECT id FROM "${rr.table}" WHERE org_id = ? AND id = ?`, ctx.org.id, id)) id = null;
    if (id === null) {
      const needle = s.toLowerCase();
      const hits = [...labelMap(ctx, f.ref)].filter(([, label]) => String(label).toLowerCase() === needle);
      if (hits.length > 1) throw new Error(`More than one ${rr.singular.toLowerCase()} is called “${s}”. Rename one of them, or use the ID.`);
      if (hits.length === 1) id = hits[0][0];
    }
    if (id === null) throw new Error(`Choose a valid ${rr.singular.toLowerCase()}.`);
    return id;
  }

  function coerce(ctx, f, raw) {
    const blank = isBlank(raw);
    switch (f.type) {
      case 'bool': {
        if (blank) return false;
        const b = parseBool(raw);
        if (b === null) throw new Error('Choose yes or no.');
        return b;
      }
      case 'number':
      case 'percent':
      case 'int': {
        if (blank) return null;
        const n = parseNumber(raw);
        if (n === undefined || n === null || !Number.isFinite(n)) throw new Error('Enter a number.');
        if (f.type === 'int' && !Number.isInteger(n)) throw new Error('Enter a whole number.');
        if (f.min !== undefined && n < f.min) throw new Error(`Enter ${f.min} or more.`);
        if (f.max !== undefined && n > f.max) throw new Error(`Enter ${f.max} or less.`);
        return n;
      }
      case 'money': {
        if (blank) return null;
        const n = parseMoney(raw);
        if (n === undefined || n === null) throw new Error('Enter an amount, like 1250.00.');
        if (f.min !== undefined && n < f.min) throw new Error(`Enter at least £${f.min}.`);
        if (f.max !== undefined && n > f.max) throw new Error(`Enter £${f.max} or less.`);
        return n;
      }
      case 'date': {
        if (blank) return null;
        const d = parseFlexibleDate(raw);
        if (!d) throw new Error('Enter a real date, like 31/01/2026.');
        return d;
      }
      case 'email': {
        if (blank) return null;
        const s = String(raw).trim().toLowerCase();
        if (!isEmail(s)) throw new Error('Enter a valid email address.');
        return s;
      }
      case 'url': {
        if (blank) return null;
        const s = String(raw).trim();
        if (!/^https?:\/\/\S+$/i.test(s) || s.length > 500) throw new Error('Enter a full link starting with https://');
        return s;
      }
      case 'phone': {
        if (blank) return null;
        const s = String(raw).trim();
        if (!/^[0-9+()\-.\s]{5,40}$/.test(s)) throw new Error('Enter a valid phone number.');
        return s;
      }
      case 'select': {
        if (blank) return null;
        const s = String(raw).trim().toLowerCase();
        const match = options(f, ctx).find((o) => String(o).toLowerCase() === s);
        if (match === undefined) throw new Error(`Choose one of: ${options(f, ctx).join(', ')}.`);
        return match;
      }
      case 'multiselect': {
        const out = [];
        for (const item of toArray(raw)) {
          const match = options(f, ctx).find((o) => String(o).toLowerCase() === String(item).trim().toLowerCase());
          if (match === undefined) throw new Error(`“${item}” is not an option.`);
          if (!out.includes(match)) out.push(match);
        }
        return out;
      }
      case 'ref':
        return blank ? null : refId(ctx, f, raw);
      case 'refs':
        return [...new Set(toArray(raw).map((x) => refId(ctx, f, x)))];
      case 'textarea':
      case 'markdown': {
        if (blank) return null;
        const s = String(raw).replace(/\r\n?/g, '\n').trim();
        if (s.length > (f.max || 50000)) throw new Error(`Keep this under ${f.max || 50000} characters.`);
        return s;
      }
      default: {
        if (blank) return null;
        const s = String(raw).trim().replace(/\s+/g, ' ');
        if (s.length > (f.max || 200)) throw new Error(`Keep this under ${f.max || 200} characters.`);
        return s;
      }
    }
  }

  /** create: absent fields take defaults. update (partial): absent fields stay unchanged. */
  function validate(ctx, r, input, { partial = false, existing = null } = {}) {
    const values = {};
    const errors = {};
    for (const f of r.fields) {
      if (f.readonly) continue;
      const present = Object.prototype.hasOwnProperty.call(input, f.key);
      if (partial && !present) continue;
      let raw = present ? input[f.key] : undefined;
      if (!present && f.default !== undefined) raw = typeof f.default === 'function' ? f.default(ctx) : f.default;
      try {
        const v = coerce(ctx, f, raw);
        if (f.required && isBlank(v)) throw new Error(f.requiredMessage || `${f.label} is required.`);
        values[f.key] = v;
      } catch (err) {
        errors[f.key] = err.message;
      }
    }
    if (!Object.keys(errors).length && r.check) Object.assign(errors, r.check({ ...(existing || {}), ...values }, ctx, existing) || {});
    if (Object.keys(errors).length) throw new HttpError(422, 'Please check the highlighted fields.', { fieldErrors: errors });
    return values;
  }

  function checkLimit(ctx, r) {
    const billing = ctx.services?.billing;
    if (!r.limitKey || !billing) return;
    const max = billing.limit(ctx.org, r.limitKey);
    if (!Number.isFinite(max)) return;
    const n = db.get(`SELECT COUNT(*) AS n FROM "${r.table}" WHERE org_id = ? AND is_sample = 0`, ctx.org.id).n;
    if (n >= max) throw new HttpError(402, `Your plan includes up to ${max} ${r.label.toLowerCase()}. Upgrade in Billing to add more.`);
  }

  const titleOf = (ctx, r, row) => (r.rowLabel ? computeRows(ctx, r, [{ ...row }])[0].__title : row[r.titleField] || `#${row.id}`);

  function create(ctx, r, input, { sample = false, quiet = false } = {}) {
    const values = validate(ctx, r, input, {});
    return db.tx(() => {
      if (!sample) checkLimit(ctx, r);
      const prepared = r.beforeSave?.(values, { ctx, existing: null, api }) || values;
      const keys = Object.keys(prepared).filter((k) => r.fieldMap.has(k));
      const now = nowISO();
      const res = db.run(
        `INSERT INTO "${r.table}" (org_id, created_at, updated_at, created_by, is_sample${keys.map((k) => `, "${k}"`).join('')}) VALUES (?, ?, ?, ?, ?${keys.map(() => ', ?').join('')})`,
        ctx.org.id, now, now, ctx.user?.id ?? null, sample ? 1 : 0, ...keys.map((k) => encode(r.fieldMap.get(k), prepared[k])),
      );
      invalidate(ctx, r);
      const row = one(ctx.org.id, r, res.lastInsertRowid);
      r.afterSave?.(row, { ctx, created: true, before: null, api });
      if (!quiet) ctx.audit?.('create', r.name, row.id, `${r.singular} “${titleOf(ctx, r, row)}” added`);
      return one(ctx.org.id, r, row.id);
    });
  }

  function update(ctx, r, id, input, { quiet = false } = {}) {
    const existing = one(ctx.org.id, r, id);
    if (!existing) throw new HttpError(404, `${r.singular} not found`);
    const values = validate(ctx, r, input, { partial: true, existing });
    return db.tx(() => {
      const prepared = r.beforeSave?.(values, { ctx, existing, api }) || values;
      const keys = Object.keys(prepared).filter((k) => r.fieldMap.has(k));
      db.run(
        `UPDATE "${r.table}" SET updated_at = ?${keys.map((k) => `, "${k}" = ?`).join('')} WHERE org_id = ? AND id = ?`,
        nowISO(), ...keys.map((k) => encode(r.fieldMap.get(k), prepared[k])), ctx.org.id, existing.id,
      );
      invalidate(ctx, r);
      const row = one(ctx.org.id, r, existing.id);
      r.afterSave?.(row, { ctx, created: false, before: existing, api });
      if (!quiet) ctx.audit?.('update', r.name, row.id, `${r.singular} “${titleOf(ctx, r, row)}” updated`);
      return one(ctx.org.id, r, existing.id);
    });
  }

  /** System update without validation or hooks, for derived fields (for example an invoice's paid date). */
  function patch(ctx, r, id, values) {
    const keys = Object.keys(values).filter((k) => r.fieldMap.has(k));
    if (!keys.length) return;
    db.run(`UPDATE "${r.table}" SET updated_at = ?${keys.map((k) => `, "${k}" = ?`).join('')} WHERE org_id = ? AND id = ?`,
      nowISO(), ...keys.map((k) => encode(r.fieldMap.get(k), values[k])), ctx.org.id, Number(id));
    invalidate(ctx, r);
  }

  function remove(ctx, r, id, { quiet = false } = {}) {
    const existing = one(ctx.org.id, r, id);
    if (!existing) throw new HttpError(404, `${r.singular} not found`);
    return db.tx(() => {
      for (const other of all) {
        for (const f of other.fields) {
          if (f.ref !== r.name) continue;
          if (f.type === 'ref') {
            const kids = db.all(`SELECT id FROM "${other.table}" WHERE org_id = ? AND "${f.key}" = ?`, ctx.org.id, existing.id);
            if (!kids.length) continue;
            const mode = f.onDelete || 'restrict';
            if (mode === 'restrict') {
              const n = kids.length;
              throw new HttpError(409, `This ${r.singular.toLowerCase()} is linked to ${n} ${n === 1 ? other.singular.toLowerCase() : other.label.toLowerCase()}. Delete or move ${n === 1 ? 'it' : 'them'} first.`);
            }
            if (mode === 'cascade') for (const k of kids) remove(ctx, other, k.id, { quiet });
            if (mode === 'null') db.run(`UPDATE "${other.table}" SET "${f.key}" = NULL WHERE org_id = ? AND "${f.key}" = ?`, ctx.org.id, existing.id);
          } else if (f.type === 'refs') {
            for (const x of db.all(`SELECT id, "${f.key}" AS v FROM "${other.table}" WHERE org_id = ? AND "${f.key}" IS NOT NULL`, ctx.org.id)) {
              let arr = [];
              try { arr = JSON.parse(x.v) || []; } catch { arr = []; }
              if (arr.includes(existing.id)) db.run(`UPDATE "${other.table}" SET "${f.key}" = ? WHERE id = ?`, JSON.stringify(arr.filter((v) => v !== existing.id)), x.id);
            }
          }
        }
      }
      ctx.services?.files?.removeFor(ctx.org.id, r.name, existing.id);
      const label = quiet ? '' : titleOf(ctx, r, existing);
      db.run(`DELETE FROM "${r.table}" WHERE org_id = ? AND id = ?`, ctx.org.id, existing.id);
      invalidate(ctx, r);
      r.afterDelete?.(existing, { ctx, api });
      if (!quiet) ctx.audit?.('delete', r.name, existing.id, `${r.singular} “${label}” deleted`);
      return existing;
    });
  }

  function sampleCount(orgId) {
    return all.reduce((n, r) => n + db.get(`SELECT COUNT(*) AS n FROM "${r.table}" WHERE org_id = ? AND is_sample = 1`, orgId).n, 0);
  }

  /**
   * Deletes the SAMPLE records through remove(), so anything the user logged against them (a payment or a chase entry on a sample
   * invoice) goes too instead of being left pointing at nothing. A sample record that the user's own records still need, such as a
   * sample customer with a real invoice, is kept and becomes an ordinary record. Returns { removed, kept }.
   */
  function removeSamples(ctx) {
    return db.tx(() => {
      let removed = 0;
      let kept = 0;
      for (const r of [...all].reverse()) {
        for (const row of db.all(`SELECT id FROM "${r.table}" WHERE org_id = ? AND is_sample = 1`, ctx.org.id)) {
          if (!one(ctx.org.id, r, row.id)) continue;
          db.exec('SAVEPOINT sample_row');
          try {
            remove(ctx, r, row.id, { quiet: true });
            db.exec('RELEASE sample_row');
            removed++;
          } catch (err) {
            db.exec('ROLLBACK TO sample_row');
            db.exec('RELEASE sample_row');
            if (!(err instanceof HttpError && err.status === 409)) throw err;
            db.run(`UPDATE "${r.table}" SET is_sample = 0 WHERE org_id = ? AND id = ?`, ctx.org.id, row.id);
            kept++;
          }
        }
        invalidate(ctx, r);
      }
      ctx.audit?.('delete', null, null, `Removed ${removed} sample records${kept ? `, kept ${kept} that your own records use` : ''}`);
      return { removed, kept };
    });
  }

  const api = {
    all, get, has: (n) => byName.has(n), rows, one, find, query, computeRows, labelMap, options, coerce, validate,
    create, update, patch, remove, sampleCount, removeSamples, titleOf, encode, decode, isBlank,
  };
  return api;
}
