// Generic record pages for every resource: list, detail, create, edit, delete, files, CSV import/export and custom actions.
// Handlers return HTML strings or { redirect, flash } / { status, html } / { download } objects (see app.js).
import { HttpError, fmtDateUK, todayISO } from './util.js';
import {
  html, button, postButton, pageHeader, card, table, fieldColumns, pagination, filterBar, tabs,
  recordForm, detailList, emptyState, alert, urlWith, csrfField, timeline, badge,
} from './ui.js';
import { appPage } from './layout.js';
import { roleRank } from './auth.js';

export const can = (ctx, role) => roleRank(ctx.role) >= roleRank(role);
export function requireRole(ctx, role = 'member') {
  if (can(ctx, role)) return;
  throw new HttpError(403, role === 'member'
    ? 'Your role is read only. Ask a workspace admin for member access to make changes.'
    : `This needs ${role} access. Ask a workspace admin.`);
}

export function fmtWhen(iso, tz = 'Europe/London') {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d);
}
export const fmtSize = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`);

const formFields = (r) => r.fields.filter((f) => !f.readonly && !f.hidden && f.form !== false);
const detailFields = (r) => [...r.fields, ...r.computedFields].filter((f) => !f.hidden && f.detail !== false);
export function listColumns(r) {
  const keys = r.columns || [r.titleField, ...r.fields.filter((f) => f.key !== r.titleField && !f.hidden && !['textarea', 'markdown'].includes(f.type)).slice(0, 5).map((f) => f.key)];
  return keys.map((k) => r.colMap.get(k)).filter(Boolean);
}
const filterFields = (r) => [...r.fields, ...r.computedFields].filter((f) => f.filter);
function filterOptions(ctx, f) {
  const res = ctx.services.resources;
  if (f.type === 'bool') return [{ value: '1', label: 'Yes' }, { value: '0', label: 'No' }];
  if (f.type === 'ref' || f.type === 'refs') {
    return [...res.labelMap(ctx, f.ref).entries()].map(([value, label]) => ({ value, label })).sort((a, b) => String(a.label).localeCompare(String(b.label), 'en-GB'));
  }
  return res.options(f, ctx) || [];
}
export function filtersFrom(r, query) {
  const out = {};
  for (const [k, v] of Object.entries(query || {})) if (k.startsWith('f_') && r.colMap.has(k.slice(2)) && v !== '') out[k.slice(2)] = v;
  return out;
}
const viewFrom = (r, query) => {
  if ((r.views || []).some((v) => v.id === query.view)) return query.view;
  // A search from a list that opens on a default view (Unpaid invoices) looks across everything, or a paid invoice could never be found.
  return query.view === undefined && r.defaultView && !String(query.q ?? '').trim() ? r.defaultView : '';
};
const fieldErrorsOf = (err) => (err instanceof HttpError && err.status === 422 && err.details?.fieldErrors ? err.details.fieldErrors : null);
const back = (r, row) => `/app/${r.name}/${row.id}`;
const lower = (s) => String(s).toLowerCase();

function defaults(ctx, r) {
  const out = {};
  for (const f of r.fields) {
    if (ctx.query[f.key] !== undefined) out[f.key] = ctx.query[f.key];
    else if (f.default !== undefined) out[f.key] = typeof f.default === 'function' ? f.default(ctx) : f.default;
  }
  return out;
}

export function listPage(ctx, r) {
  const { resources } = ctx.services;
  const q = ctx.query;
  const view = viewFrom(r, q);
  const filters = filtersFrom(r, q);
  const result = resources.query(ctx, r, { q: q.q, filters, view, sort: q.sort, dir: q.dir, page: q.page, pageSize: r.pageSize || 50 });
  if (r.rowClass) for (const row of result.rows) row.__rowClass = r.rowClass(row, ctx);
  const base = `/app/${r.name}`;
  const state = { view: q.view, q: q.q, sort: q.sort, dir: q.dir, ...Object.fromEntries(Object.entries(filters).map(([k, v]) => [`f_${k}`, v])) };
  let tabBar = '';
  if (r.views?.length) {
    const everything = resources.query(ctx, r, { all: true }).rows;
    tabBar = tabs([
      { id: '', label: 'All', href: urlWith(base, { view: r.defaultView ? 'all' : '' }), count: everything.length },
      ...r.views.map((v) => ({ id: v.id, label: v.label, href: urlWith(base, { view: v.id }), count: everything.filter((row) => v.filter(row, ctx)).length })),
    ], view);
  }
  const writable = can(ctx, 'member');
  const actions = [
    ...(r.listActions ? r.listActions(ctx) : []),
    writable && r.import !== false ? button('Import', { href: `${base}/import`, size: 'sm' }) : null,
    button('Export CSV', { href: urlWith(`${base}/export.csv`, { ...state, view }), size: 'sm' }),
    writable && r.create !== false ? button(`New ${lower(r.singular)}`, { href: `${base}/new`, variant: 'primary', size: 'sm' }) : null,
  ].filter(Boolean);
  const fb = filterBar({
    action: base, q: q.q || '', hidden: { view: q.view, sort: q.sort, dir: q.dir },
    filters: filterFields(r).map((f) => ({ key: f.key, label: f.label, options: filterOptions(ctx, f) })), values: filters,
  });
  // A list's default view (Unpaid invoices) counts as narrowing only when something exists to be narrowed out: a workspace with
  // no invoices at all should get the "No invoices yet" help with its Add and Import buttons, not "No matching records".
  const anyRecords = result.rows.length > 0 || resources.query(ctx, r, { all: true }).rows.length > 0;
  const filtered = anyRecords && (q.q || Object.keys(filters).length || view);
  const empty = filtered
    ? emptyState({ title: 'No matching records', text: 'Try a different search, filter or view.' })
    : emptyState({
      title: r.emptyTitle || `No ${lower(r.label)} yet`,
      text: r.emptyText || null,
      action: writable && r.create !== false ? html`${button(`Add ${lower(r.singular)}`, { href: `${base}/new`, variant: 'primary' })} ${r.import !== false ? button('Import from CSV', { href: `${base}/import` }) : ''}` : null,
    });
  const body = html`${pageHeader({ title: r.label, subtitle: r.description || null, actions })}${r.listIntro ? r.listIntro(ctx) : ''}${tabBar}${fb}${table({
    columns: fieldColumns(listColumns(r)), rows: result.rows, empty, sort: result.sort, dir: result.dir,
    sortUrl: (key, dir) => urlWith(base, { ...state, sort: key, dir }), rowHref: (row) => back(r, row),
  })}${pagination({ page: result.page, pages: result.pages, total: result.total, url: (p) => urlWith(base, { ...state, page: p }) })}`;
  return appPage(ctx, { title: r.label, body, active: r.navId || r.name });
}

function childLists(ctx, r, row) {
  const { resources } = ctx.services;
  const out = [];
  for (const o of resources.all) {
    for (const f of o.fields) {
      if (f.type !== 'ref' || f.ref !== r.name || f.related === false) continue;
      const list = resources.query(ctx, o, { where: `"${f.key}" = ?`, params: [row.id], all: true }).rows;
      const add = can(ctx, 'member') && o.create !== false
        ? button(`Add ${lower(o.singular)}`, { href: urlWith(`/app/${o.name}/new`, { [f.key]: row.id }), size: 'sm' }) : null;
      out.push(card({
        title: `${f.relatedLabel || o.label} (${list.length})`,
        actions: add,
        body: table({ columns: fieldColumns(listColumns(o).filter((c) => c.key !== f.key)), rows: list.slice(0, 25), rowHref: (x) => `/app/${o.name}/${x.id}`, empty: html`<p class="muted">None yet.</p>` }),
        // view=all: the list's default view (Unpaid invoices) would otherwise show fewer than the "See all N" promised.
        footer: list.length > 25 ? html`<a href="${urlWith(`/app/${o.name}`, { [`f_${f.key}`]: row.id, view: o.defaultView ? 'all' : undefined })}">See all ${list.length}</a>` : null,
      }));
    }
  }
  return out;
}

function filesCard(ctx, r, row) {
  const { files } = ctx.services;
  const writable = can(ctx, 'member');
  const list = files.list(ctx.org.id, r.name, row.id);
  const items = list.length
    ? html`<ul class="file-list">${list.map((x) => html`<li><a href="/app/files/${x.id}">${x.name}</a> <span class="muted small">${fmtSize(x.size || 0)} · ${fmtDateUK(String(x.created_at).slice(0, 10))}${
      x.uploaded_by ? ` · ${x.uploaded_by}` : ''
    }</span>${writable ? postButton(ctx, `/app/files/${x.id}/delete`, 'Remove', { size: 'sm', variant: 'ghost', confirm: `Remove ${x.name}?` }) : ''}</li>`)}</ul>`
    : html`<p class="muted">No files yet.</p>`;
  const upload = writable
    ? html`<form method="post" action="${back(r, row)}/files" enctype="multipart/form-data" class="upload-form">${csrfField(ctx)}<label class="sr-only" for="upload-file">Choose a file</label><input type="file" id="upload-file" name="file" required>${
      button('Upload', { size: 'sm' })
    }</form><p class="help">PDF, image, Word, Excel, CSV or text, up to ${files.maxMb} MB.</p>`
    : '';
  return card({ title: r.filesLabel || 'Files', body: html`${items}${upload}` });
}

export function detailPage(ctx, r, id) {
  const { resources, db, config } = ctx.services;
  const row = resources.find(ctx, r, id);
  const actions = [];
  for (const a of r.actions || []) {
    if ((a.show && !a.show(row, ctx)) || !can(ctx, a.role || 'member')) continue;
    actions.push(a.href
      ? button(a.label, { href: a.href(row, ctx), size: 'sm', variant: a.variant || 'secondary' })
      : postButton(ctx, `${back(r, row)}/action/${a.id}`, a.label, { size: 'sm', variant: a.variant || 'secondary', confirm: a.confirm || null }));
  }
  if (can(ctx, 'member') && r.edit !== false) actions.push(button('Edit', { href: `${back(r, row)}/edit`, size: 'sm', variant: 'primary' }));
  const history = db.all(
    'SELECT a.summary, a.created_at, u.name AS who FROM audit a LEFT JOIN users u ON u.id = a.user_id WHERE a.org_id = ? AND a.resource = ? AND a.record_id = ? ORDER BY a.id DESC LIMIT 8',
    ctx.org.id, r.name, row.id,
  );
  const historyCard = history.length
    ? card({ title: 'History', body: timeline(history.map((h) => ({ when: fmtWhen(h.created_at, config?.TIMEZONE), who: h.who, body: h.summary }))) }) : '';
  // Records that are deleted along with this one (a payment goes with its invoice), so the confirmation can say so.
  const withIt = [];
  for (const o of resources.all) {
    for (const f of o.fields) {
      if (f.type !== 'ref' || f.ref !== r.name || f.onDelete !== 'cascade') continue;
      const n = db.get(`SELECT COUNT(*) AS n FROM "${o.table}" WHERE org_id = ? AND "${f.key}" = ?`, ctx.org.id, row.id).n;
      const noun = lower(o.singular);
      if (n) withIt.push(`${n} ${n === 1 ? noun : /[^aeiou]y$/.test(noun) ? `${noun.slice(0, -1)}ies` : `${noun}s`}`);
    }
  }
  const also = withIt.length ? ` This also deletes ${withIt.join(' and ')}.` : '';
  const del = r.delete !== false && can(ctx, r.deleteRole || 'member')
    ? html`<div class="danger-zone">${postButton(ctx, `${back(r, row)}/delete`, `Delete ${lower(r.singular)}`, { variant: 'danger', size: 'sm', confirm: `Delete “${row.__title}”?${also} This can't be undone.` })}</div>` : '';
  const body = html`${pageHeader({
    title: html`${row.__title}${row.is_sample ? html` ${badge('SAMPLE', 'yellow')}` : ''}`,
    subtitle: r.detailSubtitle ? r.detailSubtitle(row, ctx) : null,
    crumbs: [{ label: r.label, href: `/app/${r.name}` }, { label: row.__title }],
    actions,
  })}<div class="detail-grid"><div class="detail-main">${r.detail ? r.detail(ctx, row) : ''}${card({ title: 'Details', body: detailList(detailFields(r), row) })}${childLists(ctx, r, row)}</div><aside class="detail-side">${
    r.sidePanel ? r.sidePanel(ctx, row) : ''
  }${r.files ? filesCard(ctx, r, row) : ''}${historyCard}${del}</aside></div>`;
  return appPage(ctx, { title: row.__title, body, active: r.navId || r.name });
}

export function formPage(ctx, r, { row = null, values = {}, errors = {} } = {}) {
  const base = `/app/${r.name}`;
  const title = row ? `Edit ${row.__title}` : `New ${lower(r.singular)}`;
  const form = recordForm(ctx, {
    action: row ? back(r, row) : base,
    fields: formFields(r),
    values,
    errors,
    submit: row ? 'Save changes' : `Add ${lower(r.singular)}`,
    cancel: row ? back(r, row) : base,
    intro: r.formIntro ? r.formIntro(ctx, row) : '',
  });
  const crumbs = row ? [{ label: r.label, href: base }, { label: row.__title, href: back(r, row) }, { label: 'Edit' }] : [{ label: r.label, href: base }, { label: 'New' }];
  return appPage(ctx, { title, body: html`${pageHeader({ title, crumbs })}${card({ body: form })}`, active: r.navId || r.name });
}

function createRecord(ctx, r) {
  requireRole(ctx, 'member');
  if (r.create === false) throw new HttpError(405, `New ${lower(r.label)} are added automatically.`);
  try {
    const row = ctx.services.resources.create(ctx, r, ctx.body);
    return { redirect: r.afterCreate ? r.afterCreate(row, ctx) : back(r, row), flash: `${r.singular} added.` };
  } catch (err) {
    const fe = fieldErrorsOf(err);
    if (!fe) throw err;
    return { status: 422, html: formPage(ctx, r, { values: ctx.body, errors: fe }) };
  }
}

function updateRecord(ctx, r, id) {
  requireRole(ctx, 'member');
  if (r.edit === false) throw new HttpError(405, `${r.label} can't be edited.`);
  const { resources } = ctx.services;
  const existing = resources.find(ctx, r, id);
  try {
    const row = resources.update(ctx, r, existing.id, ctx.body);
    return { redirect: back(r, row), flash: 'Changes saved.' };
  } catch (err) {
    const fe = fieldErrorsOf(err);
    if (!fe) throw err;
    return { status: 422, html: formPage(ctx, r, { row: existing, values: { ...existing, ...ctx.body }, errors: fe }) };
  }
}

function deleteRecord(ctx, r, id) {
  requireRole(ctx, r.deleteRole || 'member');
  if (r.delete === false) throw new HttpError(405, `${r.label} can't be deleted.`);
  const { resources } = ctx.services;
  const row = resources.find(ctx, r, id);
  try {
    resources.remove(ctx, r, row.id);
  } catch (err) {
    if (err instanceof HttpError && err.status === 409) return { redirect: back(r, row), flash: { text: err.message, tone: 'red' } };
    throw err;
  }
  return { redirect: `/app/${r.name}`, flash: `${r.singular} “${row.__title}” deleted.` };
}

const TYPE_LABELS = {
  text: 'Text', textarea: 'Text', markdown: 'Text', email: 'Email address', url: 'Web address', phone: 'Phone number',
  select: 'One of the allowed values', multiselect: 'Allowed values, separated by ;', date: 'Date, e.g. 31/01/2026',
  refs: 'Names, separated by ;', number: 'Number', money: 'Amount, e.g. 1250.00', percent: 'Percent, e.g. 4.5', int: 'Whole number', bool: 'Yes or No',
};
function importGuide(ctx, r) {
  const fields = ctx.services.csv.importable(r);
  const rows = fields.map((f) => {
    let allowed = '';
    if (f.type === 'select' || f.type === 'multiselect') {
      const opts = ctx.services.resources.options(f, ctx) || [];
      allowed = opts.slice(0, 15).join('; ') + (opts.length > 15 ? '; …' : '');
    }
    const type = f.type === 'ref' ? `Name of an existing ${lower(ctx.services.resources.get(f.ref).singular)}` : TYPE_LABELS[f.type] || 'Text';
    return html`<tr><td>${f.label}${f.required ? html` <span class="req">*</span>` : ''}</td><td>${type}</td><td>${allowed}</td><td>${f.example ?? ''}</td></tr>`;
  });
  return html`<details class="guide"><summary>Column guide (${fields.length} columns, * = required)</summary><div class="table-wrap"><table class="table table-compact"><thead><tr><th scope="col">Column</th><th scope="col">What to enter</th><th scope="col">Allowed values</th><th scope="col">Example</th></tr></thead><tbody>${rows}</tbody></table></div><p class="help">Include an ID column to update existing records instead of adding new ones.</p></details>`;
}

export function importPage(ctx, r, { result = null, text = '', error = null } = {}) {
  const base = `/app/${r.name}`;
  const form = html`<form method="post" action="${base}/import" enctype="multipart/form-data" class="form">${csrfField(ctx)}${error ? alert(error, 'red') : ''}<div class="form-grid"><div class="field"><label for="imp-file">CSV file</label><input type="file" id="imp-file" name="file" accept=".csv,text/csv"></div><div class="field field-wide"><label for="imp-csv">Or paste CSV rows (header row first)</label><textarea id="imp-csv" name="csv" rows="8">${
    result ? '' : text
  }</textarea></div></div><div class="form-actions">${button('Preview import', { variant: 'primary' })}${button('Download template', { href: `${base}/template.csv` })}${button('Cancel', { href: base, variant: 'ghost' })}</div></form>${importGuide(ctx, r)}`;
  let preview = '';
  if (result) {
    const ok = !result.errors.length;
    const summary = ok
      ? alert(html`Ready to import <strong>${result.total}</strong> rows: ${result.created} new and ${result.updated} updated.${result.ignored?.length ? html` Ignored columns: ${result.ignored.join(', ')}.` : ''}`, 'green', 'Preview.')
      : alert(`${result.errors.length} of ${result.total} rows have problems. Fix them in your file and preview again. Nothing has been imported yet.`, 'red');
    const errs = ok ? '' : html`<ul class="error-list">${result.errors.slice(0, 50).map((x) => html`<li>Row ${x.line}: ${x.error}</li>`)}</ul>${
      result.errors.length > 50 ? html`<p class="muted">…and ${result.errors.length - 50} more.</p>` : ''
    }`;
    const sample = table({
      columns: [
        { key: 'line', label: 'Row' },
        { key: 'action', label: 'Result', render: (x) => (x.ok ? badge(x.action === 'update' ? 'Update' : 'New', x.action === 'update' ? 'blue' : 'green') : badge('Problem', 'red')) },
        { key: 'title', label: 'Record', render: (x) => x.title || x.error },
      ],
      rows: result.rows || [],
    });
    const commit = ok
      ? html`<form method="post" action="${base}/import" class="form-actions">${csrfField(ctx)}<input type="hidden" name="commit" value="1"><textarea name="csv" hidden>${text}</textarea>${button(`Import ${result.total} rows`, { variant: 'primary' })}</form>`
      : '';
    preview = card({ title: 'Preview', body: html`${summary}${errs}${sample}${commit}` });
  }
  const title = `Import ${lower(r.label)}`;
  return appPage(ctx, { title, active: r.navId || r.name, body: html`${pageHeader({ title, crumbs: [{ label: r.label, href: base }, { label: 'Import' }] })}${preview}${card({ body: form })}` });
}

function decodeUpload(data) {
  const s = data.toString('utf8');
  return s.includes('\uFFFD') ? new TextDecoder('windows-1252').decode(data) : s;
}

function importPost(ctx, r) {
  requireRole(ctx, 'member');
  if (r.import === false) throw new HttpError(404, 'Page not found');
  const upload = (ctx.files || []).find((f) => f.field === 'file' && f.data?.length);
  const text = upload ? decodeUpload(upload.data) : String(ctx.body?.csv || '');
  if (!text.trim()) return { status: 422, html: importPage(ctx, r, { error: 'Choose a CSV file or paste some rows first.' }) };
  try {
    const result = ctx.services.csv.importCSV(ctx, r, text, { commit: ctx.body?.commit === '1' });
    if (result.committed) return { redirect: `/app/${r.name}`, flash: `Import finished: ${result.created} added, ${result.updated} updated.` };
    return importPage(ctx, r, { result, text });
  } catch (err) {
    if (err instanceof HttpError && err.status < 500) return { status: err.status, html: importPage(ctx, r, { error: err.message, text }) };
    throw err;
  }
}

function exportCsv(ctx, r) {
  const q = ctx.query;
  // No view in the link means everything: the list's default view (for example Unpaid invoices) must not silently trim a full export.
  const text = ctx.services.csv.exportCSV(ctx, r, { q: q.q, filters: filtersFrom(r, q), view: q.view === undefined ? '' : viewFrom(r, q), sort: q.sort, dir: q.dir });
  ctx.audit?.('export', r.name, null, `Exported ${lower(r.label)} to CSV`);
  const day = todayISO(ctx.services.config?.TIMEZONE);
  return { download: { body: text.startsWith('\uFEFF') ? text : `\uFEFF${text}`, type: 'text/csv; charset=utf-8', filename: `${ctx.definition.slug}-${r.name}-${day}.csv` } };
}

function uploadFiles(ctx, r, id) {
  requireRole(ctx, 'member');
  if (!r.files) throw new HttpError(404, 'Page not found');
  const row = ctx.services.resources.find(ctx, r, id);
  const uploads = (ctx.files || []).filter((f) => f.data?.length);
  if (!uploads.length) return { redirect: back(r, row), flash: { text: 'Choose a file to upload first.', tone: 'orange' } };
  try {
    for (const u of uploads) ctx.services.files.save({ orgId: ctx.org.id, userId: ctx.user.id, resource: r.name, recordId: row.id, filename: u.filename, data: u.data });
  } catch (err) {
    if (err instanceof HttpError && err.status < 500) return { redirect: back(r, row), flash: { text: err.message, tone: 'red' } };
    throw err;
  }
  ctx.audit?.('upload', r.name, row.id, uploads.length === 1 ? `File “${uploads[0].filename}” added` : `${uploads.length} files added`);
  return { redirect: back(r, row), flash: uploads.length === 1 ? 'File uploaded.' : `${uploads.length} files uploaded.` };
}

function getFile(ctx) {
  const f = ctx.services.files.get(ctx.org.id, ctx.params.fileId);
  if (!f) throw new HttpError(404, 'File not found');
  ctx.services.files.stream(ctx.res, f, { inline: ctx.query.inline === '1' });
}

function deleteFile(ctx) {
  requireRole(ctx, 'member');
  const f = ctx.services.files.get(ctx.org.id, ctx.params.fileId);
  if (!f) throw new HttpError(404, 'File not found');
  ctx.services.files.remove(ctx.org.id, f.id);
  ctx.audit?.('delete', f.resource, f.record_id, `File “${f.name}” removed`);
  return { redirect: f.resource && f.record_id ? `/app/${f.resource}/${f.record_id}` : '/app', flash: 'File removed.' };
}

async function runAction(ctx, r, id, actionId) {
  const a = (r.actions || []).find((x) => x.id === actionId && x.run);
  if (!a) throw new HttpError(404, 'Page not found');
  requireRole(ctx, a.role || 'member');
  const row = ctx.services.resources.find(ctx, r, id);
  if (a.show && !a.show(row, ctx)) throw new HttpError(409, `“${a.label}” isn't available for this ${lower(r.singular)} right now.`);
  const out = await a.run(ctx, row, ctx.body || {});
  if (typeof out === 'string' || out?.html || out?.redirect || out?.download || out?.json) return out;
  return { redirect: back(r, row), flash: out?.flash || `${a.label}: done.` };
}

async function runCollectionAction(ctx, r, actionId) {
  const a = (r.collectionActions || []).find((x) => x.id === actionId);
  if (!a) throw new HttpError(404, 'Page not found');
  requireRole(ctx, a.role || 'member');
  const out = await a.run(ctx, ctx.body || {});
  if (typeof out === 'string' || out?.html || out?.redirect || out?.download || out?.json) return out;
  return { redirect: `/app/${r.name}`, flash: out?.flash || `${a.label}: done.` };
}

export function registerCrud(router) {
  const R = (ctx) => ctx.services.resources.get(ctx.params.res);
  router.get('/app/files/:fileId', getFile);
  router.post('/app/files/:fileId/delete', deleteFile);
  router.get('/app/:res/new', (ctx) => {
    const r = R(ctx);
    requireRole(ctx, 'member');
    if (r.create === false) throw new HttpError(404, 'Page not found');
    return formPage(ctx, r, { values: defaults(ctx, r) });
  });
  router.get('/app/:res/export.csv', (ctx) => exportCsv(ctx, R(ctx)));
  router.get('/app/:res/template.csv', (ctx) => {
    const r = R(ctx);
    return { download: { body: `\uFEFF${ctx.services.csv.templateCSV(r)}`, type: 'text/csv; charset=utf-8', filename: `${ctx.definition.slug}-${r.name}-template.csv` } };
  });
  router.get('/app/:res/import', (ctx) => {
    const r = R(ctx);
    requireRole(ctx, 'member');
    if (r.import === false) throw new HttpError(404, 'Page not found');
    return importPage(ctx, r);
  });
  router.post('/app/:res/import', (ctx) => importPost(ctx, R(ctx)));
  router.post('/app/:res/action/:action', (ctx) => runCollectionAction(ctx, R(ctx), ctx.params.action));
  router.get('/app/:res', (ctx) => listPage(ctx, R(ctx)));
  router.post('/app/:res', (ctx) => createRecord(ctx, R(ctx)));
  router.get('/app/:res/:id/edit', (ctx) => {
    const r = R(ctx);
    requireRole(ctx, 'member');
    if (r.edit === false) throw new HttpError(404, 'Page not found');
    const row = ctx.services.resources.find(ctx, r, ctx.params.id);
    return formPage(ctx, r, { row, values: row });
  });
  router.post('/app/:res/:id/delete', (ctx) => deleteRecord(ctx, R(ctx), ctx.params.id));
  router.post('/app/:res/:id/files', (ctx) => uploadFiles(ctx, R(ctx), ctx.params.id));
  router.post('/app/:res/:id/action/:action', (ctx) => runAction(ctx, R(ctx), ctx.params.id, ctx.params.action));
  router.get('/app/:res/:id', (ctx) => detailPage(ctx, R(ctx), ctx.params.id));
  router.post('/app/:res/:id', (ctx) => updateRecord(ctx, R(ctx), ctx.params.id));
}
