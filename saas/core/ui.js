// Server-rendered HTML building blocks. Interpolations are escaped unless they come from html`` or raw(),
// so markup is XSS-safe by default. The CSP forbids inline scripts and styles: use classes and data- hooks.
import { e, fmtGBP, fmtDateUK, fmtNumber, mdToHtml } from './util.js';

class Safe {
  constructor(s) {
    this.s = s;
  }
  toString() {
    return this.s;
  }
}
export const isSafe = (v) => v instanceof Safe;
export const raw = (s) => (s instanceof Safe ? s : new Safe(String(s ?? '')));
function flat(v) {
  if (v === null || v === undefined || v === false || v === true) return '';
  if (v instanceof Safe) return v.s;
  if (Array.isArray(v)) return v.map(flat).join('');
  return e(v);
}
export function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += flat(vals[i]) + strings[i + 1];
  return new Safe(out);
}
export const join = (items, sep = '') => new Safe(items.map(flat).join(flat(sep)));
export const render = (v) => flat(v);

const TONES = new Set(['gray', 'blue', 'green', 'orange', 'red', 'purple', 'yellow']);
export const tone = (t) => (TONES.has(t) ? t : 'gray');
const blank = (v) => v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length);

export function attrs(obj) {
  let out = '';
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === null || v === undefined || v === false) continue;
    out += v === true ? ` ${k}` : ` ${k}="${e(v)}"`;
  }
  return new Safe(out);
}

/** Builds a URL with a query string, skipping empty values. */
export function urlWith(base, params = {}) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (!blank(v)) u.set(k, String(v));
  const s = u.toString();
  return s ? `${base}${base.includes('?') ? '&' : '?'}${s}` : base;
}

export const badge = (text, t = 'gray') => html`<span class="badge badge-${tone(t)}">${text}</span>`;

export function button(label, { href = null, variant = 'secondary', type = 'submit', size = null, name = null, value = null, extra = {} } = {}) {
  const cls = `btn btn-${variant}${size ? ` btn-${size}` : ''}`;
  if (href) return html`<a${attrs({ class: cls, href, ...extra })}>${label}</a>`;
  return html`<button${attrs({ class: cls, type, name, value, ...extra })}>${label}</button>`;
}

export const csrfField = (ctx) => html`<input type="hidden" name="_csrf" value="${ctx?.csrf || ''}">`;

/** A one-button POST form, for actions such as delete, mark paid or send. */
export function postButton(ctx, action, label, { variant = 'secondary', confirm = null, fields = {}, size = null } = {}) {
  return html`<form${attrs({ method: 'post', action, class: 'inline-form', 'data-confirm': confirm })}>${csrfField(ctx)}${Object.entries(fields).map(
    ([k, v]) => html`<input type="hidden" name="${k}" value="${v}">`,
  )}${button(label, { variant, size })}</form>`;
}

export function flashes(list = []) {
  if (!list?.length) return '';
  return html`<div class="flashes">${list.map(
    (f) => html`<div class="flash flash-${tone(f.tone || 'green')}" role="status"><span>${f.text}</span><button type="button" class="flash-close" data-dismiss aria-label="Dismiss">×</button></div>`,
  )}</div>`;
}

export const alert = (body, t = 'blue', title = null) =>
  html`<div class="alert alert-${tone(t)}" role="note">${title ? html`<strong>${title}</strong> ` : ''}${body}</div>`;

export function pageHeader({ title, subtitle = null, actions = [], crumbs = [] }) {
  const trail = crumbs.length
    ? html`<nav class="crumbs" aria-label="Breadcrumb">${crumbs.map(
      (c, i) => html`${i ? html`<span class="sep" aria-hidden="true">/</span>` : ''}${c.href ? html`<a href="${c.href}">${c.label}</a>` : html`<span>${c.label}</span>`}`,
    )}</nav>`
    : '';
  return html`<header class="page-header">${trail}<div class="page-header-row"><div class="page-title"><h1>${title}</h1>${
    subtitle ? html`<p class="subtitle">${subtitle}</p>` : ''
  }</div>${actions.length ? html`<div class="page-actions">${actions}</div>` : ''}</div></header>`;
}

export function card({ title = null, body, actions = null, footer = null, cls = '' }) {
  const head = title || actions ? html`<div class="card-head">${title ? html`<h2>${title}</h2>` : ''}${actions ? html`<div class="card-actions">${actions}</div>` : ''}</div>` : '';
  return html`<section${attrs({ class: `card ${cls}`.trim() })}>${head}<div class="card-body">${body}</div>${footer ? html`<div class="card-foot">${footer}</div>` : ''}</section>`;
}

export function stats(items) {
  return html`<div class="stats">${items.map((s) => {
    const inner = html`<span class="stat-label">${s.label}</span><span class="stat-value">${s.value}</span>${s.hint ? html`<span class="stat-hint">${s.hint}</span>` : ''}`;
    return s.href ? html`<a class="stat stat-${tone(s.tone)}" href="${s.href}">${inner}</a>` : html`<div class="stat stat-${tone(s.tone)}">${inner}</div>`;
  })}</div>`;
}

export const emptyState = ({ title, text = null, action = null }) =>
  html`<div class="empty"><h3>${title}</h3>${text ? html`<p>${text}</p>` : ''}${action || ''}</div>`;

export function tabs(items, active) {
  return html`<nav class="tabs" aria-label="Views">${items.map((t) => {
    const on = t.id === active;
    return html`<a${attrs({ href: t.href, class: on ? 'tab active' : 'tab', 'aria-current': on ? 'page' : null })}>${t.label}${
      t.count !== undefined && t.count !== null ? html` <span class="count">${t.count}</span>` : ''
    }</a>`;
  })}</nav>`;
}

/** Display formatting for a field value on a computed row. */
export function formatValue(f, row, { link = true } = {}) {
  if (f.render) return f.render(row);
  const v = row[f.key];
  if (blank(v)) return html`<span class="muted">—</span>`;
  switch (f.type) {
    case 'money':
      return html`<span class="num">${fmtGBP(v)}</span>`;
    case 'number':
      return html`<span class="num">${fmtNumber(v, f.dp ?? (Number.isInteger(Number(v)) ? 0 : 2))}</span>`;
    case 'int':
      return html`<span class="num">${fmtNumber(v, 0)}</span>`;
    case 'percent':
      return html`<span class="num">${fmtNumber(v, f.dp ?? 2)}%</span>`;
    case 'date':
      return html`<time datetime="${v}">${fmtDateUK(v, Boolean(f.long))}</time>`;
    case 'bool':
      return v ? html`<span class="yes">Yes</span>` : html`<span class="muted">No</span>`;
    case 'select':
      return f.tones ? badge(v, f.tones[v] || 'gray') : html`${v}`;
    case 'multiselect':
      return html`<span class="badges">${v.map((x) => badge(x, f.tones?.[x] || 'gray'))}</span>`;
    case 'ref': {
      const label = row[`${f.key}__label`] ?? `#${v}`;
      return link ? html`<a href="/app/${f.ref}/${v}">${label}</a>` : html`${label}`;
    }
    case 'refs':
      return html`${v.map((id, i) => {
        const label = row[`${f.key}__labels`]?.[i] ?? `#${id}`;
        return html`${i ? ', ' : ''}${link ? html`<a href="/app/${f.ref}/${id}">${label}</a>` : label}`;
      })}`;
    case 'email':
      return html`<a href="mailto:${v}">${v}</a>`;
    case 'url':
      return /^https?:\/\//i.test(v) ? html`<a href="${v}" rel="noopener noreferrer" target="_blank">${String(v).replace(/^https?:\/\//i, '')}</a>` : html`${v}`;
    case 'phone':
      return html`<a href="tel:${String(v).replace(/[^\d+]/g, '')}">${v}</a>`;
    case 'markdown':
      return raw(`<div class="prose">${mdToHtml(v)}</div>`);
    case 'textarea':
      return html`<div class="pre-line">${v}</div>`;
    default:
      return html`${Array.isArray(v) ? v.join(', ') : v}`;
  }
}

export function table({ columns, rows, empty = null, sort = null, dir = 'asc', sortUrl = null, rowHref = null, cls = '' }) {
  if (!rows.length) return empty || html`<p class="muted">Nothing here yet.</p>`;
  const head = columns.map((c) => {
    const sorted = sort === c.key;
    const label = sortUrl && c.sortable !== false
      ? html`<a href="${sortUrl(c.key, sorted && dir === 'asc' ? 'desc' : 'asc')}" class="sort${sorted ? ` sort-${dir}` : ''}">${c.label}</a>`
      : c.label;
    return html`<th${attrs({ scope: 'col', class: c.align === 'right' ? 'right' : null, 'aria-sort': sorted ? (dir === 'asc' ? 'ascending' : 'descending') : null })}>${label}</th>`;
  });
  const body = rows.map((row) => html`<tr${attrs({ class: row.__rowClass || null })}>${columns.map((c, i) => {
    const content = c.render ? c.render(row) : row[c.key];
    const cell = i === 0 && rowHref ? html`<a href="${rowHref(row)}" class="row-link">${content}</a>` : content;
    return html`<td${attrs({ class: c.align === 'right' ? 'right' : null, 'data-label': c.label })}>${cell}</td>`;
  })}</tr>`);
  return html`<div class="table-wrap"><table${attrs({ class: `table ${cls}`.trim() })}><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

/** Table columns for resource fields, using formatValue. */
export const fieldColumns = (fields) => fields.map((f) => ({
  key: f.key, label: f.label, align: ['money', 'number', 'int', 'percent'].includes(f.type) ? 'right' : null, render: (row) => formatValue(f, row),
}));

export function pagination({ page, pages, total, url }) {
  if (pages <= 1) return '';
  return html`<nav class="pager" aria-label="Pages"><span class="muted">${total} records · page ${page} of ${pages}</span>${
    page > 1 ? button('← Previous', { href: url(page - 1), size: 'sm' }) : ''
  }${page < pages ? button('Next →', { href: url(page + 1), size: 'sm' }) : ''}</nav>`;
}

export function filterBar({ action, q = '', hidden = {}, filters = [], values = {}, extra = '' }) {
  const active = !blank(q) || Object.values(values).some((v) => !blank(v));
  return html`<form method="get" action="${action}" class="filter-bar" role="search">${Object.entries(hidden).map(
    ([k, v]) => (blank(v) ? '' : html`<input type="hidden" name="${k}" value="${v}">`),
  )}<label class="sr-only" for="q">Search</label><input type="search" id="q" name="q" value="${q}" placeholder="Search…">${filters.map(
    (f) => html`<label class="sr-only" for="flt-${f.key}">${f.label}</label><select id="flt-${f.key}" name="f_${f.key}" data-autosubmit><option value="">${f.label}: all</option>${f.options.map((o) => {
      const val = typeof o === 'object' ? o.value : o;
      return html`<option${attrs({ value: val, selected: String(values[f.key] ?? '') === String(val) })}>${typeof o === 'object' ? o.label : o}</option>`;
    })}</select>`,
  )}${button('Search', { size: 'sm' })}${active ? button('Clear', { href: urlWith(action, hidden), variant: 'ghost', size: 'sm' }) : ''}${extra}</form>`;
}

const formValue = (f, v) => {
  if (v === null || v === undefined) return '';
  if (f.type === 'money' && typeof v === 'number') return v.toFixed(2);
  return v;
};

export function formField(ctx, f, value, error, { idPrefix = 'f' } = {}) {
  const id = `${idPrefix}-${f.key}`;
  const help = f.help ? html`<p class="help" id="${id}-help">${f.help}</p>` : '';
  const err = error ? html`<p class="field-error" id="${id}-err">${error}</p>` : '';
  const describedBy = [f.help && `${id}-help`, error && `${id}-err`].filter(Boolean).join(' ') || null;
  const wrap = (inner, extraCls = '') => html`<div${attrs({ class: `field${extraCls}${error ? ' has-error' : ''}${f.wide ? ' field-wide' : ''}` })}>${inner}${help}${err}</div>`;
  const req = f.required ? html` <span class="req" aria-hidden="true">*</span>` : '';
  const common = {
    id, name: f.key, 'aria-invalid': error ? 'true' : null, 'aria-describedby': describedBy, required: Boolean(f.required), placeholder: f.placeholder || null,
  };
  const v = formValue(f, value);
  const res = ctx.services.resources;
  if (f.type === 'bool') {
    const on = value === true || value === 1 || value === '1' || value === 'on';
    return wrap(html`<input type="hidden" name="${f.key}" value="0"><label class="check"><input${attrs({ type: 'checkbox', id, name: f.key, value: '1', checked: on, 'aria-describedby': describedBy })}> <span>${f.label}</span></label>`, ' field-check');
  }
  if (f.type === 'multiselect' || f.type === 'refs') {
    const cur = new Set((Array.isArray(value) ? value : []).map(String));
    const opts = f.type === 'refs'
      ? [...res.labelMap(ctx, f.ref).entries()].map(([k, label]) => ({ value: k, label })).sort((a, b) => String(a.label).localeCompare(String(b.label), 'en-GB', { numeric: true }))
      : res.options(f, ctx).map((o) => (o && typeof o === 'object' ? o : { value: o, label: o }));
    const boxes = opts.length
      ? opts.map((o, i) => html`<label class="check"><input${attrs({ type: 'checkbox', id: `${id}-${i}`, name: `${f.key}[]`, value: o.value, checked: cur.has(String(o.value)) })}> <span>${o.label}</span></label>`)
      : html`<p class="muted small">Nothing to choose from yet.</p>`;
    return wrap(html`<fieldset${attrs({ class: 'checks', 'aria-describedby': describedBy })}><legend>${f.label}${req}</legend><input type="hidden" name="${f.key}[]" value="">${boxes}</fieldset>`);
  }
  let control;
  if (f.type === 'textarea' || f.type === 'markdown') {
    control = html`<textarea${attrs({ ...common, rows: f.rows || (f.type === 'markdown' ? 12 : 4) })}>${v}</textarea>`;
  } else if (f.type === 'select' || f.type === 'ref') {
    const opts = f.type === 'ref'
      ? [...res.labelMap(ctx, f.ref).entries()].map(([k, label]) => ({ value: k, label })).sort((a, b) => String(a.label).localeCompare(String(b.label), 'en-GB', { numeric: true }))
      : res.options(f, ctx).map((o) => (o && typeof o === 'object' ? o : { value: o, label: o }));
    control = html`<select${attrs(common)}><option value="">${f.required ? 'Choose…' : '—'}</option>${opts.map(
      (o) => html`<option${attrs({ value: o.value, selected: String(o.value) === String(v) })}>${o.label}</option>`,
    )}</select>`;
  } else {
    const type = f.inputType || { email: 'email', url: 'url', phone: 'tel', date: 'date' }[f.type] || 'text';
    const inputmode = { money: 'decimal', number: 'decimal', percent: 'decimal', int: 'numeric' }[f.type] || null;
    control = html`<input${attrs({ ...common, type, value: v, inputmode, autocomplete: f.autocomplete || null, maxlength: f.max && type === 'text' && !inputmode ? f.max : null })}>`;
    if (f.type === 'money') control = html`<div class="input-affix"><span class="affix">£</span>${control}</div>`;
    if (f.type === 'percent') control = html`<div class="input-affix">${control}<span class="affix">%</span></div>`;
  }
  return wrap(html`<label for="${id}">${f.label}${req}</label>${control}`);
}

/** A record form. Fields with a `group` get a section heading when the group changes. */
export function recordForm(ctx, { action, fields, values = {}, errors = {}, submit = 'Save', cancel = null, intro = '', extra = '', multipart = false }) {
  const parts = [];
  let group = null;
  for (const f of fields) {
    if (f.group && f.group !== group) {
      group = f.group;
      parts.push(html`<h3 class="form-section">${group}</h3>`);
    }
    parts.push(formField(ctx, f, values[f.key], errors?.[f.key]));
  }
  const n = Object.keys(errors || {}).length;
  return html`<form${attrs({ method: 'post', action, class: 'form', enctype: multipart ? 'multipart/form-data' : null })}>${csrfField(ctx)}${
    n ? alert(errors._form || 'Please check the highlighted fields.', 'red') : ''
  }${intro}<div class="form-grid">${parts}</div>${extra}<div class="form-actions">${button(submit, { variant: 'primary' })}${
    cancel ? button('Cancel', { href: cancel, variant: 'ghost' }) : ''
  }</div></form>`;
}

export function detailList(fields, row) {
  return html`<dl class="details">${fields.filter((f) => !f.hidden).map(
    (f) => html`<div${attrs({ class: ['markdown', 'textarea'].includes(f.type) || f.wide ? 'detail detail-wide' : 'detail' })}><dt>${f.label}</dt><dd>${formatValue(f, row)}</dd></div>`,
  )}</dl>`;
}

export const timeline = (items) => html`<ol class="timeline">${items.map(
  (it) => html`<li><div class="tl-meta">${it.when}${it.who ? html` · ${it.who}` : ''}${it.tag ? html` ${it.tag}` : ''}</div><div class="tl-body">${it.body}</div></li>`,
)}</ol>`;

export const progress = (value, max = 100, label = 'Progress') =>
  html`<progress class="progress" value="${Math.max(0, Math.min(Number(value) || 0, max))}" max="${max}" aria-label="${label}">${Math.round(((Number(value) || 0) / max) * 100)}%</progress>`;

/** A simple SVG bar chart (no inline styles, so it works under the CSP) with a screen-reader table. */
export function barChart(items, { format = (v) => String(v), label = 'Chart', height = 140 } = {}) {
  if (!items.length) return '';
  const max = Math.max(...items.map((i) => Number(i.value) || 0), 1);
  const step = 48;
  const bars = items.map((it, i) => {
    const val = Number(it.value) || 0;
    const h = Math.max(Math.round((val / max) * height), val > 0 ? 2 : 1);
    return html`<g><rect class="bar bar-${tone(it.tone || 'blue')}" x="${i * step + 8}" y="${height - h + 6}" width="32" height="${h}" rx="3"><title>${it.label}: ${format(val)}</title></rect><text class="bar-label" x="${i * step + 24}" y="${height + 24}" text-anchor="middle">${it.short ?? it.label}</text></g>`;
  });
  const rows = items.map((it) => html`<tr><th scope="row">${it.label}</th><td>${format(Number(it.value) || 0)}</td></tr>`);
  return html`<figure class="chart"><svg viewBox="0 0 ${items.length * step + 16} ${height + 32}" role="img" aria-label="${label}">${bars}</svg><figcaption class="sr-only">${label}</figcaption><table class="sr-only"><tbody>${rows}</tbody></table></figure>`;
}

export { fmtGBP, fmtDateUK, fmtNumber };
