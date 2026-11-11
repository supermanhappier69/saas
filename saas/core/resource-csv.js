// CSV export and import for any declared resource. Imports always preview first inside a rolled-back
// transaction and only commit when every row is valid. Rows with an existing ID are updated, others are added.
import { HttpError, parseCSV, toCSV } from './util.js';

export const MAX_IMPORT_ROWS = 5000;
const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');

export function createResourceCsv({ db, resources }) {
  const importable = (r) => r.fields.filter((f) => !f.readonly && !f.noImport);

  function cellOut(f, row) {
    const v = row[f.key];
    if (v === null || v === undefined) return '';
    switch (f.type) {
      case 'ref':
        return row[`${f.key}__label`] ?? v;
      case 'refs':
        return (row[`${f.key}__labels`] || []).join('; ');
      case 'multiselect':
        return (v || []).join('; ');
      case 'bool':
        return v ? 'Yes' : 'No';
      case 'money':
        return Number(v).toFixed(2);
      default:
        return Array.isArray(v) ? v.join('; ') : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : v;
    }
  }

  function exportCSV(ctx, r, opts = {}) {
    const { rows } = resources.query(ctx, r, { ...opts, all: true });
    const fields = r.fields.filter((f) => !f.noExport);
    const computed = r.computedFields.filter((f) => f.export !== false);
    const header = ['ID', ...fields.map((f) => f.label), ...computed.map((f) => f.label)];
    return toCSV(header, rows.map((row) => [row.id, ...fields.map((f) => cellOut(f, row)), ...computed.map((f) => cellOut(f, row))]));
  }

  function templateCSV(r) {
    const fields = importable(r);
    return toCSV(fields.map((f) => f.label), [fields.map((f) => f.example ?? '')]);
  }

  function mapHeader(r, header) {
    const lookup = new Map();
    for (const f of importable(r)) {
      for (const name of [f.key, f.label, ...(f.aliases || [])]) if (!lookup.has(norm(name))) lookup.set(norm(name), f);
    }
    const columns = [];
    const ignored = [];
    const used = new Set();
    let idCol = -1;
    header.forEach((h, i) => {
      const k = norm(h);
      if (!k) return;
      if (k === 'id' && idCol < 0) {
        idCol = i;
        return;
      }
      const f = lookup.get(k);
      if (f && !used.has(f.key)) {
        columns[i] = f;
        used.add(f.key);
      } else ignored.push(String(h).trim());
    });
    return { columns, ignored, used, idCol };
  }

  const errorText = (r, err) => {
    const fe = err?.details?.fieldErrors;
    if (fe) return Object.entries(fe).map(([k, m]) => `${r.fieldMap.get(k)?.label || k}: ${m}`).join(' ');
    return err?.message || String(err);
  };

  function importCSV(ctx, r, text, { commit = false } = {}) {
    const table = parseCSV(text);
    if (!table.length) throw new HttpError(422, 'The file is empty.');
    const [header, ...body] = table;
    if (!body.length) throw new HttpError(422, 'The file has a header row but no records.');
    if (body.length > MAX_IMPORT_ROWS) throw new HttpError(413, `Import up to ${MAX_IMPORT_ROWS} rows at a time.`);
    const { columns, ignored, used, idCol } = mapHeader(r, header);
    if (!used.size) throw new HttpError(422, `None of the column names match. Use columns like: ${importable(r).map((f) => f.label).join(', ')}.`);
    const missing = importable(r).filter((f) => f.required && f.default === undefined && !used.has(f.key)).map((f) => f.label);
    if (missing.length && idCol < 0) throw new HttpError(422, `Add the required column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}.`);

    const run = () => body.map((cells, i) => {
      const line = i + 2;
      const input = {};
      columns.forEach((f, ci) => {
        if (f) input[f.key] = cells[ci] ?? '';
      });
      const idRaw = idCol >= 0 ? String(cells[idCol] ?? '').trim() : '';
      try {
        if (idRaw) {
          if (!/^\d+$/.test(idRaw) || !resources.one(ctx.org.id, r, Number(idRaw))) {
            throw new Error(`ID ${idRaw} doesn't match a ${r.singular.toLowerCase()} in this workspace. Clear the ID to add it as new.`);
          }
          const row = resources.update(ctx, r, Number(idRaw), input, { quiet: true });
          return { line, ok: true, action: 'update', id: row.id, title: resources.titleOf(ctx, r, row) };
        }
        const row = resources.create(ctx, r, input, { quiet: true });
        return { line, ok: true, action: 'create', id: row.id, title: resources.titleOf(ctx, r, row) };
      } catch (err) {
        return { line, ok: false, error: errorText(r, err) };
      }
    });

    const summary = (results) => ({
      total: results.length,
      created: results.filter((x) => x.ok && x.action === 'create').length,
      updated: results.filter((x) => x.ok && x.action === 'update').length,
      errors: results.filter((x) => !x.ok),
      ignored,
      columns: columns.filter(Boolean).map((f) => f.label),
    });

    ctx.dryRun = true;
    let preview;
    try {
      preview = db.dryRun(run);
    } finally {
      ctx.dryRun = false;
      ctx.cache = {};
    }
    const s = summary(preview);
    if (!commit || s.errors.length) return { ...s, committed: false, rows: preview.slice(0, 20) };

    const results = db.tx(() => {
      const out = run();
      const bad = out.find((x) => !x.ok);
      if (bad) throw new HttpError(422, `Row ${bad.line}: ${bad.error}`);
      return out;
    });
    ctx.cache = {};
    const done = summary(results);
    ctx.audit?.('import', r.name, null, `Imported ${r.label.toLowerCase()} from CSV: ${done.created} added, ${done.updated} updated`);
    return { ...done, committed: true, rows: results.slice(0, 20) };
  }

  return { exportCSV, templateCSV, importCSV, cellOut, importable, MAX_IMPORT_ROWS };
}
