// Signed-in pages: dashboard, chase list and board, calendar feed, compose and send, letters, statements and reports.
import { HttpError, addDays, daysBetween, fmtDateUK, fmtGBP, isEmail, isISODate, mdToHtml, nowISO, renderMerge, round2, todayISO, randomToken } from '../../../core/util.js';
import { html, raw, join, card, stats, pageHeader, button, postButton, table, badge, alert, tabs, barChart, csrfField, attrs, emptyState } from '../../../core/ui.js';
import { appPage, printPage } from '../../../core/layout.js';
import { requireRole, can } from '../../../core/crud.js';
import { allInvoices, base, nextBadge, templateFor, requireFound, CONSUMER } from '../resources.js';
import { STAGES, SKIPPED, stageLabel, whenLabel, ladderBands, daysLabel } from '../lib/ladder.js';
import { mergeValues, unfilled, instalments, MERGE_FIELDS } from '../lib/templates.js';
import { rateCheck, fmtShort } from '../lib/calc.js';
import { SOURCES } from '../lib/docs.js';

const live = (i) => !i.fig.settled && i.status !== 'Written off';
export const isComplete = (ctx) => ctx.services.billing.can(ctx.org, 'complete');
const gbp = (n) => fmtGBP(n || 0);
/** "today", "tomorrow", "in 3 days" read mid-sentence; a date such as "15 Nov 2026" keeps its capital letter. */
const inWords = (on, today) => {
  const w = whenLabel(on, today);
  return /^(Today|Tomorrow|Yesterday|In )/.test(w) ? w.charAt(0).toLowerCase() + w.slice(1) : w;
};

export function upgradeCard(ctx, what) {
  const admin = can(ctx, 'owner');
  return card({
    title: `${what} is part of the Complete plan`,
    cls: 'callout',
    body: html`<p>The Complete plan adds the interest claim and letter before action templates, customer statements, payment plan agreements, the credit policy builder and monthly reports.</p><p>${admin ? button('See plans', { href: '/app/billing', variant: 'primary' }) : html`<span class="muted">Ask the workspace owner to upgrade.</span>`}</p>`,
  });
}

function actionItem(ctx, i, { showDate = false } = {}) {
  const n = i.next;
  const writable = can(ctx, 'member');
  const buttons = [];
  if (writable && n.template) buttons.push(button(n.template === '5' ? 'Write letter' : 'Write email', { href: `/app/invoices/${i.id}/compose?t=${n.template}`, size: 'sm', variant: 'primary' }));
  if (writable && (n.stage >= 2 || ['broken', 'promise', 'plan', 'dispute', 'follow-up'].includes(n.kind))) {
    buttons.push(button('Log a call', { href: `/app/chases/new?invoice=${i.id}&channel=Phone${n.stage !== null ? `&stage=${encodeURIComponent(stageLabel(n.stage))}` : ''}`, size: 'sm' }));
  }
  return html`<li class="action-item"><div><a href="/app/invoices/${i.id}"><strong>${i.number}</strong></a> · ${i.customer__label || ''}<div class="action-meta">${gbp(i.balance)} · ${
    i.days_overdue ? `${daysLabel(i.days_overdue)} overdue` : i.fig.daysToDue !== null ? `due ${inWords(i.due_date, n.today)}` : ''
  }${showDate && n.on ? html` · ${whenLabel(n.on, n.today)}` : ''}</div><div>${badge(n.label, n.tone)}</div></div><div class="page-actions">${buttons}</div></li>`;
}

const actionList = (ctx, list, opts) => (list.length ? html`<ul class="action-list">${list.map((i) => actionItem(ctx, i, opts))}</ul>` : html`<p class="muted">Nothing to do here.</p>`);
const byWhen = (a, b) => (a.next.on < b.next.on ? -1 : a.next.on > b.next.on ? 1 : (b.next.stage ?? -1) - (a.next.stage ?? -1));

/**
 * Reminder emails due now, in order, for "work through the list". Templates the plan doesn't include are left out:
 * opening one shows an upgrade card with no way to skip, which would trap the queue.
 */
function dueEmails(ctx) {
  const complete = isComplete(ctx);
  return allInvoices(ctx)
    .filter((i) => live(i) && i.next.now && i.next.template && i.next.template !== '5' && (complete || !templateFor(ctx, i.next.template)?.complete_only))
    .sort(byWhen);
}

/** Setup steps for a new workspace, shown on the dashboard until every one is done. */
export function onboarding(ctx) {
  const { db, resources } = ctx.services;
  const s = ctx.org.settings || {};
  const org = ctx.org.id;
  const n = (sql) => db.get(sql, org).n;
  const steps = [
    { id: 'details', title: 'Add your business details', text: 'Your name, phone and bank details go into every reminder.', done: Boolean(s.company_name && s.bank_details), href: '/app/settings', cta: 'Open Settings' },
    { id: 'customer', title: 'Add your first customer', text: 'Legal name, accounts contact, payment terms and a credit limit.', done: n('SELECT COUNT(*) AS n FROM r_customers WHERE org_id = ? AND is_sample = 0') > 0, href: '/app/customers/new', cta: 'Add a customer' },
    { id: 'invoice', title: 'Add your unpaid invoices', text: 'Type them in or import a CSV from your accounting software.', done: n('SELECT COUNT(*) AS n FROM r_invoices WHERE org_id = ? AND is_sample = 0') > 0, href: '/app/invoices/new', cta: 'Add an invoice', alt: { href: '/app/invoices/import', label: 'Import CSV' } },
    { id: 'reminder', title: 'Send your first reminder', text: 'Open the chase list, check the wording and send. It is logged for you.', done: n(`SELECT COUNT(*) AS n FROM r_chases WHERE org_id = ? AND is_sample = 0 AND COALESCE(outcome, '') != '${SKIPPED}'`) > 0, href: '/app/chase', cta: 'Open the chase list' },
    { id: 'calendar', title: 'Put the chase list in your calendar', text: 'Subscribe once and every next action appears on the right day.', done: Boolean(db.kvGet(`onboard:${org}:calendar`)), href: '/app/chase/calendar', cta: 'Get the link' },
    { id: 'samples', title: 'Remove the sample data', text: 'Once your own invoices are in, clear the fictional SAMPLE records.', done: resources.sampleCount(org) === 0, href: '/app/settings', cta: 'Open Settings' },
  ];
  const done = steps.filter((x) => x.done).length;
  if (done === steps.length || ctx.org.is_demo) return '';
  return html`<section class="onboarding card"><div class="card-head"><h2>Set up in 15 minutes</h2><div class="card-actions"><span class="muted small">${done} of ${steps.length} done</span></div></div><div class="card-body"><ol class="onboard-list">${steps.map((x, i) => html`<li${attrs({ class: x.done ? 'onboard-step done' : 'onboard-step' })}><span class="onboard-num" aria-hidden="true">${x.done ? '✓' : i + 1}</span><div class="onboard-text"><strong>${x.title}</strong><span class="muted small">${x.text}</span></div>${
    x.done ? '' : html`<div class="page-actions">${button(x.cta, { href: x.href, size: 'sm', variant: 'primary' })}${x.alt ? button(x.alt.label, { href: x.alt.href, size: 'sm' }) : ''}</div>`
  }</li>`)}</ol></div></section>`;
}

export function dashboard(ctx) {
  const b = base(ctx);
  const all = allInvoices(ctx);
  const open = all.filter(live);
  const t = b.today;
  const overdue = open.filter((i) => i.days_overdue > 0);
  const now = open.filter((i) => i.next.now && i.next.kind !== 'promise').sort(byWhen);
  const soon = open.filter((i) => !i.next.now && i.next.on && i.next.on <= addDays(t, 7)).sort(byWhen);
  const claimable = round2(all.filter((i) => i.fig.claim && (live(i) || i.next.kind === 'paid-late')).reduce((s, i) => s + i.fig.claimable, 0));
  const broken = open.filter((i) => i.next.kind === 'broken');
  const disputed = open.filter((i) => i.status === 'Disputed');
  const sum = (list) => round2(list.reduce((s, i) => s + i.balance, 0));
  const head = pageHeader({
    title: 'Credit control',
    subtitle: `${ctx.org.name} · ${fmtDateUK(t, true)}`,
    actions: can(ctx, 'member') ? [button('Add invoice', { href: '/app/invoices/new', variant: 'primary', size: 'sm' }), button('Chase list', { href: '/app/chase', size: 'sm' })] : [],
  });
  if (!all.length) {
    return appPage(ctx, {
      title: 'Dashboard',
      active: 'dashboard',
      body: html`${head}${onboarding(ctx)}${card({ body: emptyState({ title: 'Add your unpaid invoices to get started', text: 'Add a customer and their invoices, or import a CSV from your accounting software. PaidOnTime then tells you what to send next and what you can claim.', action: html`${button('Add a customer', { href: '/app/customers/new', variant: 'primary' })} ${button('Import invoices', { href: '/app/invoices/import' })} ${button('Read Start here', { href: '/app/guides' })}` }) })}`,
    });
  }
  const buckets = [
    { label: 'Not due yet', short: 'Not due', test: (i) => i.days_overdue === 0, tone: 'green' },
    { label: '1–7 days', short: '1–7', test: (i) => i.days_overdue >= 1 && i.days_overdue <= 7, tone: 'blue' },
    { label: '8–14 days', short: '8–14', test: (i) => i.days_overdue >= 8 && i.days_overdue <= 14, tone: 'orange' },
    { label: '15–30 days', short: '15–30', test: (i) => i.days_overdue >= 15 && i.days_overdue <= 30, tone: 'orange' },
    { label: '31–45 days', short: '31–45', test: (i) => i.days_overdue >= 31 && i.days_overdue <= 45, tone: 'red' },
    { label: '46+ days', short: '46+', test: (i) => i.days_overdue >= 46, tone: 'red' },
  ].map((x) => ({ ...x, value: sum(open.filter(x.test)) }));
  const { resources } = ctx.services;
  const watch = resources.query(ctx, resources.get('customers'), { view: 'watch', all: true }).rows.slice(0, 5);
  const body = html`${head}${onboarding(ctx)}${stats([
    { label: 'Outstanding', value: gbp(sum(open)), hint: `${open.length} unpaid invoice${open.length === 1 ? '' : 's'}`, href: '/app/invoices', tone: 'blue' },
    { label: 'Overdue', value: gbp(sum(overdue)), hint: `${overdue.length} invoice${overdue.length === 1 ? '' : 's'}`, href: '/app/invoices?view=overdue', tone: overdue.length ? 'orange' : 'green' },
    { label: 'To chase now', value: String(now.length), hint: 'actions due today or earlier', href: '/app/chase', tone: now.length ? 'red' : 'green' },
    { label: 'You can claim', value: gbp(claimable), hint: 'statutory interest and compensation', href: '/app/invoices?view=claim', tone: 'purple' },
    { label: 'Broken promises', value: String(broken.length), href: '/app/invoices?view=broken', tone: broken.length ? 'red' : 'gray' },
    { label: 'In dispute', value: gbp(sum(disputed)), hint: `${disputed.length} invoice${disputed.length === 1 ? '' : 's'}`, href: '/app/invoices?view=disputed', tone: disputed.length ? 'orange' : 'gray' },
  ])}<div class="grid-2">${card({ title: `Do these now (${now.length})`, body: actionList(ctx, now.slice(0, 8)), footer: now.length > 8 ? html`<a href="/app/chase">See all ${now.length} on the chase list</a>` : null })}${card({ title: 'Coming up in the next 7 days', body: actionList(ctx, soon.slice(0, 8), { showDate: true }) })}</div><div class="grid-2">${card({
    title: 'Ageing of unpaid invoices',
    body: barChart(buckets, { format: gbp, label: 'Unpaid balance by days overdue' }),
  })}${card({
    title: 'Customers to watch',
    body: watch.length
      ? table({ columns: [{ key: 'name', label: 'Customer', render: (c) => html`<a href="/app/customers/${c.id}">${c.name}</a>` }, { key: 'outstanding', label: 'Outstanding', align: 'right', render: (c) => gbp(c.outstanding) }, { key: 'credit_check', label: 'Check', render: (c) => badge(c.credit_check, c.credit_tone) }], rows: watch })
      : html`<p class="muted">No customers over their limit or long overdue.</p>`,
    footer: html`<a href="/app/guides">Weekly routine</a> · <a href="/app/guides/sop">Credit control SOP</a>`,
  })}</div>`;
  return appPage(ctx, { title: 'Dashboard', active: 'dashboard', body });
}

function chaseTabs(active) {
  return tabs([
    { id: 'list', label: 'Chase list', href: '/app/chase' },
    { id: 'board', label: 'Board by stage', href: '/app/chase/board' },
    { id: 'calendar', label: 'Add to your calendar', href: '/app/chase/calendar' },
  ], active);
}

export function chaseList(ctx) {
  const b = base(ctx);
  const t = b.today;
  const open = allInvoices(ctx).filter((i) => live(i) && i.next.on).sort(byWhen);
  const groups = [];
  const late = open.filter((i) => i.next.on < t);
  if (late.length) groups.push({ title: 'Overdue actions', list: late });
  for (let d = 0; d <= 13; d++) {
    const day = addDays(t, d);
    const list = open.filter((i) => i.next.on === day);
    if (list.length || d === 0) groups.push({ title: d === 0 ? `Today, ${fmtDateUK(day)}` : d === 1 ? `Tomorrow, ${fmtDateUK(day)}` : fmtDateUK(day, true), list });
  }
  const later = open.filter((i) => i.next.on > addDays(t, 13));
  if (later.length) groups.push({ title: 'Later', list: later, showDate: true });
  const emailsDue = dueEmails(ctx).length;
  const actions = can(ctx, 'member') && emailsDue ? [button(`Send the ${emailsDue} due reminder${emailsDue === 1 ? '' : 's'} one by one`, { href: '/app/chase/next', variant: 'primary', size: 'sm' })] : [];
  const body = html`${pageHeader({ title: 'Chase list', subtitle: 'Every unpaid invoice\'s next action, in date order. Work through it on Monday and chase broken promises on Friday.', actions })}${chaseTabs('list')}${groups.map((g) => html`<section class="agenda-day"><h2 class="agenda-date">${g.title} <span class="count">${g.list.length}</span></h2>${actionList(ctx, g.list, { showDate: g.showDate })}</section>`)}`;
  return appPage(ctx, { title: 'Chase list', active: 'chase', body: html`<div class="agenda">${body}</div>` });
}

/** "Work through the list": opens the next due email reminder; after each send it comes back here. */
export function chaseNext(ctx) {
  requireRole(ctx, 'member');
  const queue = dueEmails(ctx);
  if (!queue.length) return { redirect: '/app/chase', flash: 'All caught up: no email reminders are due right now.' };
  const [first] = queue;
  return { redirect: `/app/invoices/${first.id}/compose?t=${first.next.template}&queue=${queue.length}` };
}

export function chaseBoard(ctx) {
  const open = allInvoices(ctx).filter(live);
  const cols = [
    { title: 'Not due yet', test: (i) => i.stage_now === 'Not due yet' && !['Disputed', 'On payment plan'].includes(i.status) },
    ...STAGES.map((s) => ({ title: stageLabel(s.n), test: (i) => i.stage_now === stageLabel(s.n) && !['Disputed', 'On payment plan'].includes(i.status) })),
    { title: 'Disputed', test: (i) => i.status === 'Disputed' },
    { title: 'On payment plan', test: (i) => i.status === 'On payment plan' },
  ];
  const cardFor = (i) => html`<li class="board-card"><a href="/app/invoices/${i.id}"><strong>${i.number}</strong></a><div class="small">${i.customer__label}</div><div class="small"><span class="num">${gbp(i.balance)}</span>${i.days_overdue ? ` · ${i.days_overdue}d overdue` : ''}</div><div>${nextBadge(i)}</div></li>`;
  const board = html`<div class="board">${cols.map((c) => {
    const list = open.filter(c.test);
    return html`<section class="board-col"><h3>${c.title} <span class="count">${list.length}</span></h3><p class="small muted">${gbp(round2(list.reduce((s, i) => s + i.balance, 0)))}</p><ul class="action-list">${list.map(cardFor)}</ul></section>`;
  })}</div>`;
  return appPage(ctx, { title: 'Board by stage', active: 'chase', body: html`${pageHeader({ title: 'Chase list', subtitle: 'Unpaid invoices by the stage their days overdue put them at.' })}${chaseTabs('board')}${board}` });
}

export function calendarPage(ctx) {
  const { config, db } = ctx.services;
  db.kvSet(`onboard:${ctx.org.id}:calendar`, nowISO());
  const url = `${config.BASE_URL}/feed/${ctx.org.feed_token}.ics`;
  const body = html`${pageHeader({ title: 'Chase list', subtitle: 'See every chase action in Google Calendar, Outlook or Apple Calendar.' })}${chaseTabs('calendar')}${card({
    title: 'Your chase calendar link',
    body: html`<p>Subscribe to this private link and each invoice's next action appears as an all-day event on the day it's due. Your calendar app refreshes it every few hours.</p><div class="inline-fields"><label class="sr-only" for="feed-url">Calendar link</label><input id="feed-url" value="${url}" readonly>${button('Copy link', { type: 'button', size: 'sm', extra: { 'data-copy-target': '#feed-url' } })}</div><ul class="checklist"><li><strong>Google Calendar:</strong> Other calendars → + → From URL, then paste the link.</li><li><strong>Outlook:</strong> Add calendar → Subscribe from web.</li><li><strong>Apple Calendar:</strong> File → New Calendar Subscription.</li></ul>${alert('Anyone with this link can see invoice numbers, customer names and amounts. Only share it with people who chase invoices for you.', 'yellow')}${
      can(ctx, 'admin') ? postButton(ctx, '/app/chase/calendar/reset', 'Create a new link', { size: 'sm', confirm: 'Create a new link? The old one stops working straight away.' }) : ''
    }`,
  })}`;
  return appPage(ctx, { title: 'Chase calendar', active: 'chase', body });
}

const icsText = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const icsDate = (iso) => iso.replace(/-/g, '');
/** RFC 5545 line folding: at most 75 octets a line (the space starting a continuation counts), never splitting a character. */
function fold(line) {
  const parts = [];
  let cur = '';
  let octets = 0;
  let limit = 75;
  for (const ch of line) {
    const size = Buffer.byteLength(ch);
    if (octets + size > limit) {
      parts.push(cur);
      cur = '';
      octets = 0;
      limit = 74;
    }
    cur += ch;
    octets += size;
  }
  parts.push(cur);
  return parts.join('\r\n ');
}

/** Public iCalendar feed of next actions, addressed by the workspace's secret feed token. */
export function icsFeed(ctx) {
  const { db, auth, config, definition } = ctx.services;
  const token = String(ctx.params.token || '');
  const row = /^[A-Za-z0-9_-]{16,64}$/.test(token) ? db.get('SELECT id FROM orgs WHERE feed_token = ?', token) : null;
  if (!row) throw new HttpError(404, 'Calendar not found');
  const fctx = { org: auth.getOrg(row.id), services: ctx.services, cache: {}, user: null, role: 'viewer' };
  const t = base(fctx).today;
  const stamp = `${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:-//${definition.name}//Chase calendar//EN`, 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${icsText(`${fctx.org.name}: chase list`)}`];
  for (const i of allInvoices(fctx).filter((x) => live(x) && x.next.on)) {
    const on = i.next.on < t ? t : i.next.on;
    lines.push(
      'BEGIN:VEVENT',
      `UID:${fctx.org.id}-${i.id}-${i.next.kind}-${i.next.stage ?? 'x'}@${definition.slug}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${icsDate(on)}`,
      `DTEND;VALUE=DATE:${icsDate(addDays(on, 1))}`,
      fold(`SUMMARY:${icsText(`${i.next.label}: ${i.number} (${i.customer__label || 'customer'})`)}`),
      fold(`DESCRIPTION:${icsText(`Balance ${gbp(i.balance)}, ${daysLabel(i.days_overdue)} overdue.\n${config.BASE_URL}/app/invoices/${i.id}`)}`),
      fold(`URL:${config.BASE_URL}/app/invoices/${i.id}`),
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return { body: `${lines.join('\r\n')}\r\n`, type: 'text/calendar; charset=utf-8', headers: { 'Cache-Control': 'private, max-age=900' } };
}

export function resetFeed(ctx) {
  requireRole(ctx, 'admin');
  ctx.services.db.run('UPDATE orgs SET feed_token = ? WHERE id = ?', randomToken(18), ctx.org.id);
  ctx.audit?.('settings', null, null, 'Chase calendar link replaced');
  return { redirect: '/app/chase/calendar', flash: 'New calendar link created. Update your calendar subscriptions.' };
}

/* ------------------------------------------------------------------ compose, send and letters */

function loadInvoice(ctx) {
  const { resources } = ctx.services;
  const inv = resources.find(ctx, resources.get('invoices'), ctx.params.id);
  const customer = resources.one(ctx.org.id, resources.get('customers'), inv.customer);
  const log = base(ctx).chases.get(inv.id) || [];
  return { inv, customer, log };
}

function planFrom(ctx, inv, src) {
  const n = Math.max(1, Math.min(24, Number(src.n) || 3));
  const first = isISODate(src.first) ? src.first : addDays(base(ctx).today, 7);
  return { n, first, list: instalments(inv.balance, n, first) };
}

function merged(ctx, { inv, customer, log }, tpl, src = {}) {
  const plan = tpl.code === 'plan' ? planFrom(ctx, inv, src) : null;
  const values = mergeValues({ org: ctx.org, user: ctx.user, inv, customer, fig: inv.fig, log, today: base(ctx).today, plan: plan?.list });
  return { subject: renderMerge(tpl.subject, values), body: renderMerge(tpl.body, values), plan };
}

function warnings(ctx, { inv, customer }, tpl, text) {
  const out = [];
  // A merge field that found no value needs details adding. Any other bracketed wording (Template 3's optional clause) is the writer's to keep or cut.
  // Each bracket is listed once: empty merge fields under "Still in brackets", optional wording in its own sentence.
  const known = new Set(MERGE_FIELDS.map((f) => f.toLowerCase()));
  const brackets = unfilled(text);
  const optional = brackets.filter((g) => !known.has(g.trim().toLowerCase()));
  const missing = brackets.filter((g) => known.has(g.trim().toLowerCase()));
  const codes = (list) => join(list.map((g) => html`<code>[${g}]</code>`), ' ');
  // A phone script is read aloud, not sent, and its [date] is a blank to fill in on the call.
  if (brackets.length && tpl.channel !== 'Phone script') {
    const notes = [];
    if (missing.length) notes.push(html`Still in brackets: ${codes(missing)}. Fill the missing details in below, or add them in <a href="/app/settings">Settings</a> or on the customer so they fill in next time.`);
    if (optional.length) notes.push(html`${codes(optional)} ${optional.length === 1 ? 'is' : 'are'} optional wording: keep ${optional.length === 1 ? 'it' : 'them'} or delete ${optional.length === 1 ? 'it' : 'them'}, brackets included.`);
    out.push(alert(html`${notes.map((a) => html`${a} `)}`, 'orange', 'Check before sending.'));
  }
  if (tpl.review) out.push(alert('Have a solicitor check this template before you first use it. It is general wording, not legal advice.', 'yellow', 'Solicitor review.'));
  if (inv.status === 'Disputed') out.push(alert('This invoice is disputed. Don\'t chase the disputed amount as if it were simply late: ask for the undisputed part instead.', 'orange'));
  if (customer?.customer_type === CONSUMER && ['4', '5'].includes(tpl.code)) out.push(alert('This customer is a consumer. Statutory interest and fixed compensation don\'t apply to consumer sales.', 'red'));
  if (customer?.customer_type === 'Sole trader' && tpl.code === '5') {
    out.push(alert(html`This customer is a sole trader, so the <a href="${SOURCES.pap}" rel="noopener noreferrer" target="_blank">Pre-Action Protocol for Debt Claims</a> applies: enclose its Information Sheet and Reply Form, and allow 30 days for a reply before starting court proceedings. The deadline below is set 30 days ahead. The protocol was updated from 1 October 2026 (for example, also emailing the letter to the debtor's personal email address if you have one), so check the current version.`, 'red', 'Pre-Action Protocol.'));
  }
  if (['4', '5'].includes(tpl.code) && !inv.claim_interest) out.push(alert('Statutory interest isn\'t being claimed on this invoice, so the interest and compensation figures are £0.', 'orange'));
  if (['4', '5'].includes(tpl.code) && inv.fig.reference.source === 'missing') out.push(alert(rateCheck(inv.fig.reference, { daysOverdue: inv.days_overdue }).text, 'orange'));
  return out;
}

function figuresCard(inv) {
  const f = inv.fig;
  const item = (label, value, tone = null) => html`<div class="figure"><span class="figure-label">${label}</span><span${attrs({ class: tone ? `figure-value text-${tone}` : 'figure-value' })}>${value}</span></div>`;
  const rc = rateCheck(f.reference, { claim: inv.claim_on ?? inv.claim_interest, daysOverdue: f.daysOverdue });
  return card({
    title: 'Figures',
    body: html`<div class="figures">${item('Amount', gbp(f.amount))}${item('Paid so far', gbp(f.paid))}${item('Balance', gbp(f.balance))}${f.credit > 0 ? item('Credit (overpaid)', gbp(f.credit), 'purple') : ''}${item('Days overdue', String(f.daysOverdue), f.daysOverdue ? 'orange' : null)}${
      item('Statutory interest', gbp(f.interest))}${item('Daily interest', gbp(f.dailyInterest))}${item('Fixed compensation', gbp(f.fixedSum))}${item('Total due', gbp(f.totalDue), f.claimable ? 'red' : null)
    }</div><p class="small"><span class="tone-dot text-${rc.tone}" aria-hidden="true">●</span> ${rc.text}${f.claim ? html` · ${f.annualRate}% a year` : ''}</p>`,
  });
}

export function invoiceDetail(ctx, inv) {
  const n = inv.next;
  const writable = can(ctx, 'member');
  const buttons = [];
  if (writable && live(inv)) {
    if (n.template) buttons.push(button(`Write ${STAGES[Number(n.template)].label.toLowerCase()}`, { href: `/app/invoices/${inv.id}/compose?t=${n.template}`, variant: 'primary', size: 'sm' }));
    buttons.push(button('Log a contact', { href: `/app/chases/new?invoice=${inv.id}${n.stage !== null ? `&stage=${encodeURIComponent(stageLabel(n.stage))}` : ''}`, size: 'sm' }));
    buttons.push(button('Record payment', { href: `/app/payments/new?invoice=${inv.id}&amount=${inv.balance.toFixed(2)}`, size: 'sm' }));
  }
  const notes = [];
  if (inv.customer_type === CONSUMER && inv.claim_interest) notes.push(alert('This customer is marked as a consumer. Statutory interest only applies between businesses.', 'red'));
  if (inv.customer_type === 'Sole trader' && inv.days_overdue >= base(ctx).L.stage4_from && live(inv)) notes.push(alert('Sole trader: the Pre-Action Protocol for Debt Claims applies before any court claim.', 'orange'));
  if (inv.fig.credit > 0) notes.push(alert(`The customer has paid ${gbp(inv.fig.credit)} more than this invoice. Refund it or set it against their next invoice; it also shows as a credit on their statement.`, 'blue', 'Overpaid.'));
  const next = card({
    title: 'Next action',
    body: html`<p class="lead">${badge(n.label, n.tone)}${n.on && !['closed', 'paid-late'].includes(n.kind) ? html` <span class="muted">${whenLabel(n.on, n.today)}${n.on !== n.today ? ` (${fmtShort(n.on)})` : ''}</span>` : ''}</p>${notes}${buttons.length ? html`<div class="page-actions">${buttons}</div>` : ''}`,
  });
  return html`${next}${figuresCard(inv)}`;
}

export function invoiceSide(ctx, inv) {
  if (!can(ctx, 'member')) return '';
  const { db } = ctx.services;
  const tpls = db.all('SELECT code, name, channel FROM r_templates WHERE org_id = ? ORDER BY code', ctx.org.id);
  return card({
    title: 'Templates',
    body: html`<ul class="link-list">${tpls.map((t) => html`<li><a href="/app/invoices/${inv.id}/compose?t=${encodeURIComponent(t.code)}">${t.code.length === 1 ? `${t.code} · ` : ''}${t.name}</a> <span class="muted small">${t.channel}</span></li>`)}</ul>`,
  });
}

export function customerDetail(ctx, c) {
  const item = (label, value) => html`<div class="figure"><span class="figure-label">${label}</span><span class="figure-value">${value}</span></div>`;
  const headroom = c.credit_limit !== null && c.credit_limit !== undefined ? round2(c.credit_limit - c.outstanding) : null;
  const stop = c.stop_suggested ? alert(html`Your policy says to pause new work for this account. ${can(ctx, 'member') ? 'Use “Put on stop” above once the customer has been told in writing.' : ''}`, 'red', 'Consider an account stop.') : '';
  return html`${card({
    title: 'Credit check',
    body: html`<p>${badge(c.credit_check, c.credit_tone)}</p>${stop}<div class="figures">${item('Outstanding', gbp(c.outstanding))}${item('Overdue', gbp(c.overdue))}${item('Credit limit', c.credit_limit === null || c.credit_limit === undefined ? '—' : gbp(c.credit_limit))}${
      item('Headroom', headroom === null ? '—' : gbp(headroom))}${item('Oldest overdue', c.oldest_overdue ? `${c.oldest_overdue} days` : '—')}${item('Average days late', c.avg_days_late === null ? '—' : String(c.avg_days_late))}${item('Claimable', gbp(c.claimable))}${c.credit > 0 ? item('Credit held', gbp(c.credit)) : ''
    }</div>`,
  })}`;
}

export function composePage(ctx, { values = null, error = null } = {}) {
  requireRole(ctx, 'member');
  const data = loadInvoice(ctx);
  const { inv, customer } = data;
  const code = String(values?.t || ctx.query.t || inv.next.template || '1');
  const tpl = requireFound(templateFor(ctx, code), 'Template');
  const { db } = ctx.services;
  const head = pageHeader({
    title: `${tpl.name}: ${inv.number}`,
    subtitle: `${customer?.name || ''} · balance ${gbp(inv.balance)}${inv.days_overdue ? ` · ${daysLabel(inv.days_overdue)} overdue` : ''}`,
    crumbs: [{ label: 'Invoices', href: '/app/invoices' }, { label: inv.number, href: `/app/invoices/${inv.id}` }, { label: 'Write' }],
  });
  const tpls = db.all('SELECT code, name FROM r_templates WHERE org_id = ? ORDER BY code', ctx.org.id);
  const picker = html`<form method="get" action="/app/invoices/${inv.id}/compose" class="filter-bar"><label for="pick-t">Template</label><select id="pick-t" name="t" data-autosubmit>${tpls.map((t) => html`<option${attrs({ value: t.code, selected: t.code === code })}>${t.code.length === 1 ? `${t.code} · ` : ''}${t.name}</option>`)}</select>${button('Use template', { size: 'sm' })}</form>`;
  if (tpl.complete_only && !isComplete(ctx)) return appPage(ctx, { title: tpl.name, active: 'invoices', body: html`${head}${picker}${upgradeCard(ctx, `The “${tpl.name}” template`)}` });
  const m = merged(ctx, data, tpl, values || ctx.query);
  const subject = values?.subject ?? m.subject;
  const text = values?.body ?? m.body;
  const isEmailTpl = tpl.channel === 'Email';
  let planForm = '';
  if (m.plan) {
    planForm = html`<form method="get" action="/app/invoices/${inv.id}/compose" class="inline-fields"><input type="hidden" name="t" value="plan"><label for="plan-n">Instalments</label><input id="plan-n" name="n" type="number" min="1" max="24" value="${m.plan.n}"><label for="plan-first">First payment</label><input id="plan-first" name="first" type="date" value="${m.plan.first}">${button('Work out instalments', { size: 'sm' })}</form>`;
  }
  const to = values?.to ?? customer?.accounts_email ?? '';
  const queue = Number(values?.queue ?? ctx.query.queue) || 0;
  const queueNote = queue ? alert(html`Working through the list: this is the first of <strong>${queue}</strong> due reminder${queue === 1 ? '' : 's'}. After you send it the next one opens. <a href="/app/chase">Stop and go back to the list</a>.`, 'blue') : '';
  const footerNote = isEmailTpl && emailFooter(ctx) ? html`<p class="help">Emails end with “${emailFooter(ctx)}”. The Complete plan removes it, or turn it off in Settings.</p>` : '';
  const form = tpl.channel === 'Phone script'
    ? html`<div class="prose">${raw(mdToHtml(text))}</div><div class="form-actions">${button('Log the call', { href: `/app/chases/new?invoice=${inv.id}&channel=Phone&stage=${encodeURIComponent(tpl.stage || '')}`, variant: 'primary' })}</div>`
    : html`<form method="post" action="/app/invoices/${inv.id}/compose" class="form compose">${csrfField(ctx)}<input type="hidden" name="t" value="${code}"><input type="hidden" name="queue" value="${queue || ''}">${error ? alert(error, 'red') : ''}<div class="form-grid">${
      isEmailTpl ? html`<div class="field"><label for="c-to">To</label><input id="c-to" name="to" type="email" value="${to}" required></div><div class="field"><label for="c-cc">Cc (optional)</label><input id="c-cc" name="cc" type="email" value="${values?.cc || ''}"></div>` : ''
    }<div class="field field-wide"><label for="c-subject">${isEmailTpl ? 'Subject' : 'Heading'}</label><input id="c-subject" name="subject" value="${subject}" required maxlength="300"></div><div class="field field-wide"><label for="c-body">Wording</label><textarea id="c-body" name="body" rows="20" required>${text}</textarea><p class="help">Edit anything before you send. Changes here don't alter the template.</p>${footerNote}</div></div><div class="form-actions">${
      isEmailTpl ? button(queue ? 'Send, log it and open the next' : 'Send email and log it', { variant: 'primary', name: 'send', value: '1' }) : ''
    }${button(isEmailTpl ? 'Print as a letter' : 'Open letter to print', { variant: isEmailTpl ? 'secondary' : 'primary', extra: { formaction: `/app/invoices/${inv.id}/letter` } })}${button('Copy wording', { type: 'button', extra: { 'data-copy-target': '#c-body' } })}${
      queue ? button('Skip this one', { variant: 'ghost', extra: { formaction: `/app/chase/skip/${inv.id}`, formnovalidate: true } }) : button('Cancel', { href: `/app/invoices/${inv.id}`, variant: 'ghost' })
    }</div></form>`;
  const body = html`${head}${picker}${queueNote}${warnings(ctx, data, tpl, `${subject}\n${text}`)}<div class="detail-grid"><div class="detail-main">${planForm ? card({ title: 'Instalments', body: planForm }) : ''}${card({ body: form })}</div><aside class="detail-side">${figuresCard(inv)}${card({ title: 'Merge fields', body: html`<p class="small muted">Use these in your templates:</p><p class="merge-fields">${MERGE_FIELDS.map((f) => html`<code>[${f}]</code> `)}</p>` })}</aside></div>`;
  return appPage(ctx, { title: `${tpl.name}: ${inv.number}`, active: 'invoices', body });
}

/** The growth-loop footer on reminder emails: on by default for trial and Core, removed by Complete, and switchable in Settings. */
export function emailFooter(ctx) {
  const s = ctx.org.settings || {};
  if (s.email_footer === false || isComplete(ctx)) return '';
  return `Sent with ${ctx.definition.name}, credit control for UK small businesses: ${ctx.services.config.BASE_URL}`;
}

/**
 * Skipping in "work through the list" mode pushes that invoice's action to tomorrow by logging a follow-up date.
 * The row's outcome is Skipped, which the ladder, "Last contact" and the reports treat as no contact at all.
 */
export function chaseSkip(ctx) {
  // A POST (with the compose form's CSRF token) because it writes to the chase log.
  requireRole(ctx, 'member');
  const { resources } = ctx.services;
  const inv = resources.find(ctx, resources.get('invoices'), ctx.params.id);
  if (live(inv)) {
    logContact(ctx, inv, { channel: 'Other', outcome: SKIPPED, next_follow_up: addDays(base(ctx).today, 1), notes: 'Skipped while working through the chase list. No contact was made.' });
  }
  return { redirect: '/app/chase/next' };
}

function logContact(ctx, inv, values) {
  const { resources } = ctx.services;
  return resources.create(ctx, resources.get('chases'), { invoice: inv.id, date: base(ctx).today, ...values });
}

export async function composeSend(ctx) {
  requireRole(ctx, 'member');
  const data = loadInvoice(ctx);
  const { inv } = data;
  const code = String(ctx.body.t || '');
  const tpl = requireFound(templateFor(ctx, code), 'Template');
  if (tpl.complete_only && !isComplete(ctx)) throw new HttpError(402, `The “${tpl.name}” template is part of the Complete plan.`);
  const v = { t: code, queue: Number(ctx.body.queue) || 0, to: String(ctx.body.to || '').trim().toLowerCase(), cc: String(ctx.body.cc || '').trim().toLowerCase(), subject: String(ctx.body.subject || '').trim().slice(0, 300), body: String(ctx.body.body || '').replace(/\r\n?/g, '\n').trim() };
  let error = null;
  if (!isEmail(v.to)) error = 'Enter the email address to send to.';
  else if (v.cc && !isEmail(v.cc)) error = 'The Cc address isn\'t valid.';
  else if (!v.subject || !v.body) error = 'Add a subject and some wording.';
  if (error) return { status: 422, html: composePage(ctx, { values: v, error }) };
  const s = ctx.org.settings || {};
  const footer = emailFooter(ctx);
  const sent = await ctx.services.mailer.send({ orgId: ctx.org.id, to: v.to, cc: v.cc || null, replyTo: s.reply_to || ctx.user.email, subject: v.subject, text: footer ? `${v.body}\n\n--\n${footer}` : v.body, related: 'chase' });
  if (sent.status === 'failed') {
    // Nothing reached the customer, so don't log a "Sent" contact: it would push the follow-up out a week and hide the invoice from the chase list.
    return { status: 422, html: composePage(ctx, { values: v, error: 'The email could not be sent, so nothing was logged in the chase log. Your wording is kept below: try again in a moment. The failed attempt and its reason are under Activity → Emails.' }) };
  }
  const t = base(ctx).today;
  logContact(ctx, inv, {
    channel: 'Email', stage: tpl.stage || null, outcome: 'Sent', contact: v.to, template: code, outbox_id: sent.id ?? null,
    next_follow_up: addDays(t, 7), notes: `Subject: ${v.subject}`,
  });
  const back = v.queue ? '/app/chase/next' : `/app/invoices/${inv.id}`;
  let flash = 'Email sent and logged in the chase log.';
  if (sent.demo) flash = 'Demo workspace: the email was logged but not sent.';
  else if (sent.status === 'logged') flash = 'Email saved and logged. Email sending isn\'t set up yet, so it\'s in Activity → Emails rather than sent.';
  return { redirect: back, flash };
}

function letterPage(ctx, data, tpl, subject, text) {
  const { inv } = data;
  const actions = can(ctx, 'member')
    ? [postButton(ctx, `/app/invoices/${inv.id}/log-letter`, 'Log as sent by post', { size: 'sm', fields: { t: tpl.code } })]
    : [];
  const review = tpl.review ? html`<p class="no-print small muted">Solicitor review needed before first use.</p>` : '';
  return printPage(ctx, {
    title: `${subject}`,
    back: `/app/invoices/${inv.id}`,
    actions,
    body: html`${review}<div class="letter prose">${raw(mdToHtml(text, { headingOffset: 1 }))}</div>`,
  });
}

export function letterGet(ctx) {
  const data = loadInvoice(ctx);
  const tpl = requireFound(templateFor(ctx, String(ctx.query.t || data.inv.next.template || '3')), 'Template');
  if (tpl.complete_only && !isComplete(ctx)) return appPage(ctx, { title: tpl.name, active: 'invoices', body: upgradeCard(ctx, `The “${tpl.name}” template`) });
  const m = merged(ctx, data, tpl, ctx.query);
  return letterPage(ctx, data, tpl, m.subject, m.body);
}

export function letterPost(ctx) {
  requireRole(ctx, 'member');
  const data = loadInvoice(ctx);
  const tpl = requireFound(templateFor(ctx, String(ctx.body.t || '')), 'Template');
  if (tpl.complete_only && !isComplete(ctx)) throw new HttpError(402, `The “${tpl.name}” template is part of the Complete plan.`);
  return letterPage(ctx, data, tpl, String(ctx.body.subject || tpl.name).slice(0, 300), String(ctx.body.body || '').slice(0, 20000));
}

export function logLetter(ctx) {
  requireRole(ctx, 'member');
  const { inv, customer } = loadInvoice(ctx);
  const tpl = requireFound(templateFor(ctx, String(ctx.body.t || '')), 'Template');
  const t = base(ctx).today;
  const days = tpl.code === '5' ? (customer?.customer_type === 'Sole trader' ? 30 : 14) : 7;
  logContact(ctx, inv, { channel: 'Letter', stage: tpl.stage || (tpl.code === 'plan' ? 'Payment plan' : null), outcome: 'Sent', template: tpl.code, next_follow_up: addDays(t, days), contact: customer?.name || null });
  // A sent payment-plan agreement puts the invoice on the plan, so the chase ladder stops escalating it.
  if (tpl.code === 'plan' && live(inv) && inv.status !== 'On payment plan') {
    ctx.services.resources.patch(ctx, ctx.services.resources.get('invoices'), inv.id, { status: 'On payment plan' });
    return { redirect: `/app/invoices/${inv.id}`, flash: 'Letter logged, and the invoice is now on a payment plan.' };
  }
  return { redirect: `/app/invoices/${inv.id}`, flash: 'Letter logged in the chase log.' };
}

/* ------------------------------------------------------------------ statements and reports */

export function statement(ctx) {
  const { resources } = ctx.services;
  const c = resources.find(ctx, resources.get('customers'), ctx.params.id);
  if (!isComplete(ctx)) return appPage(ctx, { title: 'Statement', active: 'customers', body: upgradeCard(ctx, 'Customer statements') });
  const s = ctx.org.settings || {};
  const t = base(ctx).today;
  const list = allInvoices(ctx).filter((i) => i.customer === c.id && (live(i) || (i.next.kind === 'paid-late' && i.fig.claim) || i.fig.credit > 0));
  const total = (k) => round2(list.reduce((sum, i) => sum + (k(i) || 0), 0));
  // An overpaid invoice has no balance but a credit, shown as a negative amount that reduces what the customer owes.
  const net = (i) => round2(i.balance - i.fig.credit);
  const rows = list.sort((a, b) => (a.due_date < b.due_date ? -1 : 1)).map((i) => html`<tr><td>${i.number}</td><td>${fmtDateUK(i.invoice_date)}</td><td>${fmtDateUK(i.due_date)}</td><td class="right num">${gbp(i.amount)}</td><td class="right num">${gbp(i.paid_total)}</td><td class="right num">${gbp(net(i))}${i.fig.credit > 0 ? html` <span class="small">credit</span>` : ''}</td><td class="right num">${i.days_overdue || '—'}</td><td class="right num">${gbp(i.fig.claimable)}</td></tr>`);
  const claim = total((i) => i.fig.claimable);
  const owed = total(net);
  const hasCredit = list.some((i) => i.fig.credit > 0);
  const body = html`<div class="letterhead"><strong>${s.company_name || ctx.org.name}</strong>${s.address ? html`<div class="pre-line">${s.address}</div>` : ''}${s.phone ? html`<div>${s.phone}</div>` : ''}</div><div class="letter-meta"><p><strong>Statement of account</strong><br>${c.name}${c.address ? html`<br><span class="pre-line">${c.address}</span>` : ''}</p><p>As at ${fmtDateUK(t, true)}</p></div><div class="table-wrap"><table class="table table-compact"><thead><tr><th scope="col">Invoice</th><th scope="col">Date</th><th scope="col">Due</th><th scope="col" class="right">Amount</th><th scope="col" class="right">Paid</th><th scope="col" class="right">Balance</th><th scope="col" class="right">Days overdue</th><th scope="col" class="right">Interest and compensation</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><th scope="row" colspan="5">Totals</th><td class="right num"><strong>${gbp(owed)}</strong></td><td></td><td class="right num"><strong>${gbp(claim)}</strong></td></tr></tfoot></table></div>${
    hasCredit ? html`<p class="small">A negative balance marked credit is money received above the invoice amount. It reduces the total, and can be refunded or set against a later invoice.</p>` : ''
  }${
    claim > 0 ? html`<p class="small">Interest and compensation are claimable under the Late Payment of Commercial Debts (Interest) Act 1998: statutory interest at 8% a year above the Bank of England reference rate, and a fixed sum per invoice. Interest continues to build up until payment.</p>` : ''
  }${s.bank_details && (owed > 0 || claim > 0) ? html`<p><strong>Please pay to:</strong> <span class="pre-line">${s.bank_details}</span></p>` : ''}${s.payment_link ? html`<p>Or pay online: ${s.payment_link}</p>` : ''}<p>If you have any questions about this statement, please contact ${s.sender_name || ctx.user.name}${s.phone ? ` on ${s.phone}` : ''}.</p>`;
  return printPage(ctx, { title: `Statement: ${c.name}`, back: `/app/customers/${c.id}`, body });
}

export function reports(ctx) {
  if (!isComplete(ctx)) return appPage(ctx, { title: 'Reports', active: 'reports', body: html`${pageHeader({ title: 'Monthly review' })}${upgradeCard(ctx, 'Monthly reporting')}` });
  const { resources, db } = ctx.services;
  const b = base(ctx);
  const t = b.today;
  const all = allInvoices(ctx);
  const months = [];
  for (let k = 5; k >= 0; k--) {
    const d = new Date(Date.UTC(Number(t.slice(0, 4)), Number(t.slice(5, 7)) - 1 - k, 1));
    months.push(d.toISOString().slice(0, 7));
  }
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthName = (ym) => `${MON[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
  const settled = all.filter((i) => i.fig.settled && i.fig.settledOn);
  // Money received in each month: every payment on the day it arrived, plus invoices marked Paid with no payment records.
  const received = new Map(months.map((ym) => [ym, 0]));
  for (const i of all) {
    const pays = b.payments.get(i.id) || [];
    const entries = pays.length ? pays.map((p) => [p.date, p.amount]) : i.fig.settled && i.fig.settledOn ? [[i.fig.settledOn, i.amount]] : [];
    for (const [date, amount] of entries) if (received.has(date.slice(0, 7))) received.set(date.slice(0, 7), received.get(date.slice(0, 7)) + amount);
  }
  const perMonth = months.map((ym) => {
    const list = settled.filter((i) => i.fig.settledOn.slice(0, 7) === ym);
    const onTime = list.filter((i) => i.days_overdue === 0).length;
    const avgLate = list.length ? round2(list.reduce((s, i) => s + i.days_overdue, 0) / list.length) : null;
    return { ym, n: list.length, onTime, pct: list.length ? Math.round((onTime / list.length) * 100) : null, avgLate, collected: round2(received.get(ym)) };
  });
  const open = all.filter(live);
  const overdue = open.filter((i) => i.days_overdue > 0);
  const top = resources.query(ctx, resources.get('customers'), { all: true, sort: 'overdue', dir: 'desc' }).rows.filter((c) => c.overdue > 0).slice(0, 5);
  const since = `${t.slice(0, 7)}-01`;
  // Skipped rows only defer an action: they are not contacts with a customer, so they are not counted here.
  const activity = db.all("SELECT channel, COUNT(*) AS n FROM r_chases WHERE org_id = ? AND date >= ? AND COALESCE(outcome, '') != ? GROUP BY channel ORDER BY n DESC", ctx.org.id, since, SKIPPED);
  const body = html`${pageHeader({ title: 'Monthly review', subtitle: 'For the first Monday of each month: what is overdue, who pays late and whether chasing is working.', actions: [button('Print', { type: 'button', size: 'sm', extra: { 'data-print': '' } })] })}${stats([
    { label: 'Overdue now', value: gbp(round2(overdue.reduce((s, i) => s + i.balance, 0))), hint: `${overdue.length} invoices`, tone: 'orange' },
    { label: 'Paid on time (6 months)', value: (() => { const n = perMonth.reduce((s, m) => s + m.n, 0); return n ? `${Math.round((perMonth.reduce((s, m) => s + m.onTime, 0) / n) * 100)}%` : '—'; })(), hint: 'invoices paid by their due date', tone: 'green' },
    { label: 'Broken promises', value: String(open.filter((i) => i.next.kind === 'broken').length), tone: 'red' },
    { label: 'Open disputes', value: String(open.filter((i) => i.status === 'Disputed').length), tone: 'orange' },
    { label: 'Claimable', value: gbp(round2(all.filter((i) => i.fig.claim && (live(i) || i.next.kind === 'paid-late')).reduce((s, i) => s + i.fig.claimable, 0))), hint: 'interest and compensation', tone: 'purple' },
  ])}<div class="grid-2">${card({
    title: 'Share of invoices paid on time',
    body: barChart(perMonth.map((m) => ({ label: monthName(m.ym), short: monthName(m.ym).slice(0, 3), value: m.pct ?? 0, tone: m.pct === null ? 'gray' : m.pct >= 80 ? 'green' : m.pct >= 50 ? 'orange' : 'red' })), { format: (v) => `${v}%`, label: 'Percentage of invoices paid by the due date, by month paid' }),
    footer: html`<span class="small muted">By the month invoices were paid. Grey means nothing was paid that month.</span>`,
  })}${card({
    title: `Chasing this month (since ${fmtDateUK(since)})`,
    body: activity.length ? table({ columns: [{ key: 'channel', label: 'Channel' }, { key: 'n', label: 'Contacts', align: 'right' }], rows: activity }) : html`<p class="muted">No contacts logged yet this month.</p>`,
    footer: html`Customers to move to deposits, shorter terms or a lower limit: <a href="/app/customers?view=watch">see the watch list</a>.`,
  })}</div>${card({
    title: 'By month',
    body: table({ columns: [{ key: 'ym', label: 'Month', render: (m) => monthName(m.ym) }, { key: 'n', label: 'Invoices paid', align: 'right' }, { key: 'pct', label: 'Paid on time', align: 'right', render: (m) => (m.pct === null ? '—' : `${m.pct}%`) }, { key: 'avgLate', label: 'Average days late', align: 'right', render: (m) => (m.avgLate === null ? '—' : String(m.avgLate)) }, { key: 'collected', label: 'Collected', align: 'right', render: (m) => gbp(m.collected) }], rows: perMonth }),
  })}${card({
    title: 'Top overdue customers',
    body: table({ columns: [{ key: 'name', label: 'Customer', render: (c) => html`<a href="/app/customers/${c.id}">${c.name}</a>` }, { key: 'overdue', label: 'Overdue', align: 'right', render: (c) => gbp(c.overdue) }, { key: 'oldest_overdue', label: 'Oldest', align: 'right', render: (c) => `${c.oldest_overdue || 0} days` }, { key: 'credit_check', label: 'Check', render: (c) => badge(c.credit_check, c.credit_tone) }], rows: top, empty: html`<p class="muted">Nobody is overdue.</p>` }),
  })}`;
  return appPage(ctx, { title: 'Reports', active: 'reports', body });
}

export { ladderBands, todayISO, daysBetween };
