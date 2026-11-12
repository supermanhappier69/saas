// Guides (Start here, SOP, numbers), the credit policy builder, the interest calculator and the public waitlist.
import { HttpError, addDays, fmtDateUK, fmtGBP, isEmail, mdToHtml, nowISO, parseFlexibleDate, parseMoney, parseNumber, todayISO, toCSV } from '../../../core/util.js';
import { html, raw, card, pageHeader, button, tabs, alert, table, recordForm, attrs } from '../../../core/ui.js';
import { appPage, printPage, publicPage } from '../../../core/layout.js';
import { requireRole, can } from '../../../core/crud.js';
import { cleanSettings } from '../../../core/workspace.js';
import { ladderFrom } from '../lib/ladder.js';
import { startHere, sop, numbersGuide, policy, POLICY_FIELDS, SOURCES, DISCLAIMER, BILL_NOTE } from '../lib/docs.js';
import { invoiceFigures, rateCheck, fmtShort } from '../lib/calc.js';
import { referenceRateTable, RATES_CHECKED_THROUGH, BANK_RATE_SOURCE } from '../lib/rates.js';
import { isComplete, upgradeCard } from './app.js';
import { countCalculatorUse } from './founder.js';

const md = (text) => raw(`<div class="prose">${mdToHtml(text)}</div>`);
const DOCS = {
  start: { title: 'Start here', text: (ctx) => startHere(ladderFrom(ctx.org.settings)) },
  sop: { title: 'Credit control SOP', text: (ctx) => sop(ladderFrom(ctx.org.settings), ctx.org.settings) },
  numbers: { title: 'How the numbers work', text: () => numbersGuide() },
};

function guideTabs(active) {
  return tabs([
    { id: 'start', label: 'Start here', href: '/app/guides' },
    { id: 'sop', label: 'Credit control SOP', href: '/app/guides/sop' },
    { id: 'numbers', label: 'How the numbers work', href: '/app/guides/numbers' },
  ], active);
}

function rateTable() {
  const rows = referenceRateTable().slice(0, 12);
  return table({
    columns: [
      { key: 'from', label: 'Debts that become late', render: (r) => `${fmtShort(r.from)} – ${fmtShort(addDays(r.from.endsWith('-01-01') ? `${r.from.slice(0, 4)}-07-01` : `${Number(r.from.slice(0, 4)) + 1}-01-01`, -1))}` },
      { key: 'refDate', label: 'Base rate on', render: (r) => fmtShort(r.refDate) },
      { key: 'rate', label: 'Reference rate', align: 'right', render: (r) => `${r.rate}%` },
      { key: 'total', label: 'Statutory interest', align: 'right', render: (r) => `${8 + r.rate}% a year` },
    ],
    rows,
  });
}

/** The calculator form and its result, shared by the in-app guide and the public page. */
function calculator(ctx, action) {
  const q = ctx.query;
  const t = todayISO(ctx.services.config?.TIMEZONE);
  const asked = q.amount !== undefined;
  const amount = parseMoney(q.amount);
  const due = parseFlexibleDate(q.due);
  const untilParsed = parseFlexibleDate(q.until);
  const until = untilParsed || t;
  const override = q.rate !== undefined && String(q.rate).trim() !== '' ? parseNumber(q.rate) : null;
  const errors = [];
  if (asked) {
    if (!(amount > 0)) errors.push('Enter the amount owed.');
    if (!due) errors.push('Enter the date payment was due.');
    if (q.until !== undefined && String(q.until).trim() !== '' && !untilParsed) errors.push('Enter a real date for "Paid or checked on", or leave it blank to use today.');
    else if (due && until < due) errors.push('The "paid or checked on" date can\'t be before the due date.');
    if (override !== null && !(override >= 0 && override <= 25)) errors.push('Enter a reference rate between 0 and 25, or leave it blank.');
  }
  const field = (name, label, value, extra = {}) => html`<div class="field"><label for="calc-${name}">${label}</label><input${attrs({ id: `calc-${name}`, name, value: value ?? '', ...extra })}></div>`;
  const form = html`<form method="get" action="${action}" class="form"><div class="form-grid">${field('amount', 'Amount owed (£)', q.amount, { inputmode: 'decimal', required: true, placeholder: '2400.00' })}${field('due', 'Payment was due on', q.due, { type: 'date', required: true })}${field('until', 'Paid or checked on', q.until || t, { type: 'date' })}${field('rate', 'Reference rate (optional, %)', q.rate, { inputmode: 'decimal', placeholder: 'Looked up for you' })}</div><div class="form-actions">${button('Work it out', { variant: 'primary' })}</div></form>`;
  let result = '';
  if (asked && errors.length) result = alert(html`${errors.map((e) => html`${e} `)}`, 'red');
  else if (asked) {
    const f = invoiceFigures({ amount, dueDate: due, today: until, rateOverride: override });
    const rc = rateCheck(f.reference, { daysOverdue: f.daysOverdue });
    result = html`<div class="calc-result"><div class="figures"><div class="figure"><span class="figure-label">Days late</span><span class="figure-value">${f.daysOverdue}</span></div><div class="figure"><span class="figure-label">Statutory interest</span><span class="figure-value">${fmtGBP(f.interest)}</span></div><div class="figure"><span class="figure-label">Daily interest</span><span class="figure-value">${fmtGBP(round(amount * f.annualRate / 36500))}</span></div><div class="figure"><span class="figure-label">Fixed compensation</span><span class="figure-value">${fmtGBP(f.fixedSum)}</span></div><div class="figure"><span class="figure-label">Total you can claim</span><span class="figure-value text-red">${fmtGBP(f.claimable)}</span></div></div><p class="small">${rc.text}${f.claim ? ` · ${f.annualRate}% a year` : ''}. Interest from ${fmtDateUK(addDays(due, 1))} to ${fmtDateUK(until)}.</p></div>`;
  }
  return { form, result };
}
const round = (n) => Math.round(n * 100) / 100;

// Object.hasOwn: a URL such as /app/guides/constructor must be a 404, not a lookup on Object.prototype.
const docFor = (id) => (Object.hasOwn(DOCS, id) ? DOCS[id] : null);

export function guidePage(ctx) {
  const id = ctx.params.doc || 'start';
  const doc = docFor(id);
  if (!doc) throw new HttpError(404, 'Page not found');
  const actions = [button('Print', { href: `/app/guides/${id}/print`, size: 'sm' })];
  let extra = '';
  if (id === 'numbers') {
    const calc = calculator(ctx, '/app/guides/numbers');
    extra = html`${card({ title: 'Quick calculator', body: html`${calc.result}${calc.form}` })}${card({
      title: 'Reference rates built in',
      body: html`${rateTable()}<p class="small muted">From the <a href="${BANK_RATE_SOURCE}" rel="noopener noreferrer" target="_blank">Bank of England Bank Rate history</a>, checked ${fmtShort(RATES_CHECKED_THROUGH)}. Rates for later periods appear here once published.</p>`,
      actions: button('Your own reference rates', { href: '/app/rates', size: 'sm' }),
    })}`;
  }
  const subtitle = id === 'sop' ? 'Your credit control routine, with your names and timings filled in from Settings and the credit policy.' : id === 'numbers' ? DISCLAIMER : 'Set up in 15 minutes, then 20 minutes a week.';
  return appPage(ctx, { title: doc.title, active: 'guides', body: html`${pageHeader({ title: doc.title, subtitle, actions })}${guideTabs(id)}${extra}${card({ body: md(doc.text(ctx)) })}` });
}

export function guidePrint(ctx) {
  const doc = docFor(ctx.params.doc);
  if (!doc) throw new HttpError(404, 'Page not found');
  return printPage(ctx, { title: doc.title, back: ctx.params.doc === 'start' ? '/app/guides' : `/app/guides/${ctx.params.doc}`, body: html`<h1>${doc.title}</h1><p class="muted">${ctx.org.settings?.company_name || ctx.org.name}</p>${md(doc.text(ctx))}` });
}

export function policyPage(ctx, { values = null, errors = {} } = {}) {
  if (!isComplete(ctx)) return appPage(ctx, { title: 'Credit policy', active: 'policy', body: html`${pageHeader({ title: 'Payment terms and credit policy' })}${upgradeCard(ctx, 'The credit policy builder')}` });
  const s = ctx.org.settings || {};
  const current = values || s;
  const form = can(ctx, 'admin')
    ? recordForm(ctx, { action: '/app/policy', fields: POLICY_FIELDS, values: current, errors, submit: 'Save and update the policy' })
    : alert('Only workspace admins can change the policy answers.', 'blue');
  const body = html`${pageHeader({
    title: 'Payment terms and credit policy',
    subtitle: 'Answer a few questions and the policy, customer terms and invoice wording are written for you. Standard terms and the account-stop threshold come from Settings.',
    actions: [button('Print or save as PDF', { href: '/app/policy/print', size: 'sm', variant: 'primary' })],
  })}${alert('Have a solicitor review the customer-facing terms (Part B) before you use them.', 'yellow', 'Solicitor review.')}<div class="detail-grid"><div class="detail-main">${card({ title: 'Your policy', body: md(policy(s, ctx.org.name)) })}</div><aside class="detail-side">${card({ title: 'Your answers', body: form })}</aside></div>`;
  return appPage(ctx, { title: 'Credit policy', active: 'policy', body });
}

export function policySave(ctx) {
  requireRole(ctx, 'admin');
  if (!isComplete(ctx)) throw new HttpError(402, 'The credit policy builder is part of the Complete plan.');
  const { values, errors } = cleanSettings(ctx, POLICY_FIELDS, ctx.body);
  if (Object.keys(errors).length) return { status: 422, html: policyPage(ctx, { values: ctx.body, errors }) };
  ctx.services.db.run('UPDATE orgs SET settings = ? WHERE id = ?', JSON.stringify({ ...ctx.org.settings, ...values }), ctx.org.id);
  ctx.audit?.('settings', null, null, 'Credit policy answers updated');
  return { redirect: '/app/policy', flash: 'Policy updated.' };
}

export function policyPrint(ctx) {
  if (!isComplete(ctx)) return appPage(ctx, { title: 'Credit policy', active: 'policy', body: upgradeCard(ctx, 'The credit policy builder') });
  const s = ctx.org.settings || {};
  return printPage(ctx, { title: 'Payment terms and credit policy', back: '/app/policy', body: html`<h1>Payment terms and credit policy</h1><p class="muted">${s.company_name || ctx.org.name} · ${fmtDateUK(todayISO(ctx.services.config?.TIMEZONE), true)}</p>${md(policy(s, ctx.org.name))}` });
}

/* ------------------------------------------------------------------ public pages */

export function publicCalculator(ctx) {
  const def = ctx.definition;
  const calc = calculator(ctx, '/calculator');
  if (ctx.query.amount !== undefined) countCalculatorUse(ctx.services.db);
  const body = html`<section class="section"><div class="container narrow"><p class="eyebrow">Free calculator</p><h1>UK late payment interest calculator</h1><p class="lead">Work out the statutory interest and fixed compensation you can claim on a late business invoice. The Bank of England reference rate is looked up for you.</p>${calc.result}${card({ body: calc.form })}<div class="prose"><h2>What this works out</h2><ul><li>Statutory interest at 8% a year plus the Bank of England reference rate, as simple interest for each day late (<a href="${SOURCES.govInterest}" rel="noopener noreferrer" target="_blank">GOV.UK</a>).</li><li>The reference rate in force on 30 June or 31 December before interest starts, fixed for the debt (<a href="${SOURCES.order}" rel="noopener noreferrer" target="_blank">2002 Order, article 4</a>).</li><li>Fixed compensation of £40, £70 or £100 per invoice (<a href="${SOURCES.act5A}" rel="noopener noreferrer" target="_blank">section 5A</a>).</li></ul><p>Only for business-to-business debts where your contract doesn't set its own late-payment interest. ${DISCLAIMER}</p>${md(BILL_NOTE)}<h2>Free templates to send with the figure</h2><ul><li><a href="/free/payment-reminder-templates">Payment reminder emails and a phone script</a></li><li><a href="/free/letter-before-action">Interest claim and letter before action</a></li><li><a href="/free/payment-terms">Payment terms and credit policy</a></li></ul></div>${card({
    cls: 'callout',
    title: 'Knowing the figure is the easy part',
    body: html`<p>${def.name} runs the whole chasing process: a chase calendar that tells you what to send and when, ready-to-send emails and letters with these figures filled in, a credit control routine and a payment terms policy.</p><p>${button('Try the demo', { href: '/demo', variant: 'primary' })} ${button('Join the waitlist', { href: '/waitlist' })}</p>`,
  })}</div></section>`;
  return publicPage(def, ctx, { title: 'Late payment interest calculator', description: 'Free UK late payment interest calculator: statutory interest at 8% plus the Bank of England reference rate, and £40, £70 or £100 fixed compensation.', body });
}

const WAITLIST_FIELDS = [
  { key: 'name', label: 'Your name', type: 'text', required: true, autocomplete: 'name' },
  { key: 'email', label: 'Work email', type: 'email', required: true, autocomplete: 'email' },
  { key: 'company', label: 'Business name', type: 'text', autocomplete: 'organization' },
  { key: 'staff', label: 'How many people work in the business?', type: 'select', options: ['Just me', '2–9', '10–49', '50 or more'] },
  { key: 'invoices', label: 'Invoices you send a month', type: 'select', options: ['Under 10', '10–49', '50–199', '200 or more'] },
  { key: 'today', label: 'How you chase today', type: 'select', options: ['I don\'t, really', 'Spreadsheet and email', 'My accounting software', 'Credit control software', 'Someone does it for me'] },
  { key: 'price', label: 'What would you pay for this?', type: 'select', options: ['£49 one-off (Core)', '£99 one-off (Complete)', 'A monthly subscription', 'Nothing: free tools are enough', 'Not sure yet'] },
  { key: 'message', label: 'The hardest part of getting paid on time (optional)', type: 'textarea', rows: 3 },
];

function waitlistPage(ctx, { values = {}, errors = {}, status = 200 } = {}) {
  const def = ctx.definition;
  const form = recordForm(ctx, {
    action: '/waitlist', fields: WAITLIST_FIELDS, values, errors, submit: 'Join the waitlist',
    extra: html`<div class="hp" aria-hidden="true"><label for="website">Leave this empty</label><input id="website" name="website" tabindex="-1" autocomplete="off"></div><p class="small muted">We'll only email you about ${def.name}. See our <a href="/privacy">privacy policy</a>.</p>`,
  });
  const page = publicPage(def, ctx, {
    title: 'Join the waitlist',
    narrow: true,
    body: html`<h1>Get ${def.name} at the founder price</h1><p class="lead">We're opening ${def.name} to a small group of UK businesses first. Tell us a little about how you get paid and we'll be in touch before launch.</p>${card({ body: form })}`,
  });
  return status === 200 ? page : { status, html: page };
}

export function waitlistGet(ctx) {
  return waitlistPage(ctx);
}

export function waitlistPost(ctx) {
  ctx.services.limiter?.(`waitlist:${ctx.ip || 'unknown'}`, 5, 60 * 60 * 1000);
  const thanks = () => publicPage(ctx.definition, ctx, { title: 'You\'re on the list', narrow: true, body: html`<h1>Thanks, you're on the list</h1><p class="lead">We'll email you before ${ctx.definition.name} opens. In the meantime you can try the demo with sample data.</p><p>${button('Try the demo', { href: '/demo', variant: 'primary' })} ${button('Interest calculator', { href: '/calculator' })}</p>` });
  if (ctx.body.website) return thanks();
  const clip = (k, n) => String(ctx.body[k] ?? '').trim().slice(0, n);
  const v = Object.fromEntries(WAITLIST_FIELDS.map((f) => [f.key, clip(f.key, f.type === 'textarea' ? 2000 : 160)]));
  v.email = v.email.toLowerCase();
  const errors = {};
  if (!v.name) errors.name = 'Enter your name.';
  if (!isEmail(v.email)) errors.email = 'Enter a valid email address.';
  for (const f of WAITLIST_FIELDS) if (f.options && v[f.key] && !f.options.includes(v[f.key])) errors[f.key] = 'Choose one of the options.';
  if (Object.keys(errors).length) return waitlistPage(ctx, { values: v, errors, status: 422 });
  const { db, mailer, config } = ctx.services;
  const def = ctx.definition;
  const existing = db.get("SELECT id FROM leads WHERE kind = 'waitlist' AND email = ?", v.email);
  const data = JSON.stringify({ product: def.slug, staff: v.staff, invoices: v.invoices, today: v.today, price: v.price });
  if (existing) db.run('UPDATE leads SET name = ?, company = ?, message = ?, data = ? WHERE id = ?', v.name, v.company, v.message, data, existing.id);
  else db.run('INSERT INTO leads (org_id, kind, name, email, company, message, data, status, created_at) VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?)', 'waitlist', v.name, v.email, v.company, v.message, data, 'new', nowISO());
  const to = config.CONTACT_TO || def.contactEmail;
  if (to && !existing) {
    mailer.send({ to, replyTo: v.email, subject: `${def.name} waitlist: ${v.name}${v.company ? `, ${v.company}` : ''}`, text: `${v.name} <${v.email}>\n${v.company}\nStaff: ${v.staff}\nInvoices a month: ${v.invoices}\nChases today with: ${v.today}\nWould pay: ${v.price}\n\n${v.message}`, related: 'lead' }).catch(() => {});
  }
  return thanks();
}

/** `node server.js --waitlist` prints the waitlist as CSV, for the demand test. */
export function waitlistCsv(db) {
  const rows = db.all("SELECT created_at, name, email, company, message, data FROM leads WHERE kind = 'waitlist' ORDER BY id");
  // toCSV also neutralises cells that start with = + - @ so a sign-up can't run a formula when the file is opened in Excel.
  return toCSV(
    ['Joined', 'Name', 'Email', 'Business', 'Staff', 'Invoices a month', 'Chases today with', 'Would pay', 'Notes'],
    rows.map((r) => {
      let d = {};
      try { d = JSON.parse(r.data || '{}'); } catch { d = {}; }
      return [r.created_at.slice(0, 10), r.name, r.email, r.company, d.staff, d.invoices, d.today, d.price, r.message];
    }),
  );
}
