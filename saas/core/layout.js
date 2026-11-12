// Page shells: public marketing pages, auth screens, the signed-in app, printable documents and error pages.
import { html, raw, attrs, render, flashes, alert, button, csrfField, postButton, tone } from './ui.js';
import { roleRank, ROLE_LABELS } from './auth.js';
import { icon, hasIcon } from './icons.js';

export const ASSET_VERSION = '3.0.0';

export function documentShell(def, { title, description = '', body, bodyClass = '', styles = [], preloadDisplay = false, canonical = null, image = null, jsonLd = null }) {
  const theme = def.theme?.css ? html`<link rel="stylesheet" href="/static/${def.theme.css}?v=${ASSET_VERSION}">` : '';
  const icon = def.theme?.favicon ? `/static/${def.theme.favicon}` : '/assets/favicon.svg';
  const extra = styles.map((href) => html`<link rel="stylesheet" href="${href}?v=${ASSET_VERSION}">`);
  // Preloading the text face avoids a visible font swap on first paint; the display face is only needed on public pages.
  const preload = html`<link rel="preload" href="/assets/fonts/inter-var.woff2?v=2" as="font" type="font/woff2" crossorigin>${
    preloadDisplay ? html`<link rel="preload" href="/assets/fonts/source-serif-4-var.woff2?v=2" as="font" type="font/woff2" crossorigin>` : ''
  }`;
  return `<!doctype html>\n${render(html`<html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>${
    description ? html`<meta name="description" content="${description}">` : ''
  }${
    description ? html`<meta property="og:site_name" content="${def.name}"><meta property="og:type" content="website"><meta property="og:title" content="${title}"><meta property="og:description" content="${description}">${
      canonical ? html`<meta property="og:url" content="${canonical}">` : ''
    }${image ? html`<meta property="og:image" content="${image}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">` : ''}<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">` : ''
  }${canonical ? html`<link rel="canonical" href="${canonical}">` : ''}${
    // A data block, not a script: CSP doesn't apply, and '<' is escaped so the JSON can't close the tag.
    jsonLd ? raw(`<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>`) : ''
  }<meta name="theme-color" content="${def.theme?.color || '#0f5f4a'}"><link rel="icon" href="${icon}" type="image/svg+xml">${preload}<link rel="stylesheet" href="/assets/core.css?v=${ASSET_VERSION}">${extra}${theme}<link rel="stylesheet" href="/assets/print.css?v=${ASSET_VERSION}" media="print"><script src="/assets/core.js?v=${ASSET_VERSION}" defer></script></head><body${attrs({ class: bodyClass || null })}>${body}</body></html>`)}`;
}

export const logo = (def) => html`<span class="logo" aria-hidden="true">${def.logoSvg ? raw(def.logoSvg) : def.logoText || def.name.slice(0, 1)}</span>`;
const initials = (s) => String(s || '?').split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';

const DEFAULT_FOOTER = [
  { title: 'Product', links: [{ label: 'Pricing', href: '/pricing' }, { label: 'Try the demo', href: '/demo' }, { label: 'Start free trial', href: '/signup' }] },
  { title: 'Company', links: [{ label: 'Contact', href: '/contact' }, { label: 'Log in', href: '/login' }] },
  { title: 'Legal', links: [{ label: 'Terms', href: '/terms' }, { label: 'Privacy', href: '/privacy' }] },
];

export function publicPage(def, ctx, { title = null, description = null, body, narrow = false, jsonLd = null }) {
  const base = ctx?.services?.config?.BASE_URL || '';
  const canonical = base ? `${base}${ctx.path || '/'}` : null;
  const image = base && def.theme?.ogImage ? `${base}/static/${def.theme.ogImage}` : null;
  const links = def.marketing?.nav || [{ label: 'Features', href: '/#features' }, { label: 'Pricing', href: '/pricing' }, { label: 'Demo', href: '/demo' }];
  const ctaLabel = def.marketing?.cta || 'Start free trial';
  const here = ctx?.path || '';
  const navLink = (l) => html`<a${attrs({ href: l.href, 'aria-current': l.href === here ? 'page' : null })}>${l.label}</a>`;
  const actions = ctx?.user
    ? button('Open app', { href: '/app', variant: 'primary', size: 'sm' })
    : html`<a class="site-login" href="/login">Log in</a>${button(ctaLabel, { href: '/signup', variant: 'primary', size: 'sm' })}`;
  const menu = html`<details class="site-menu"><summary aria-label="Menu">${icon('menu')}</summary><div class="site-menu-panel">${links.map(navLink)}${
    ctx?.user ? button('Open app', { href: '/app', variant: 'primary' }) : html`<a href="/login">Log in</a>${button(ctaLabel, { href: '/signup', variant: 'primary' })}`
  }</div></details>`;
  const header = html`<header class="site-header"><div class="container site-header-row"><a class="brand" href="/">${logo(def)}<span>${def.name}</span></a><nav class="site-nav" aria-label="Site">${links.map(
    navLink,
  )}</nav><div class="site-actions">${actions}${menu}</div></div></header>`;
  const columns = def.marketing?.footer || DEFAULT_FOOTER;
  const footer = html`<footer class="site-footer"><div class="container"><div class="footer-grid"><div class="footer-brand"><a class="brand" href="/">${logo(def)}<span>${def.name}</span></a><p>${def.tagline}</p></div>${columns.map(
    (c) => html`<nav class="footer-col" aria-label="${c.title}"><h2>${c.title}</h2><ul>${c.links.map((l) => html`<li><a href="${l.href}">${l.label}</a></li>`)}</ul></nav>`,
  )}</div><div class="footer-base"><p>© ${new Date().getFullYear()} ${def.company || def.name}</p>${def.footerNote ? html`<p>${def.footerNote}</p>` : ''}</div></div></footer>`;
  return documentShell(def, {
    title: title ? `${title} · ${def.name}` : `${def.name} · ${def.tagline}`,
    description: description || def.description,
    bodyClass: 'public',
    styles: ['/assets/marketing.css'],
    preloadDisplay: true,
    canonical,
    image,
    jsonLd,
    body: html`<a class="skip" href="#main">Skip to content</a>${header}<main id="main"${attrs({ class: narrow ? 'public-main container narrow' : 'public-main' })}>${flashes(ctx?.flash)}${body}</main>${footer}`,
  });
}

export function authPage(def, ctx, { title, intro = null, body, footer = null, aside = null }) {
  const card = html`<div class="auth-card"><h1>${title}</h1>${intro ? html`<p class="muted">${intro}</p>` : ''}${body}</div>${footer ? html`<p class="auth-foot">${footer}</p>` : ''}`;
  return publicPage(def, ctx, {
    title,
    body: aside
      ? html`<div class="auth-wrap auth-wrap-split"><div class="auth-split"><div class="auth-main">${card}</div><aside class="auth-aside">${aside}</aside></div></div>`
      : html`<div class="auth-wrap">${card}</div>`,
  });
}

export function navSections(ctx) {
  const def = ctx.definition;
  const main = (typeof def.nav === 'function' ? def.nav(ctx) : def.nav) || [
    { id: 'dashboard', label: 'Dashboard', href: '/app' },
    ...ctx.services.resources.all.filter((r) => r.nav !== false).map((r) => ({ id: r.name, label: r.label, href: `/app/${r.name}` })),
  ];
  const ws = [
    { id: 'settings', label: 'Settings', href: '/app/settings' },
    { id: 'team', label: 'Team', href: '/app/team' },
    { id: 'billing', label: 'Billing', href: '/app/billing' },
    { id: 'activity', label: 'Activity', href: '/app/activity' },
  ];
  return [{ label: def.navLabel || def.name, items: main }, { label: 'Workspace', items: ws }];
}

function activeId(ctx, sections, explicit) {
  if (explicit) return explicit;
  let best = null;
  let bestLen = -1;
  for (const s of sections) {
    for (const it of s.items) {
      const p = it.href.split('?')[0];
      const hit = p === '/app' ? ctx.path === '/app' : ctx.path === p || ctx.path.startsWith(`${p}/`);
      if (hit && p.length > bestLen) {
        best = it.id;
        bestLen = p.length;
      }
    }
  }
  return best;
}

export function appPage(ctx, { title, body, active = null }) {
  const def = ctx.definition;
  const sections = navSections(ctx);
  const on = activeId(ctx, sections, active);
  const access = ctx.access || {};
  const isAdmin = roleRank(ctx.role) >= roleRank('admin');
  const orgs = ctx.services.auth.userOrgs(ctx.user.id);
  const switcher = orgs.length > 1
    ? html`<form method="post" action="/app/switch" class="org-switch">${csrfField(ctx)}<label class="sr-only" for="org-switch">Switch workspace</label><select id="org-switch" name="org" data-autosubmit>${orgs.map(
      (o) => html`<option${attrs({ value: o.id, selected: o.id === ctx.org.id })}>${o.name}</option>`,
    )}</select><noscript>${button('Switch', { size: 'sm' })}</noscript></form>`
    : html`<p class="org-name" title="${ctx.org.name}">${ctx.org.name}</p>`;
  const nav = sections.map((s) => html`<div class="nav-section"><p class="nav-label">${s.label}</p><ul>${s.items.map(
    (it) => html`<li><a${attrs({ href: it.href, class: it.id === on ? 'nav-link active' : 'nav-link', 'aria-current': it.id === on ? 'page' : null })}>${
      hasIcon(it.icon || it.id) ? icon(it.icon || it.id) : ''
    }<span>${it.label}</span>${it.count ? html`<span class="count">${it.count}</span>` : ''}</a></li>`,
  )}</ul></div>`);
  const current = sections.flatMap((s) => s.items).find((it) => it.id === on);
  const banners = [];
  if (ctx.org.is_demo) {
    const days = def.demoDays ?? 2;
    banners.push(alert(html`You're exploring a demo workspace filled with fictional SAMPLE data. It is deleted automatically after ${days === 2 ? '48 hours' : `${days} day${days === 1 ? '' : 's'}`}. <a href="/signup">Create your own workspace</a> to keep your work.`, 'blue', 'Demo.'));
  }
  if (access.warning) {
    banners.push(alert(html`${access.warning} ${isAdmin ? html`<a href="/app/billing">Open Billing</a>` : 'Ask a workspace admin to update billing.'}`, access.ok ? 'orange' : 'red'));
  }
  if (!ctx.org.is_demo && ctx.path === '/app' && isAdmin) {
    const n = ctx.services.resources.sampleCount(ctx.org.id);
    if (n) {
      banners.push(html`<div class="alert alert-yellow sample-banner" role="note"><span><strong>Sample data.</strong> This workspace includes ${n} fictional SAMPLE records so you can explore. Remove them when you're ready to add your own.</span>${
        postButton(ctx, '/app/settings/remove-samples', 'Remove sample data', { size: 'sm', confirm: 'Remove all SAMPLE records? Your own records are kept.' })
      }</div>`);
    }
  }
  const foot = html`<div class="sidebar-foot"><a class="user-link" href="/app/account"><span class="avatar" aria-hidden="true">${initials(ctx.user.name || ctx.user.email)}</span><span class="user-meta"><span class="user-name">${
    ctx.user.name || ctx.user.email
  }</span><span class="muted small">${ROLE_LABELS[ctx.role] || ctx.role}</span></span></a><form method="post" action="/logout" class="inline-form">${csrfField(ctx)}${
    button(html`${icon('logout')}<span class="sr-only">Log out</span>`, { variant: 'ghost', size: 'sm', extra: { title: 'Log out' } })
  }</form></div>`;
  const crumb = current && current.label !== title ? html`<span class="topbar-crumb" aria-hidden="true">/</span><span class="topbar-title">${current.label}</span>` : '';
  const search = def.search
    ? html`<form class="topbar-search" method="get" action="/app/search" role="search">${icon('search')}<label class="sr-only" for="topbar-q">Search</label><input type="search" id="topbar-q" name="q" autocomplete="off" placeholder="${def.search.placeholder || 'Search'}" value="${ctx.path === '/app/search' ? String(ctx.query?.q ?? '') : ''}"></form>`
    : '';
  const canCreate = def.quickCreate && roleRank(ctx.role) >= roleRank('member') && !access.readOnly;
  const quick = canCreate ? button(html`${icon('plus')}<span>${def.quickCreate.label}</span>`, { href: def.quickCreate.href, variant: 'primary', size: 'sm', extra: { class: 'btn btn-primary btn-sm topbar-new' } }) : '';
  const shell = html`<a class="skip" href="#main">Skip to content</a><div class="shell"><aside class="sidebar" id="sidebar"><div class="sidebar-top"><a class="brand" href="/app">${logo(def)}<span>${def.name}</span></a>${switcher}</div><nav class="nav" aria-label="Main">${nav}</nav>${foot}</aside><div class="main-col"><header class="topbar"><button type="button" class="btn btn-ghost btn-sm nav-toggle" data-toggle="sidebar" aria-controls="sidebar" aria-expanded="false">${icon('menu')}<span>Menu</span></button><span class="topbar-org">${
    ctx.org.name
  }</span>${crumb}${search}<div class="topbar-actions">${access.label ? html`<a class="badge badge-${tone(access.tone)} plan-badge" href="/app/billing">${access.label}</a>` : ''}${quick}</div></header><main id="main" class="main">${banners}${flashes(ctx.flash)}${body}</main></div></div>`;
  return documentShell(def, { title: `${title} · ${def.name}`, bodyClass: 'app', body: shell });
}

/** A clean document page (letters, packs, SOP prints) with a toolbar that is hidden when printing. */
export function printPage(ctx, { title, body, back = null, actions = [] }) {
  return documentShell(ctx.definition, {
    title: `${title} · ${ctx.definition.name}`,
    bodyClass: 'print-page',
    preloadDisplay: true,
    body: html`<div class="print-toolbar no-print">${back ? button('← Back', { href: back, variant: 'ghost', size: 'sm' }) : ''}${actions}<button type="button" class="btn btn-primary btn-sm" data-print>Print or save as PDF</button></div><article class="doc">${body}</article>`,
  });
}

const TITLES = {
  400: 'Something was wrong with that request', 401: 'Please log in', 402: 'Your plan limit has been reached', 403: "You don't have access to this",
  404: 'Page not found', 405: 'That action is not allowed here', 409: 'That clashes with existing data', 410: 'This link has expired',
  413: 'That is too large', 415: 'That file type is not supported', 422: 'Please check your input', 429: 'Too many attempts',
  500: 'Something went wrong', 502: 'A connected service had a problem', 503: 'Temporarily unavailable',
};
export const statusTitle = (status) => TITLES[status] || 'Something went wrong';

export function errorPage(ctx, status, message) {
  const title = statusTitle(status);
  const home = ctx?.user && ctx?.org;
  const body = html`<div class="error-page"><p class="error-code">Error ${status}</p><h1>${title}</h1>${message && message !== title ? html`<p>${message}</p>` : ''}<p>${
    button(home ? 'Back to the app' : 'Back to the home page', { href: home ? '/app' : '/', variant: 'secondary' })
  }</p></div>`;
  if (home) return appPage(ctx, { title, body });
  return publicPage(ctx.definition, ctx, { title, body, narrow: true });
}
