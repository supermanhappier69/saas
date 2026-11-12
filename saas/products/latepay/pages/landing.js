// PaidOnTime landing page. The product views are drawn in HTML (not screenshots) and the worked example
// is computed by the app's own calculator, so marketing figures always match what the product produces.
import { html, button, fmtGBP, fmtDateUK } from '../../../core/ui.js';
import { icon } from '../../../core/icons.js';
import { pricingGrid, faqList } from '../../../core/pages.js';
import { addDays, todayISO } from '../../../core/util.js';
import { invoiceFigures } from '../lib/calc.js';
import { DEFAULT_LADDER } from '../lib/ladder.js';

const gbp = (n) => fmtGBP(n);
const kicker = (t) => html`<p class="mk-kicker">${t}</p>`;
const head = (k, title, lede = null) => html`<header class="mk-head">${kicker(k)}<h2 class="mk-h2">${title}</h2>${lede ? html`<p class="mk-lede">${lede}</p>` : ''}</header>`;
const badge = (text, tone) => html`<span class="badge badge-${tone}">${text}</span>`;

// A fixed, historic example so the Bank of England reference rate is known: due 10 Sep 2026, assessed 12 Nov 2026.
const EXAMPLE = { number: 'INV-1003', customer: 'Northgate Events Ltd', amount: 12500, due: '2026-09-10', on: '2026-11-12' };
const FIG = invoiceFigures({ amount: EXAMPLE.amount, dueDate: EXAMPLE.due, today: EXAMPLE.on });
const pct = (n) => `${Number(n).toFixed(2).replace(/\.?0+$/, '')}%`;

const ROWS = [
  { n: 'INV-1003', c: 'Northgate Events Ltd', bal: 12500, late: FIG.daysOverdue, action: 'Letter before action', tone: 'red', btn: 'Write letter' },
  { n: 'INV-1001', c: 'Brightside Joinery Ltd', bal: 2400, late: 41, action: 'Chase broken promise', tone: 'red', btn: 'Log a call' },
  { n: 'INV-1002', c: 'Northgate Events Ltd', bal: 850, late: 17, action: 'Final notice', tone: 'orange', btn: 'Write email' },
  { n: 'INV-1007', c: 'Kestrel IT Services Ltd', bal: 3200, late: 9, action: 'Firm reminder and call', tone: 'orange', btn: 'Write email' },
  { n: 'INV-1005', c: 'Harbour Dental LLP', bal: 3150, late: -DEFAULT_LADDER.pre_due_days, action: 'Pre-due reminder', tone: 'blue', btn: 'Write email' },
];
const lateText = (d) => (d > 0 ? `${d} days` : `Due in ${-d} days`);

function heroMock() {
  const outstanding = ROWS.reduce((s, r) => s + r.bal, 0);
  const overdue = ROWS.filter((r) => r.late > 0).reduce((s, r) => s + r.bal, 0);
  const nav = [['dashboard', 'Dashboard'], ['chase', 'Chase list', ROWS.length], ['invoices', 'Invoices'], ['customers', 'Customers'], ['payments', 'Payments'], ['templates', 'Templates'], ['reports', 'Monthly review'], ['policy', 'Credit policy']];
  const sel = ROWS[0];
  return html`<figure class="mock" role="img" aria-label="The PaidOnTime chase list: five unpaid invoices with their next action, and the interest and compensation that can be claimed on the oldest one."><div class="mock-window"><aside class="mock-side"><div class="mock-brand"><span class="mock-logo"></span>PaidOnTime</div><div class="mock-org">Demo Joinery &amp; Fit-out Ltd</div><ul class="mock-nav">${nav.map(
    ([id, label, count]) => html`<li${id === 'chase' ? html` class="on"` : ''}>${icon(id)}<span>${label}</span>${count ? html`<b>${count}</b>` : ''}</li>`,
  )}</ul></aside><div class="mock-main"><div class="mock-top"><div><p class="mock-title">Chase list</p><p class="mock-sub">Monday · ${ROWS.length} actions due</p></div><div class="mock-tabs"><span class="on">List</span><span>Board</span><span>Calendar</span></div></div><div class="mock-sum"><div><span>Outstanding</span><strong>${gbp(outstanding)}</strong></div><div><span>Overdue</span><strong>${gbp(overdue)}</strong></div><div><span>Actions due</span><strong>${ROWS.length}</strong></div></div><table class="mock-table"><thead><tr><th>Invoice</th><th>Customer</th><th class="r">Balance</th><th>Overdue</th><th>Next action</th></tr></thead><tbody>${ROWS.map(
    (r) => html`<tr${r === sel ? html` class="sel"` : ''}><td class="mock-inv">${r.n}</td><td>${r.c}</td><td class="r">${gbp(r.bal)}</td><td class="${r.late > 0 ? 'mock-late' : 'mock-soon'}">${lateText(r.late)}</td><td>${badge(r.action, r.tone)}</td></tr>`,
  )}</tbody></table></div><aside class="mock-inspector"><p class="mock-insp-kicker">${sel.n}</p><p class="mock-insp-title">${sel.c}</p><p class="mock-insp-meta">${gbp(sel.bal)} · due ${fmtDateUK(EXAMPLE.due)}</p>${badge(`${FIG.daysOverdue} days overdue`, 'red')}<p class="mock-insp-label">What you can claim</p><dl><div><dt>Statutory interest</dt><dd>${gbp(FIG.interest)}</dd></div><div><dt>Fixed compensation</dt><dd>${gbp(FIG.fixedSum)}</dd></div><div class="mock-total"><dt>Add to the invoice</dt><dd>${gbp(FIG.claimable)}</dd></div></dl><p class="mock-insp-note">${pct(FIG.annualRate)} a year: 8% plus the ${pct(FIG.reference.rate)} reference rate</p><p class="mock-insp-label">Next action</p><p class="mock-insp-next">${sel.action}</p><span class="mock-btn mock-btn-primary mock-btn-block">${sel.btn}</span></aside></div></figure>`;
}

function agendaMock() {
  const days = [
    ['Today', [ROWS[0], ROWS[1]]],
    ['Wednesday', [ROWS[2], ROWS[3]]],
    ['Friday', [ROWS[4]]],
  ];
  return html`<div class="mock-card" role="img" aria-label="A week of chase actions grouped by day."><div class="mock-card-head"><strong>This week</strong><span class="mock-chip">${icon('calendar')} Calendar feed on</span></div>${days.map(
    ([day, list]) => html`<div class="mock-day"><p class="mock-day-label">${day}</p><ul>${list.map(
      (r) => html`<li><div><strong>${r.n}</strong><span>${r.c}</span></div><div class="mock-day-right"><span class="mock-amt">${gbp(r.bal)}</span>${badge(r.action, r.tone)}</div></li>`,
    )}</ul></div>`,
  )}</div>`;
}

function composeMock() {
  const today = todayISO();
  const due = addDays(today, -17);
  const d = (iso) => fmtDateUK(iso, true);
  const m = (t) => html`<mark>${t}</mark>`;
  return html`<div class="mock-card mock-compose" role="img" aria-label="A final notice email filled in with the invoice number, balance and dates."><div class="mock-card-head"><strong>Final notice · INV-1002</strong>${badge('Stage 3', 'orange')}</div><div class="mock-fields"><p><span class="k">To</span><span>Priya Shah, Northgate Events Ltd</span></p><p><span class="k">Subject</span><span>Final notice: invoice ${m('INV-1002')}, ${m('£850.00')}</span></p></div><div class="mock-letter"><p>Dear ${m('Priya')},</p><p>Invoice ${m('INV-1002')} for ${m('£850.00')}, due on ${m(d(due))}, is still unpaid despite our reminders of ${m(`${d(addDays(due, 1))} and ${d(addDays(due, DEFAULT_LADDER.stage2_from))}`)}.</p><p>Please pay the full balance of ${m('£850.00')} by ${m(d(addDays(today, 7)))}. If we don't receive payment by then, we intend to claim statutory interest and fixed compensation under the Late Payment of Commercial Debts (Interest) Act 1998.</p><p>Yours sincerely,<br>${m('Alex Morgan')}, ${m('Demo Joinery & Fit-out Ltd')}</p></div><div class="mock-compose-foot"><span>Logged to the chase log when sent</span><span class="mock-btn mock-btn-primary">Send email</span></div></div>`;
}

function calcMock() {
  const ref = FIG.reference;
  return html`<div class="mock-card mock-sheet" role="img" aria-label="A worked statutory interest calculation for a £12,500 invoice paid 63 days late."><div class="mock-card-head"><strong>${EXAMPLE.number} · ${EXAMPLE.customer}</strong>${badge(`${FIG.daysOverdue} days late`, 'red')}</div><dl class="mock-calc"><div><dt>Unpaid balance</dt><dd>${gbp(FIG.balance)}</dd></div><div><dt>Due date</dt><dd>${fmtDateUK(EXAMPLE.due, true)}</dd></div><div><dt>Reference rate<small>Bank Rate on ${fmtDateUK(ref.refDate, true)}</small></dt><dd>${pct(ref.rate)}</dd></div><div><dt>Statutory rate<small>8% plus the reference rate</small></dt><dd>${pct(FIG.annualRate)} a year</dd></div><div><dt>Interest per day</dt><dd>${gbp(FIG.dailyInterest)}</dd></div><div><dt>Interest to ${fmtDateUK(EXAMPLE.on, true)}</dt><dd>${gbp(FIG.interest)}</dd></div><div><dt>Fixed compensation<small>Debts of £10,000 or more</small></dt><dd>${gbp(FIG.fixedSum)}</dd></div><div class="mock-calc-total"><dt>You can claim</dt><dd>${gbp(FIG.claimable)}</dd></div></dl></div>`;
}

const SEGMENTS = [
  ['Trades and construction', 'Subcontractors on long terms and retentions, chasing main contractors who pay when it suits them.'],
  ['Agencies and consultancies', 'Retainers and project invoices that drift from 30 days to 90 while the work carries on.'],
  ['IT and managed services', 'Monthly invoices to clients who always mean to pay next week.'],
  ['Wholesale and distribution', 'Trade accounts with credit limits, and customers who keep ordering while they are overdue.'],
];

const SOURCES = [
  ['Late Payment of Commercial Debts (Interest) Act 1998', 'https://www.legislation.gov.uk/ukpga/1998/20'],
  ['GOV.UK guidance on late commercial payments', 'https://www.gov.uk/late-commercial-payments-interest-debt-recovery'],
  ['Bank of England Bank Rate', 'https://www.bankofengland.co.uk/monetary-policy/the-interest-rate-bank-rate'],
];

const STATS = [
  ['£26bn', 'owed to UK businesses in late payments at any one time'],
  ['14,000', 'businesses close every year because of late payment, 38 a day'],
  ['86 hours', 'a year spent chasing, per affected business'],
  ['£17,000', 'owed on average to each affected business'],
];

const L = DEFAULT_LADDER;
const LADDER = [
  { when: `${L.pre_due_days} days before due`, name: 'Pre-due reminder', text: 'A friendly heads-up with the amount, the due date and how to pay.', tone: 'blue' },
  { when: '1 day overdue', name: 'Friendly reminder', text: 'Assumes it slipped through, and makes paying today easy.', tone: 'blue' },
  { when: `${L.stage2_from} days overdue`, name: 'Firm reminder and call', text: 'A firmer email, a phone script and a request for a payment date.', tone: 'orange' },
  { when: `${L.stage3_from} days overdue`, name: 'Final notice', text: 'Sets a deadline and says what happens if it passes.', tone: 'orange' },
  { when: `${L.stage4_from} days overdue`, name: 'Interest and compensation claim', text: 'Adds statutory interest and the fixed sum, itemised.', tone: 'red' },
  { when: `${L.stage5_from} days overdue`, name: 'Letter before action', text: 'The formal letter to send before court, with the figures set out.', tone: 'red' },
];

const TOOLS = [
  { icon: 'policy', title: 'Credit limits and account stops', text: 'See who is over their limit or long overdue, and when your policy says to pause work.' },
  { icon: 'invoices', title: 'Customer statements', text: 'Every open invoice for a customer on one page, with interest shown, ready to print or send.' },
  { icon: 'calendar', title: 'Payment plans', text: 'Agree instalments in writing, then track each payment against the plan.' },
  { icon: 'guides', title: 'Credit policy builder', text: 'Answer a few questions to get an internal credit policy, payment terms and invoice wording.' },
  { icon: 'reports', title: 'Monthly review', text: 'Ageing, collections and days to pay, so you can see whether chasing is working.' },
  { icon: 'team', title: 'Built for small teams', text: 'Invite a bookkeeper or a colleague, with roles and a full activity log.' },
];

const COMPARE_COLS = ['Spreadsheet', 'Free calculator', 'Credit control software', 'PaidOnTime'];
const yes = html`<span class="mk-yes">${icon('check', { label: 'Yes' })}</span>`;
const no = html`<span class="mk-no" aria-label="No">—</span>`;
const COMPARE = [
  ['Tells you what to send next, and when', no, no, yes, yes],
  ['Reminders and letters written for you', no, no, yes, yes],
  ['Statutory interest and fixed sum worked out', 'If you build it', yes, 'Some', yes],
  ['Credit policy, SOP and weekly routine', no, no, no, yes],
  ['Needs an accounting integration', 'No', 'No', 'Usually', 'No'],
  ['Price', 'Free', 'Free', '£45–£199+ a month', '£49 or £99 once'],
];

export function landingBody(ctx) {
  const def = ctx.definition;
  const trial = def.trialDays ?? 14;
  const hero = html`<section class="mk-hero"><div class="container"><div class="mk-hero-copy">${kicker('Credit control for UK businesses')}<h1 class="mk-display">Get paid on time, or get compensated for the wait.</h1><p class="mk-lede mk-hero-lede">PaidOnTime puts every unpaid invoice on a chase calendar, writes the reminder or letter that's due, and works out the statutory interest and £40–£100 compensation UK law lets you add.</p><div class="mk-actions">${
    button('Start free trial', { href: '/signup', variant: 'primary', size: 'lg' })
  }${button(html`Explore the demo ${icon('arrow')}`, { href: '/demo', size: 'lg' })}</div><ul class="mk-assure"><li>${trial}-day free trial</li><li>No card needed</li><li>From £49 once, no subscription</li></ul></div></div><div class="container mk-stage">${heroMock()}</div></section>`;

  const facts = html`<section class="mk-facts" aria-label="At a glance"><div class="container"><dl class="mk-facts-grid">${[
    ['8% + Bank Rate', 'Statutory interest a year on late business invoices'],
    ['£40 to £100', 'Fixed compensation per invoice, on top of interest'],
    ['Six stages', 'From a pre-due reminder to a letter before action'],
    ['No integration', 'Type invoices in or import a CSV from your accounts'],
  ].map(([v, l]) => html`<div><dt>${v}</dt><dd>${l}</dd></div>`)}</dl></div></section>`;

  const calc = html`<section class="mk-calc" id="calculator" aria-labelledby="calc-title"><div class="container"><div class="mk-calc-inner"><div class="mk-calc-copy">${kicker('Free calculator')}<h2 class="mk-calc-title" id="calc-title">What is one late invoice worth?</h2><p>Enter an unpaid invoice to see the statutory interest and fixed compensation you could add to it today.</p></div><form class="mk-calc-form" method="get" action="/calculator"><div class="mk-calc-field"><label for="lc-amount">Amount owed</label><div class="input-affix"><span class="affix">£</span><input id="lc-amount" name="amount" inputmode="decimal" autocomplete="off" placeholder="2,400.00" required></div></div><div class="mk-calc-field"><label for="lc-due">Date it was due</label><input id="lc-due" name="due" type="date" required></div>${button('Work it out', { variant: 'primary' })}</form></div></div></section>`;

  const segments = html`<section class="mk-section mk-section-tint" id="who"><div class="container">${head('Who it’s for', 'For businesses that invoice other businesses, and chase it themselves.', 'Usually 1 to 50 people, with nobody whose job is credit control. If you sell to consumers, the statutory interest rules don’t apply, so PaidOnTime isn’t for you.')}<div class="mk-segments">${SEGMENTS.map(
    ([title, text]) => html`<div class="mk-segment"><h3>${title}</h3><p>${text}</p></div>`,
  )}</div></div></section>`;

  const problem = html`<section class="mk-section" id="problem"><div class="container mk-split"><div class="mk-split-head">${kicker('Why it matters')}<h2 class="mk-h2">Late payment is a cost most businesses never put a number on.</h2></div><div class="mk-split-body"><p class="mk-lede">Most small firms chase when they remember, feel awkward doing it, and never claim the interest the law already gives them. So the customers who pay last still get paid first.</p><dl class="mk-stats">${STATS.map(
    ([v, l]) => html`<div><dt>${v}</dt><dd>${l}</dd></div>`,
  )}</dl><p class="mk-source">Source: <a href="https://www.smallbusinesscommissioner.gov.uk/late-payments-research-2/" rel="noopener noreferrer" target="_blank">Late Payments Research</a>, London Economics for the Department for Business and Trade and the Office of the Small Business Commissioner, July 2025.</p></div></div></section>`;

  const feature = (label, title, text, points, visual, flip = false, extra = '') => html`<div class="${flip ? 'mk-feature mk-feature-flip' : 'mk-feature'}"><div class="mk-feature-copy"><p class="mk-feature-label">${label}</p><h3>${title}</h3><p>${text}</p><ul class="mk-points">${points.map((p) => html`<li>${icon('check')}<span>${p}</span></li>`)}</ul>${extra}</div><div class="mk-feature-visual">${visual}</div></div>`;
  const how = html`<section class="mk-section" id="how"><div class="container">${head('How it works', 'One routine for every unpaid invoice.', 'Add customers and unpaid invoices by hand or from a CSV export. PaidOnTime then tells you what to send, writes it with the right figures, and keeps the record.')}${
    feature('Chase list', 'Know who to chase this week, and in what order.', 'Every unpaid invoice sits on a chase calendar with its next action and the day it falls due, from a pre-due reminder to a letter before action. Work through it on Monday; broken promises come back on their own.', [
      'The week’s list in your inbox every Monday morning',
      'Subscribe in Google Calendar or Outlook',
      'Calls, promises and disputes logged against the invoice',
    ], agendaMock())
  }${
    feature('Templates', 'Every reminder written, with the right figures in it.', 'Six templates and a phone script cover the whole ladder. Each one fills in the invoice, balance, dates, your bank details and the interest to date. Nothing goes out until you have read it.', [
      'Edit any template to sound like you',
      'Send from PaidOnTime and it’s logged automatically',
      'Letters print cleanly or save as PDF',
    ], composeMock(), true)
  }${
    feature('Interest and compensation', 'Know what you can claim, to the penny.', 'PaidOnTime applies the Late Payment of Commercial Debts (Interest) Act 1998: 8% plus the Bank of England reference rate fixed for the half-year, simple interest from the day after the due date, part payments taken into account, and the £40, £70 or £100 fixed sum.', [
      'Reference rates built in, with the source shown',
      'Part payments reduce interest from the day they arrive',
      'Claim letters and letter before action set out the sums',
    ], calcMock(), false, html`<p class="mk-aside">The Commercial Payments Bill, introduced to Parliament in May 2026, would make statutory interest mandatory and cap payment terms at 60 days. <a href="/calculator">Work out what an invoice is owed now</a>.</p><p class="mk-sources">Built on ${SOURCES.map(([label, href], i) => html`${i ? (i === SOURCES.length - 1 ? ' and ' : ', ') : ''}<a href="${href}" rel="noopener noreferrer" target="_blank">${label}</a>`)}.</p>`)
  }<div class="mk-inline-cta"><p><strong>See it with your own invoices.</strong> Setting up takes about ten minutes, and the trial needs no card.</p><div class="mk-actions">${button('Start free trial', { href: '/signup', variant: 'primary' })}${button('Explore the demo', { href: '/demo' })}</div></div></div></section>`;

  const ladder = html`<section class="mk-section mk-section-tint" id="ladder"><div class="container">${head('The chase ladder', 'Six steps from a polite nudge to a letter before action.', 'Each stage has its own template, timing and tone. The timings follow these defaults until you change them to suit your terms.')}<ol class="mk-ladder">${LADDER.map(
    (s, i) => html`<li class="mk-rung mk-rung-${s.tone}"><p class="mk-rung-when"><span class="mk-rung-n">${i}</span>${s.when}</p><h3>${s.name}</h3><p>${s.text}</p></li>`,
  )}</ol></div></section>`;

  const tools = html`<section class="mk-section" id="features"><div class="container">${head('Beyond chasing', 'The rest of a credit controller’s toolkit.', 'The routines a good credit controller would set up for you, in the same place as the chasing.')}<div class="mk-grid">${TOOLS.map(
    (t) => html`<div class="mk-tool">${icon(t.icon)}<h3>${t.title}</h3><p>${t.text}</p></div>`,
  )}</div></div></section>`;

  const compare = html`<section class="mk-section mk-section-tint" id="compare"><div class="container">${head('How it compares', 'More than a calculator. Less than a monthly bill.')}<div class="mk-table-wrap"><table class="mk-table"><thead><tr><th scope="col"><span class="sr-only">Feature</span></th>${COMPARE_COLS.map(
    (c, i) => html`<th scope="col"${i === 3 ? html` class="mk-us"` : ''}>${c}</th>`,
  )}</tr></thead><tbody>${COMPARE.map(([label, ...cells]) => html`<tr><th scope="row">${label}</th>${cells.map(
    (c, i) => html`<td data-label="${COMPARE_COLS[i]}"${i === 3 ? html` class="mk-us"` : ''}>${c}</td>`,
  )}</tr>`)}</tbody></table></div></div></section>`;

  const pricing = html`<section class="mk-section" id="pricing"><div class="container">${head('Pricing', 'Pay once. Chase for good.', `One payment, no subscription. Every workspace starts with a ${trial}-day free trial of Complete.`)}<div class="mk-pricing">${pricingGrid(def)}<aside class="mk-includes"><h3>Every plan includes</h3><ul class="mk-points">${[
    `A ${trial}-day free trial of Complete, no card needed`,
    'Unlimited customers and invoices',
    'CSV import, and export of everything at any time',
    'Demo data to learn on, removed in one click',
    'Guides and a credit control SOP, built in',
  ].map((p) => html`<li>${icon('check')}<span>${p}</span></li>`)}</ul><p class="mk-roi"><strong>One claim can cover it.</strong> The fixed compensation on a single late invoice of £1,000 or more is £70, more than Core costs.</p></aside></div></div></section>`;

  const faq = html`<section class="mk-section mk-section-rule" id="faq"><div class="container mk-split"><div class="mk-split-head">${kicker('Questions')}<h2 class="mk-h2">The details, answered.</h2><p class="mk-muted">Something else? <a href="/contact">Send us a question</a> and we'll reply by email.</p></div><div class="mk-split-body">${faqList(def)}</div></div></section>`;

  const closing = html`<section class="mk-cta"><div class="container mk-cta-inner"><h2>Start with this Monday’s chase list.</h2><p>Add your unpaid invoices in about ten minutes, or open a demo workspace with invoices at every stage of the ladder.</p><div class="mk-actions">${
    button('Start free trial', { href: '/signup', variant: 'primary', size: 'lg' })
  }${button('Explore the demo', { href: '/demo', size: 'lg' })}</div></div></section>`;

  return html`${hero}${facts}${calc}${problem}${segments}${how}${ladder}${tools}${compare}${pricing}${faq}${closing}`;
}
