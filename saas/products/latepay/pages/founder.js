// Founder console: live numbers, the business and marketing plans, the launch checklist, a path-to-£1m model and the leads.
// Only people listed in FOUNDER_EMAILS can open it (outside production, the first user too).
import fs from 'node:fs';
import { HttpError, fmtGBP, mdToHtml, nowISO, parseNumber, round2, todayISO, addDays, toCSV } from '../../../core/util.js';
import { html, raw, card, pageHeader, button, tabs, table, badge, alert, csrfField, attrs, stats } from '../../../core/ui.js';
import { appPage } from '../../../core/layout.js';

const PLAN = fs.readFileSync(new URL('../founder/business-plan.md', import.meta.url), 'utf8');
const MARKETING = fs.readFileSync(new URL('../founder/marketing-plan.md', import.meta.url), 'utf8');
const gbp = (n) => fmtGBP(n || 0);
const md = (text) => raw(`<div class="prose plan-doc">${mdToHtml(text, { headingOffset: 1 })}</div>`);

export function isFounder(ctx) {
  if (!ctx.user) return false;
  const list = ctx.services.config.FOUNDER_EMAILS || [];
  if (list.includes(String(ctx.user.email).toLowerCase())) return true;
  return ctx.services.config.NODE_ENV !== 'production' && !list.length && ctx.user.id === 1 && !ctx.org?.is_demo;
}
function requireFounder(ctx) {
  if (!isFounder(ctx)) throw new HttpError(403, 'The founder console is only for the people listed in FOUNDER_EMAILS.');
}

export const CHECKLIST = [
  { group: 'Legal and money', items: [
    ['solicitor', 'Solicitor has reviewed Templates 3–5, the payment plan agreement, the policy\'s customer terms and the Terms page'],
    ['refunds', 'Refund policy decided and written into the Terms (placeholders replaced)'],
    ['company', 'Company name, number and address in the Terms and Privacy pages'],
    ['stripe', 'Stripe live prices created and STRIPE_* set; a real £1 test purchase refunded'],
  ] },
  { group: 'Running live', items: [
    ['domain', 'Domain bought and pointed at the app; BASE_URL is the https address'],
    ['email', 'Resend or Postmark domain verified; a reminder sent from a real workspace arrived'],
    ['indexing', 'ALLOW_INDEXING=1 set; calculator and free pages submitted to Google Search Console'],
    ['backup', 'Weekly database backup done once by hand and written down'],
    ['rates', 'Bank Rate table checked after the latest Monetary Policy Committee decision'],
  ] },
  { group: 'Demand test', items: [
    ['conversations', '10 buyer conversations held and notes written up'],
    ['waitlist', '50 people on the waitlist'],
    ['partners', '10 bookkeepers or accountants offered the partner deal'],
    ['launch', 'Waitlist launch email sent with the founder price'],
    ['first10', 'First 10 paying customers'],
    ['channel', 'Decided which channel produced the customers and dropped the rest'],
  ] },
];
const ALL_IDS = new Set(CHECKLIST.flatMap((g) => g.items.map(([id]) => id)));
const ticks = (db) => {
  try { return new Set(JSON.parse(db.kvGet('founder:checklist') || '[]')); } catch { return new Set(); }
};

function consoleTabs(active) {
  return tabs([
    { id: 'numbers', label: 'Numbers', href: '/app/founder' },
    { id: 'checklist', label: 'Launch checklist', href: '/app/founder/checklist' },
    { id: 'plan', label: 'Business plan', href: '/app/founder/plan' },
    { id: 'marketing', label: 'Marketing plan', href: '/app/founder/marketing' },
    { id: 'model', label: 'Path to £1m', href: '/app/founder/model' },
    { id: 'leads', label: 'Leads', href: '/app/founder/leads' },
  ], active);
}
const shell = (ctx, active, title, body) => appPage(ctx, { title: `${title} · Founder`, active: 'founder', body: html`${pageHeader({ title: 'Founder console', subtitle: 'Only you can see this. Numbers are live; the plans are yours to edit in the repository.' })}${consoleTabs(active)}${body}` });

/** Everything the numbers page shows, so tests and the model can reuse it. */
export function metrics(ctx) {
  const { db, billing } = ctx.services;
  const t = todayISO(ctx.services.config.TIMEZONE);
  const weekAgo = addDays(t, -7);
  const monthAgo = addDays(t, -30);
  const n = (sql, ...p) => db.get(sql, ...p).n;
  const real = 'is_demo = 0';
  const orgs = db.all(`SELECT id, plan, plan_status, trial_ends, created_at FROM orgs WHERE ${real}`);
  const paid = orgs.filter((o) => o.plan_status === 'active');
  const revenue = round2(paid.reduce((s, o) => s + (billing.planById(o.plan)?.price || 0), 0));
  const trialing = orgs.filter((o) => o.plan_status === 'trialing' && o.trial_ends >= t);
  const expired = orgs.filter((o) => o.plan_status === 'trialing' && o.trial_ends < t);
  const activated = n(`SELECT COUNT(DISTINCT org_id) AS n FROM r_invoices WHERE is_sample = 0 AND org_id IN (SELECT id FROM orgs WHERE ${real})`);
  const sentReal = n(`SELECT COUNT(*) AS n FROM outbox WHERE related = 'chase' AND org_id IN (SELECT id FROM orgs WHERE ${real})`);
  const waitlist = db.all("SELECT data, created_at FROM leads WHERE kind = 'waitlist'");
  const prices = {};
  const sources = {};
  for (const w of waitlist) {
    let d = {};
    try { d = JSON.parse(w.data || '{}'); } catch { d = {}; }
    prices[d.price || 'Not answered'] = (prices[d.price || 'Not answered'] || 0) + 1;
    sources[d.today || 'Not answered'] = (sources[d.today || 'Not answered'] || 0) + 1;
  }
  const decided = orgs.filter((o) => o.plan_status === 'active' || (o.plan_status === 'trialing' && o.trial_ends < t) || o.plan_status === 'canceled');
  return {
    today: t,
    signups: orgs.length,
    signupsWeek: orgs.filter((o) => o.created_at.slice(0, 10) >= weekAgo).length,
    signupsMonth: orgs.filter((o) => o.created_at.slice(0, 10) >= monthAgo).length,
    demos: n('SELECT COUNT(*) AS n FROM orgs WHERE is_demo = 1'),
    trialing: trialing.length,
    expired: expired.length,
    paid: paid.length,
    paidByPlan: Object.fromEntries(billing.plans.map((p) => [p.name, paid.filter((o) => o.plan === p.id).length])),
    revenue,
    conversion: decided.length ? Math.round((paid.length / decided.length) * 100) : null,
    activated,
    activationRate: orgs.length ? Math.round((activated / orgs.length) * 100) : null,
    remindersSent: sentReal,
    calculatorUses: Number(db.kvGet('founder:calculator-uses') || 0),
    waitlist: waitlist.length,
    waitlistWeek: waitlist.filter((w) => w.created_at.slice(0, 10) >= weekAgo).length,
    prices,
    sources,
    contacts: n("SELECT COUNT(*) AS n FROM leads WHERE kind = 'contact'"),
    customersReal: n(`SELECT COUNT(*) AS n FROM r_customers WHERE is_sample = 0 AND org_id IN (SELECT id FROM orgs WHERE ${real})`),
    invoicesReal: n(`SELECT COUNT(*) AS n FROM r_invoices WHERE is_sample = 0 AND org_id IN (SELECT id FROM orgs WHERE ${real})`),
  };
}

/** Counts calculator uses in kv (no personal data). */
export function countCalculatorUse(db) {
  db.kvSet('founder:calculator-uses', String(Number(db.kvGet('founder:calculator-uses') || 0) + 1));
}

export function numbersPage(ctx) {
  requireFounder(ctx);
  const m = metrics(ctx);
  const pct = (v) => (v === null ? '—' : `${v}%`);
  const dist = (obj) => {
    const rows = Object.entries(obj).sort((a, b) => b[1] - a[1]);
    return rows.length ? table({ columns: [{ key: 'k', label: 'Answer' }, { key: 'v', label: 'People', align: 'right' }], rows: rows.map(([k, v]) => ({ k, v })) }) : html`<p class="muted">No answers yet.</p>`;
  };
  const body = html`${stats([
    { label: 'Revenue recognised', value: gbp(m.revenue), hint: `${m.paid} paid workspace${m.paid === 1 ? '' : 's'}`, tone: 'green' },
    { label: 'Sign-ups', value: String(m.signups), hint: `${m.signupsWeek} this week · ${m.signupsMonth} this month`, tone: 'blue' },
    { label: 'On trial', value: String(m.trialing), hint: `${m.expired} trials ended unpaid`, tone: 'blue' },
    { label: 'Trial → paid', value: pct(m.conversion), hint: 'of trials that have ended or paid', tone: 'purple' },
    { label: 'Activated', value: pct(m.activationRate), hint: `${m.activated} workspaces added a real invoice`, tone: 'orange' },
    { label: 'Reminders sent', value: String(m.remindersSent), hint: 'from real workspaces', tone: 'gray' },
    { label: 'Waitlist', value: String(m.waitlist), hint: `${m.waitlistWeek} this week`, tone: 'green' },
    { label: 'Calculator uses', value: String(m.calculatorUses), hint: `${m.demos} demo workspaces opened`, tone: 'gray' },
  ])}<div class="grid-2">${card({ title: 'What the waitlist would pay', body: dist(m.prices) })}${card({ title: 'How the waitlist chases today', body: dist(m.sources) })}</div><div class="grid-2">${card({
    title: 'Paid by plan',
    body: table({ columns: [{ key: 'plan', label: 'Plan' }, { key: 'n', label: 'Workspaces', align: 'right' }], rows: Object.entries(m.paidByPlan).map(([plan, n]) => ({ plan, n })) }),
  })}${card({
    title: 'Real usage',
    body: html`<dl class="details"><div class="detail"><dt>Customers added</dt><dd>${m.customersReal}</dd></div><div class="detail"><dt>Invoices added</dt><dd>${m.invoicesReal}</dd></div><div class="detail"><dt>Contact form messages</dt><dd>${m.contacts}</dd></div></dl>`,
    footer: html`<a href="/app/founder/leads">See the leads</a> · <a href="/app/activity/emails">Sent emails</a>`,
  })}</div>${alert('Read this every Monday. If trial → paid is under 5% after 200 trials, test a lower Core price before anything else. If activation is under 40%, the onboarding is the problem, not the price.', 'blue', 'Rule of thumb.')}`;
  return shell(ctx, 'numbers', 'Numbers', body);
}

export function checklistPage(ctx) {
  requireFounder(ctx);
  const done = ticks(ctx.services.db);
  const total = ALL_IDS.size;
  const groups = CHECKLIST.map((g) => card({
    title: g.group,
    cls: 'checklist-card',
    body: html`<ul class="checklist">${g.items.map(([id, label]) => html`<li${attrs({ class: done.has(id) ? 'check-row done' : 'check-row' })}><form method="post" action="/app/founder/checklist" class="inline-form">${csrfField(ctx)}<input type="hidden" name="item" value="${id}"><button type="submit" class="btn btn-ghost btn-sm" aria-pressed="${done.has(id) ? 'true' : 'false'}">${done.has(id) ? '☑' : '☐'}</button></form><span>${label}</span></li>`)}</ul>`,
  }));
  const body = html`${stats([{ label: 'Launch readiness', value: `${done.size} of ${total}`, hint: done.size === total ? 'Ready for Founder Launch Approval' : 'Nothing goes live before every box is ticked', tone: done.size === total ? 'green' : 'orange' }])}${groups}<p class="muted small">Ticks are saved in the database. The full launch steps are in docs/LAUNCH.md.</p>`;
  return shell(ctx, 'checklist', 'Launch checklist', body);
}

export function checklistToggle(ctx) {
  requireFounder(ctx);
  const id = String(ctx.body.item || '');
  if (!ALL_IDS.has(id)) throw new HttpError(400, 'Unknown checklist item');
  const done = ticks(ctx.services.db);
  if (done.has(id)) done.delete(id);
  else done.add(id);
  ctx.services.db.kvSet('founder:checklist', JSON.stringify([...done]));
  return { redirect: '/app/founder/checklist' };
}

export function planPage(ctx) {
  requireFounder(ctx);
  return shell(ctx, 'plan', 'Business plan', card({ body: md(PLAN) }));
}
export function marketingPage(ctx) {
  requireFounder(ctx);
  return shell(ctx, 'marketing', 'Marketing plan', card({ body: md(MARKETING) }));
}

/** A straightforward model: visitors → trials → sales, plus Autopilot subscribers and retainers, month by month. */
export function modelFor(q = {}) {
  const num = (k, d) => {
    const v = parseNumber(q[k]);
    return v === null || v === undefined || Number.isNaN(v) ? d : v;
  };
  const inp = {
    visitors: Math.max(0, num('visitors', 2000)),
    growth: Math.max(0, num('growth', 10)),
    trialRate: Math.max(0, num('trialRate', 3)),
    paidRate: Math.max(0, num('paidRate', 15)),
    completeShare: Math.min(100, Math.max(0, num('completeShare', 40))),
    corePrice: Math.max(0, num('corePrice', 49)),
    completePrice: Math.max(0, num('completePrice', 99)),
    autopilotFrom: Math.max(1, Math.round(num('autopilotFrom', 6))),
    autopilotRate: Math.min(100, Math.max(0, num('autopilotRate', 25))),
    autopilotPrice: Math.max(0, num('autopilotPrice', 24)),
    churn: Math.min(100, Math.max(0, num('churn', 3))),
    retainers: Math.max(0, num('retainers', 1)),
    retainerPrice: Math.max(0, num('retainerPrice', 1000)),
    months: Math.min(120, Math.max(1, Math.round(num('months', 36)))),
  };
  const rows = [];
  let visitors = inp.visitors;
  let customers = 0;
  let subs = 0;
  let retainers = 0;
  let cumulative = 0;
  let hit = null;
  for (let m = 1; m <= inp.months; m++) {
    if (m > 1) visitors *= 1 + inp.growth / 100;
    const trials = visitors * inp.trialRate / 100;
    const sales = trials * inp.paidRate / 100;
    const oneOff = sales * ((1 - inp.completeShare / 100) * inp.corePrice + (inp.completeShare / 100) * inp.completePrice);
    customers += sales;
    if (m >= inp.autopilotFrom) {
      subs = subs * (1 - inp.churn / 100) + sales * inp.autopilotRate / 100;
      if (m === inp.autopilotFrom) subs += customers * inp.autopilotRate / 100;
    }
    retainers = Math.min(retainers + inp.retainers, 30);
    const recurring = subs * inp.autopilotPrice + retainers * inp.retainerPrice;
    const revenue = oneOff + recurring;
    cumulative += revenue;
    if (hit === null && cumulative >= 1000000) hit = m;
    rows.push({ m, visitors: Math.round(visitors), trials: round2(trials), sales: round2(sales), customers: Math.round(customers), subs: Math.round(subs), retainers, oneOff: round2(oneOff), recurring: round2(recurring), revenue: round2(revenue), cumulative: round2(cumulative) });
  }
  return { inp, rows, hit, total: round2(cumulative) };
}

export function modelPage(ctx) {
  requireFounder(ctx);
  const { inp, rows, hit, total } = modelFor(ctx.query);
  const field = (k, label, help = null, step = 'any') => html`<div class="field"><label for="m-${k}">${label}</label><input${attrs({ id: `m-${k}`, name: k, value: inp[k], inputmode: 'decimal', step })}>${help ? html`<p class="help">${help}</p>` : ''}</div>`;
  const form = html`<form method="get" action="/app/founder/model" class="form"><div class="form-grid">${field('visitors', 'Visitors in month 1', 'Free pages and outreach; 2,000 is the month-3 target')}${field('growth', 'Visitor growth a month (%)')}${field('trialRate', 'Visitors who start a trial (%)')}${field('paidRate', 'Trials that buy (%)')}${field('completeShare', 'Buyers choosing Complete (%)')}${field('corePrice', 'Core price (£)')}${field('completePrice', 'Complete price (£)')}${field('autopilotFrom', 'Autopilot launches in month')}${field('autopilotRate', 'Buyers who also take Autopilot (%)')}${field('autopilotPrice', 'Autopilot price a month (£)')}${field('churn', 'Autopilot churn a month (%)')}${field('retainers', 'New credit control retainers a month')}${field('retainerPrice', 'Retainer price a month (£)')}${field('months', 'Months to model')}</div><div class="form-actions">${button('Recalculate', { variant: 'primary' })}${button('Reset', { href: '/app/founder/model', variant: 'ghost' })}</div></form>`;
  const yearly = [];
  for (let y = 0; y * 12 < rows.length; y++) {
    const slice = rows.slice(y * 12, y * 12 + 12);
    yearly.push({ year: `Year ${y + 1}`, revenue: round2(slice.reduce((s, r) => s + r.revenue, 0)), customers: slice[slice.length - 1].customers, subs: slice[slice.length - 1].subs, cumulative: slice[slice.length - 1].cumulative });
  }
  const summary = stats([
    { label: `Revenue over ${inp.months} months`, value: gbp(total), tone: 'green' },
    { label: '£1 million reached', value: hit ? `Month ${hit}` : 'Not in this period', hint: hit ? `year ${Math.ceil(hit / 12)}` : 'change the inputs to see what it would take', tone: hit ? 'green' : 'orange' },
    { label: 'One-off customers', value: String(rows[rows.length - 1].customers), tone: 'blue' },
    { label: 'Autopilot subscribers at the end', value: String(rows[rows.length - 1].subs), tone: 'purple' },
  ]);
  const yearTable = table({ columns: [{ key: 'year', label: 'Year' }, { key: 'revenue', label: 'Revenue', align: 'right', render: (r) => gbp(r.revenue) }, { key: 'customers', label: 'One-off customers', align: 'right' }, { key: 'subs', label: 'Subscribers', align: 'right' }, { key: 'cumulative', label: 'Cumulative', align: 'right', render: (r) => gbp(r.cumulative) }], rows: yearly });
  const monthTable = table({ cls: 'table-compact model-table', columns: [{ key: 'm', label: 'Month' }, { key: 'visitors', label: 'Visitors', align: 'right' }, { key: 'trials', label: 'Trials', align: 'right', render: (r) => String(Math.round(r.trials)) }, { key: 'sales', label: 'Sales', align: 'right', render: (r) => r.sales.toFixed(1) }, { key: 'subs', label: 'Subs', align: 'right' }, { key: 'retainers', label: 'Retainers', align: 'right' }, { key: 'oneOff', label: 'One-off', align: 'right', render: (r) => gbp(r.oneOff) }, { key: 'recurring', label: 'Recurring', align: 'right', render: (r) => gbp(r.recurring) }, { key: 'revenue', label: 'Revenue', align: 'right', render: (r) => gbp(r.revenue) }, { key: 'cumulative', label: 'Cumulative', align: 'right', render: (r) => gbp(r.cumulative) }], rows });
  const body = html`${alert('This is arithmetic, not a forecast. The defaults are the plan\'s hypotheses; replace them with the real conversion rates from the Numbers tab as soon as you have them. One-off sales alone do not get to £1m: the recurring tier and the service do the work.', 'yellow', 'Honest note.')}${summary}${card({ title: 'Assumptions', body: form })}${card({ title: 'By year', body: yearTable })}${card({ title: 'By month', body: monthTable })}`;
  return shell(ctx, 'model', 'Path to £1m', body);
}

export function leadsPage(ctx) {
  requireFounder(ctx);
  const { db } = ctx.services;
  const rows = db.all('SELECT id, kind, name, email, company, message, data, created_at FROM leads ORDER BY id DESC LIMIT 500').map((r) => {
    let d = {};
    try { d = JSON.parse(r.data || '{}'); } catch { d = {}; }
    return { ...r, d };
  });
  const list = table({
    columns: [
      { key: 'created_at', label: 'When', render: (r) => r.created_at.slice(0, 10) },
      { key: 'kind', label: 'Kind', render: (r) => badge(r.kind === 'waitlist' ? 'Waitlist' : 'Contact', r.kind === 'waitlist' ? 'green' : 'blue') },
      { key: 'name', label: 'Who', render: (r) => html`${r.name}<br><a href="mailto:${r.email}">${r.email}</a>${r.company ? html`<br><span class="muted small">${r.company}</span>` : ''}` },
      { key: 'd', label: 'Answers', render: (r) => (r.kind === 'waitlist' ? html`<span class="small">${[r.d.staff, r.d.invoices, r.d.today, r.d.price].filter(Boolean).join(' · ')}</span>` : '') },
      { key: 'message', label: 'Message', render: (r) => html`<span class="small pre-line">${r.message || ''}</span>` },
    ],
    rows,
    empty: html`<p class="muted">No leads yet. Share the calculator and the waitlist.</p>`,
  });
  return shell(ctx, 'leads', 'Leads', card({ title: `Leads (${rows.length})`, actions: button('Download CSV', { href: '/app/founder/leads.csv', size: 'sm' }), body: list }));
}

export function leadsCsv(ctx) {
  requireFounder(ctx);
  const rows = ctx.services.db.all('SELECT kind, created_at, name, email, company, message, data FROM leads ORDER BY id');
  const out = rows.map((r) => {
    let d = {};
    try { d = JSON.parse(r.data || '{}'); } catch { d = {}; }
    return [r.kind, r.created_at.slice(0, 10), r.name, r.email, r.company, d.staff, d.invoices, d.today, d.price, r.message];
  });
  return { download: { body: `\uFEFF${toCSV(['Kind', 'Date', 'Name', 'Email', 'Business', 'Staff', 'Invoices a month', 'Chases today with', 'Would pay', 'Message'], out)}`, type: 'text/csv; charset=utf-8', filename: `paidontime-leads-${todayISO()}.csv` } };
}

export function registerFounder(router) {
  router.get('/app/founder', numbersPage);
  router.get('/app/founder/checklist', checklistPage);
  router.post('/app/founder/checklist', checklistToggle);
  router.get('/app/founder/plan', planPage);
  router.get('/app/founder/marketing', marketingPage);
  router.get('/app/founder/model', modelPage);
  router.get('/app/founder/leads', leadsPage);
  router.get('/app/founder/leads.csv', leadsCsv);
}

export { nowISO };
