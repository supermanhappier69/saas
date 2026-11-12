// Workspace search: one box that finds records across every listed resource, including matches on linked
// records (an invoice's customer name), which the per-list search does not cover.
import { html, table, fieldColumns, emptyState, card, pageHeader, button } from './ui.js';
import { appPage } from './layout.js';
import { listColumns } from './crud.js';

const SEARCHABLE = new Set(['text', 'email', 'phone', 'url', 'textarea', 'select', 'ref']);
const LIMIT = 25;

export function searchPage(ctx) {
  const q = String(ctx.query?.q ?? '').trim().slice(0, 100);
  const needle = q.toLowerCase();
  const { resources } = ctx.services;
  const groups = [];
  if (needle) {
    for (const r of resources.all.filter((x) => x.nav !== false && x.searchable !== false)) {
      const keys = r.fields.filter((f) => SEARCHABLE.has(f.type) && !f.secret).map((f) => (f.type === 'ref' ? `${f.key}__label` : f.key));
      const rows = resources.query(ctx, r, { all: true }).rows
        .filter((row) => [row.__title, ...keys.map((k) => row[k])].some((v) => String(v ?? '').toLowerCase().includes(needle)));
      if (rows.length) groups.push({ r, rows });
    }
  }
  const total = groups.reduce((s, g) => s + g.rows.length, 0);
  const form = html`<form method="get" action="/app/search" class="search-form" role="search"><label class="sr-only" for="search-q">Search</label><input type="search" id="search-q" name="q" value="${q}" placeholder="${ctx.definition.search?.placeholder || 'Search'}"${q ? '' : html` autofocus`}>${button('Search', { variant: 'primary' })}</form>`;
  const results = !q
    ? ''
    : groups.length
      ? groups.map(({ r, rows }) => card({
        title: html`${r.label} <span class="count">${rows.length}</span>`,
        body: table({ columns: fieldColumns(listColumns(r)), rows: rows.slice(0, LIMIT), rowHref: (x) => `/app/${r.name}/${x.id}` }),
        footer: rows.length > LIMIT ? html`<span class="muted">Showing the first ${LIMIT} of ${rows.length}. Add more of the name or number to narrow it down.</span>` : null,
      }))
      : card({ body: emptyState({ title: html`Nothing matches “${q}”`, text: 'Try an invoice number, part of a customer’s name, a reference or an email address.' }) });
  const subtitle = q ? `${total} result${total === 1 ? '' : 's'} for “${q}”` : 'Find any customer, invoice, payment or chase by name, number, reference or email.';
  return appPage(ctx, { title: 'Search', body: html`${pageHeader({ title: 'Search', subtitle })}${form}${results}` });
}

export function registerSearch(router) {
  router.get('/app/search', searchPage);
}
