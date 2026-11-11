// JSON API at /api/v1. Authenticate with "Authorization: Bearer <key>" (create keys in Settings > API keys),
// or use a signed-in browser session plus the x-csrf-token header for writes.
import { HttpError } from './util.js';
import { requireRole, filtersFrom } from './crud.js';

export function apiRow(r, row) {
  const out = { id: row.id, title: row.__title ?? null, sample: Boolean(row.is_sample), created_at: row.created_at ?? null, updated_at: row.updated_at ?? null };
  for (const f of [...r.fields, ...r.computedFields]) {
    if (f.api === false) continue;
    out[f.key] = row[f.key] === undefined ? null : row[f.key];
    if (f.type === 'ref') out[`${f.key}_label`] = row[`${f.key}__label`] ?? null;
    if (f.type === 'refs') out[`${f.key}_labels`] = row[`${f.key}__labels`] ?? [];
  }
  return out;
}

const fieldSchema = (ctx, f) => ({
  key: f.key,
  label: f.label,
  type: f.type,
  required: Boolean(f.required),
  readonly: Boolean(f.readonly),
  ...(f.ref ? { ref: f.ref } : {}),
  ...(f.type === 'select' || f.type === 'multiselect' ? { options: ctx.services.resources.options(f, ctx) || [] } : {}),
});

function bodyObject(ctx) {
  const b = ctx.body;
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw new HttpError(400, 'Send a JSON object in the request body.');
  return b;
}

export function registerApi(router) {
  const R = (ctx) => ctx.services.resources.get(ctx.params.res);
  router.get('/api/v1', (ctx) => ({
    json: {
      workspace: { id: ctx.org.id, name: ctx.org.name },
      resources: ctx.services.resources.all.map((r) => ({
        name: r.name,
        label: r.label,
        url: `/api/v1/${r.name}`,
        fields: r.fields.map((f) => fieldSchema(ctx, f)),
        computed: r.computedFields.map((f) => ({ key: f.key, label: f.label, type: f.type })),
        views: (r.views || []).map((v) => ({ id: v.id, label: v.label })),
      })),
    },
  }));
  router.get('/api/v1/:res', (ctx) => {
    const r = R(ctx);
    const q = ctx.query;
    const res = ctx.services.resources.query(ctx, r, {
      q: q.q, view: q.view || '', filters: filtersFrom(r, q), sort: q.sort, dir: q.dir, page: q.page, pageSize: q.page_size || 100,
    });
    return { json: { data: res.rows.map((row) => apiRow(r, row)), page: res.page, pages: res.pages, page_size: res.pageSize, total: res.total } };
  });
  router.get('/api/v1/:res/:id', (ctx) => {
    const r = R(ctx);
    return { json: { data: apiRow(r, ctx.services.resources.find(ctx, r, ctx.params.id)) } };
  });
  router.post('/api/v1/:res', (ctx) => {
    requireRole(ctx, 'member');
    const r = R(ctx);
    if (r.create === false) throw new HttpError(405, `New ${r.label.toLowerCase()} are added automatically.`);
    const row = ctx.services.resources.create(ctx, r, bodyObject(ctx));
    return { status: 201, json: { data: apiRow(r, ctx.services.resources.find(ctx, r, row.id)) } };
  });
  router.patch('/api/v1/:res/:id', (ctx) => {
    requireRole(ctx, 'member');
    const r = R(ctx);
    if (r.edit === false) throw new HttpError(405, `${r.label} can't be edited.`);
    const existing = ctx.services.resources.find(ctx, r, ctx.params.id);
    ctx.services.resources.update(ctx, r, existing.id, bodyObject(ctx));
    return { json: { data: apiRow(r, ctx.services.resources.find(ctx, r, existing.id)) } };
  });
  router.delete('/api/v1/:res/:id', (ctx) => {
    const r = R(ctx);
    requireRole(ctx, r.deleteRole || 'member');
    if (r.delete === false) throw new HttpError(405, `${r.label} can't be deleted.`);
    const existing = ctx.services.resources.find(ctx, r, ctx.params.id);
    ctx.services.resources.remove(ctx, r, existing.id);
    return { json: { deleted: true, id: existing.id } };
  });
}
