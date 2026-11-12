// PaidOnTime: the UK Late Payment & Credit Control Kit as a working app on the shared core.
import { HttpError, addDays, todayISO, fmtGBP, fmtDateUK } from '../../core/util.js';
import { html, badge } from '../../core/ui.js';
import { BUSINESS_FIELDS } from '../../core/workspace.js';
import { buildResources, seedTemplates, allInvoices, base } from './resources.js';
import { seedSamples } from './lib/sample.js';
import { DEFAULT_LADDER } from './lib/ladder.js';
import {
  dashboard, chaseList, chaseNext, chaseSkip, chaseBoard, calendarPage, icsFeed, resetFeed, composePage, composeSend, letterGet, letterPost, logLetter,
  statement, reports, invoiceDetail, invoiceSide, customerDetail,
} from './pages/app.js';
import { guidePage, guidePrint, policyPage, policySave, policyPrint, publicCalculator, waitlistGet, waitlistPost } from './pages/guides.js';
import { freePage, freeTermsPage } from './pages/free.js';
import { registerFounder, isFounder } from './pages/founder.js';

const resources = buildResources();
const R = Object.fromEntries(resources.map((r) => [r.name, r]));
R.invoices.detail = invoiceDetail;
R.invoices.sidePanel = invoiceSide;
R.invoices.detailSubtitle = (row) => `${row.customer__label || ''} · ${fmtGBP(row.amount)} · due ${row.due_date ? fmtDateUK(row.due_date) : '—'}`;
R.customers.detail = customerDetail;
// The figures and next-action cards already show these, so keep them out of the generic Details list.
for (const f of R.invoices.computedFields) if (!['stage_now', 'last_contact', 'rate_check'].includes(f.key)) f.detail = false;
for (const f of R.customers.computedFields) f.detail = false;

const SETTINGS_FIELDS = [
  ...BUSINESS_FIELDS,
  { key: 'bank_details', label: 'Bank details for payments', type: 'textarea', rows: 3, max: 400, group: 'Your business', help: 'Account name, sort code and account number. Filled into [Bank details].' },
  { key: 'payment_link', label: 'Online payment link', type: 'url', group: 'Your business', help: 'Optional. Filled into [Payment link].' },
  { key: 'default_terms', label: 'Standard payment terms (days)', type: 'int', min: 0, max: 120, required: true, group: 'Credit control' },
  { key: 'stop_days', label: 'Pause work when an invoice is this many days overdue', type: 'int', min: 1, max: 365, required: true, group: 'Credit control' },
  { key: 'weekly_digest', label: 'Email admins the chase list every Monday morning', type: 'bool', group: 'Credit control' },
  { key: 'email_footer', label: 'Add “Sent with PaidOnTime” to the end of reminder emails (removed on the Complete plan)', type: 'bool', group: 'Credit control' },
  { key: 'pre_due_days', label: 'Pre-due reminder: days before the due date', type: 'int', min: 0, max: 30, required: true, group: 'Chase ladder (days overdue each stage starts)' },
  { key: 'stage2_from', label: 'Stage 2, firm reminder and call', type: 'int', min: 2, max: 365, required: true, group: 'Chase ladder (days overdue each stage starts)' },
  { key: 'stage3_from', label: 'Stage 3, final notice', type: 'int', min: 3, max: 365, required: true, group: 'Chase ladder (days overdue each stage starts)' },
  { key: 'stage4_from', label: 'Stage 4, interest and compensation claim', type: 'int', min: 4, max: 365, required: true, group: 'Chase ladder (days overdue each stage starts)' },
  { key: 'stage5_from', label: 'Stage 5, letter before action', type: 'int', min: 5, max: 400, required: true, group: 'Chase ladder (days overdue each stage starts)' },
];

const tick = '✓';

export const definition = {
  slug: 'latepay',
  name: 'PaidOnTime',
  logoText: '£',
  tagline: 'Credit control for UK small businesses',
  description: 'A chase calendar, ready-to-send reminders and letters, and the statutory interest and compensation UK law lets you claim, worked out for every late invoice.',
  port: 3101,
  publicDir: new URL('./public/', import.meta.url),
  theme: { css: 'theme.css', color: '#0f6e5c' },
  trialDays: 14,
  trialPlan: 'complete',
  demoOrgName: 'Demo Joinery & Fit-out Ltd',
  billingNote: 'One-off payment, no subscription. Prices exclude VAT.',
  plans: [
    {
      id: 'core', name: 'Core', price: 49, oneOff: true, description: 'Chase every invoice on time.',
      features: ['Customers, invoices, payments and chase log', 'Chase calendar, board and Monday email', 'Interest and compensation worked out', 'Templates 0–3 and the phone script', 'Credit control SOP and guides', 'Up to 2 people'],
      limits: { seats: 2 },
    },
    {
      id: 'complete', name: 'Complete', price: 99, oneOff: true, featured: true, description: 'Everything to claim what you\'re owed.',
      features: ['Everything in Core', 'Interest claim and letter before action', 'Customer statements and payment plans', 'Payment terms and credit policy builder', 'Monthly review report', 'Up to 5 people'],
      limits: { seats: 5 },
      flags: { complete: true },
    },
  ],
  defaultSettings: { default_terms: 30, stop_days: 30, weekly_digest: true, email_footer: true, ...DEFAULT_LADDER },
  settingsFields: SETTINGS_FIELDS,
  resources,
  nav: (ctx) => [
    { id: 'dashboard', label: 'Dashboard', href: '/app' },
    { id: 'chase', label: 'Chase list', href: '/app/chase' },
    { id: 'invoices', label: 'Invoices', href: '/app/invoices' },
    { id: 'customers', label: 'Customers', href: '/app/customers' },
    { id: 'payments', label: 'Payments', href: '/app/payments' },
    { id: 'chases', label: 'Chase log', href: '/app/chases' },
    { id: 'templates', label: 'Templates', href: '/app/templates' },
    { id: 'reports', label: 'Monthly review', href: '/app/reports' },
    { id: 'policy', label: 'Credit policy', href: '/app/policy' },
    { id: 'guides', label: 'Guides', href: '/app/guides' },
    ...(isFounder(ctx) ? [{ id: 'founder', label: 'Founder console', href: '/app/founder' }] : []),
  ],
  marketing: {
    cta: 'Start free trial',
    nav: [{ label: 'How it works', href: '/#how' }, { label: 'Pricing', href: '/pricing' }, { label: 'Free calculator', href: '/calculator' }, { label: 'Free templates', href: '/free/payment-reminder-templates' }, { label: 'Demo', href: '/demo' }],
    eyebrow: 'Credit control for UK businesses that invoice other businesses',
    headline: 'Get paid on time, and know exactly what you\'re owed when you\'re not.',
    subhead: 'PaidOnTime tells you what to send next for every unpaid invoice, writes the email or letter for you, and works out the statutory interest and compensation UK law lets you claim: 8% plus the base rate and £40–£100 per invoice.',
    reassurance: '14-day free trial. No card needed. One price after that, no subscription.',
    metaDescription: 'Credit control for UK small businesses: a chase calendar, ready-to-send reminders and letters, and statutory late payment interest and compensation worked out. One price, no subscription.',
    heroPanel: html`<div class="card hero-card"><div class="card-head"><h2>Chase list · Monday</h2></div><div class="card-body"><ul class="action-list">${[
      ['INV-1003', 'Northgate Events Ltd', '£12,500.00 · 63 days overdue', 'Letter before action', 'red'],
      ['INV-1001', 'Brightside Joinery Ltd', '£2,400.00 · 41 days overdue', 'Chase the broken promise', 'red'],
      ['INV-1002', 'Northgate Events Ltd', '£850.00 · 17 days overdue', 'Final notice', 'orange'],
      ['INV-1005', 'Harbour Dental LLP', '£3,150.00 · due tomorrow', 'Pre-due reminder', 'blue'],
    ].map(([n, c, meta, label, tone]) => html`<li class="action-item"><div><strong>${n}</strong> · ${c}<div class="action-meta">${meta}</div></div>${badge(label, tone)}</li>`)}</ul><p class="small muted">Claimable on INV-1003: £253.51 interest + £100 compensation (sample figures)</p></div></div>`,
    problem: {
      title: 'Late payment is costing you more than you think',
      intro: 'Businesses hit by late payment spend 86 hours a year chasing and are owed £17,000 on average. Most chase when they remember, feel awkward doing it, and never claim what the law allows.',
      points: [
        'Chasing is ad hoc, so the customers who pay last get paid first.',
        'Nobody knows which reminder went out, or what was promised on the phone.',
        'You can claim 8% plus the Bank of England rate and up to £100 per invoice, but working out the figure and the wording takes time.',
        'Credit control software costs £45 to £199+ a month and needs an accounting integration.',
      ],
    },
    sections: [
      {
        id: 'stats',
        title: 'The size of the problem',
        body: html`<p class="section-intro">From research for the Department for Business and Trade and the Small Business Commissioner (London Economics, July 2025).</p><div class="kpi-grid">${[
          ['£26bn', 'owed to UK businesses in late payments at any one time'],
          ['14,000', 'businesses close every year because of late payment, 38 a day'],
          ['86 hours', 'a year spent chasing, per affected business'],
          ['£17,000', 'owed on average to each affected business'],
        ].map(([v, l]) => html`<div class="kpi-card"><span class="kpi-value">${v}</span><span class="kpi-label">${l}</span></div>`)}</div><p class="section-intro small muted"><a href="https://www.smallbusinesscommissioner.gov.uk/late-payments-research-2/" rel="noopener noreferrer" target="_blank">Source: Late Payments Research, Office of the Small Business Commissioner</a></p>`,
      },
      {
        id: 'law',
        title: 'The law is on your side, and it is about to get stronger',
        alt: true,
        body: html`<p class="section-intro">The Late Payment of Commercial Debts (Interest) Act 1998 already lets any UK business claim statutory interest and a fixed sum on late business invoices. The Commercial Payments Bill, introduced to Parliament in May 2026, would make that interest mandatory and non-excludable, cap payment terms at 60 days and let the Small Business Commissioner fine persistent late payers.</p><div class="feature-grid">${[
          ['8% + base rate', 'Statutory interest a year on the unpaid balance, from the day after the due date. PaidOnTime uses the right Bank of England reference rate automatically.'],
          ['£40, £70 or £100', 'Fixed compensation per invoice, depending on its size. Claimable on top of interest.'],
          ['The right wording', 'A final notice, an interest claim and a letter before action that set out the figures and the deadline properly. Solicitor review recommended before first use.'],
        ].map(([t, x]) => html`<div class="feature"><h3>${t}</h3><p>${x}</p></div>`)}</div><p class="section-intro"><a href="/calculator">Work out what you are owed on an invoice now</a>.</p>`,
      },
      {
        id: 'compare',
        title: 'Why not a spreadsheet, a free calculator or credit control software?',
        body: html`<div class="table-wrap"><table class="table"><thead><tr><th scope="col"></th><th scope="col">Spreadsheet</th><th scope="col">Free interest calculator</th><th scope="col">Credit control software</th><th scope="col">PaidOnTime</th></tr></thead><tbody>${[
          ['Tells you what to send next, and when', '', '', tick, tick],
          ['Reminder emails and letters written for you', '', '', tick, tick],
          ['Statutory interest and fixed sum worked out', 'If you build it', tick, 'Some', tick],
          ['Credit policy, SOP and weekly routine', '', '', '', tick],
          ['Needs an accounting integration', '', '', 'Yes', 'No'],
          ['Price', 'Free', 'Free', '£45–£199+ a month', '£49 or £99 once'],
        ].map(([label, ...cells]) => html`<tr><th scope="row">${label}</th>${cells.map((c, i) => html`<td data-label="${['Spreadsheet', 'Free calculator', 'Credit control software', 'PaidOnTime'][i]}">${c || html`<span class="muted">—</span>`}</td>`)}</tr>`)}</tbody></table></div>`,
      },
    ],
    featuresTitle: 'The whole chasing process, not just a calculator',
    features: [
      { icon: '📅', title: 'A chase calendar', text: 'Every invoice gets a next action and a date, from a pre-due reminder to a letter before action. Subscribe in Google or Outlook, and get the week\'s list every Monday.' },
      { icon: '✉️', title: 'Emails and letters written for you', text: 'Six templates and a phone script, filled in with the right figures and dates. Edit, send and it\'s logged.' },
      { icon: '£', title: 'What you can claim, worked out', text: 'Statutory interest with the correct Bank of England reference rate, part payments and the £40/£70/£100 fixed sum.' },
      { icon: '🛑', title: 'Credit limits and account stops', text: 'See who is over their limit or long overdue, and when your policy says to pause work.' },
      { icon: '📄', title: 'Your credit policy, done', text: 'Answer a few questions to get an internal credit policy, customer payment terms and invoice wording.' },
      { icon: '📊', title: 'A 20-minute weekly routine', text: 'A credit control SOP, a board by chase stage and a monthly review that shows if chasing is working.' },
    ],
    stepsTitle: 'How it works',
    steps: [
      { title: 'Add customers and unpaid invoices', text: 'Type them in or import a CSV from Xero, QuickBooks, FreeAgent or Sage.' },
      { title: 'Open the chase list on Monday', text: 'It shows what to send to whom, today. Calls and broken promises are flagged.' },
      { title: 'Send, log, get paid', text: 'Send the reminder from the app, record payments, and claim interest when it\'s due.' },
    ],
    faq: [
      { q: 'Is it legal to charge interest on late invoices?', a: 'Yes, between businesses. The Late Payment of Commercial Debts (Interest) Act 1998 lets you claim statutory interest at 8% a year plus the Bank of England reference rate, and fixed compensation of £40, £70 or £100 per invoice, unless your contract sets its own late-payment terms. It does not apply to consumer sales.' },
      { q: 'Does it send reminders automatically?', a: 'No. You stay in control: the chase list tells you what is due, and you send each email with one click after checking it. That keeps good customer relationships intact.' },
      { q: 'Do I need to connect my accounting software?', a: 'No. Add invoices by hand or import a CSV export. There is nothing to integrate.' },
      { q: 'Which Bank of England rate does it use?', a: 'The rate in force on 30 June or 31 December before interest starts, as the 2002 Order requires. Published rates are built in; if a debt needs a rate that isn\'t published yet, the app tells you which date to look up.' },
      { q: 'Is this legal advice?', a: 'No. The templates and guides are general information based on official UK guidance. Have a solicitor check the interest claim, the letter before action and your payment terms before you first use them.' },
      { q: 'What does it cost?', a: 'A one-off £49 for Core or £99 for Complete, after a 14-day free trial of everything. No monthly subscription.' },
    ],
    closing: { title: 'Try PaidOnTime free for 14 days', text: 'The demo is filled with sample invoices at every stage, so you can see the whole routine in two minutes.' },
    pricingIntro: 'One payment, no subscription. Start with a 14-day free trial of the Complete plan.',
    demoIntro: 'Open a private demo workspace with sample customers and invoices at every chase stage: pre-due, overdue, disputed, a broken promise, a payment plan and a letter before action.',
  },
  footerNote: 'General information based on UK government guidance, not legal advice.',
  welcomeEmail: ({ user, config }) => ({
    subject: 'Welcome to PaidOnTime',
    text: `Hello ${user.name},\n\nWelcome to PaidOnTime. Your 14-day free trial of the Complete plan has started.\n\nThree things to do first:\n1. Add your bank details and phone number in Settings, so they fill into every reminder.\n2. Add your customers and unpaid invoices (or import a CSV).\n3. Open the chase list on Monday and work through it.\n\nYour workspace includes fictional SAMPLE records so you can see every stage. Remove them in Settings when you're ready.\n\nSign in: ${config.BASE_URL}/login\n\nPaidOnTime`,
  }),
  onOrgCreated(services, org) {
    const ctx = { org, services, user: null, cache: {}, role: 'owner' };
    seedTemplates(ctx);
    seedSamples(ctx, todayISO(services.config.TIMEZONE));
  },
  routes(router) {
    router.get('/calculator', publicCalculator);
    router.get('/waitlist', waitlistGet);
    router.post('/waitlist', waitlistPost);
    router.get('/free/payment-terms', freeTermsPage);
    router.get('/free/:page', (ctx) => {
      const page = freePage(ctx);
      if (!page) throw new HttpError(404, 'Page not found');
      return page;
    });
    router.get('/feed/:token.ics', icsFeed, { public: true });
    router.get('/app/chase', chaseList);
    router.get('/app/chase/next', chaseNext);
    router.get('/app/chase/skip/:id', chaseSkip);
    router.get('/app/chase/board', chaseBoard);
    router.get('/app/chase/calendar', calendarPage);
    router.post('/app/chase/calendar/reset', resetFeed);
    router.get('/app/reports', reports);
    router.get('/app/guides', guidePage);
    router.get('/app/guides/:doc/print', guidePrint);
    router.get('/app/guides/:doc', guidePage);
    router.get('/app/policy', (ctx) => policyPage(ctx));
    router.post('/app/policy', policySave);
    router.get('/app/policy/print', policyPrint);
    router.get('/app/invoices/:id/compose', (ctx) => composePage(ctx));
    router.post('/app/invoices/:id/compose', composeSend);
    router.get('/app/invoices/:id/letter', letterGet);
    router.post('/app/invoices/:id/letter', letterPost);
    router.post('/app/invoices/:id/log-letter', logLetter);
    router.get('/app/customers/:id/statement', statement);
    registerFounder(router);
  },
  dashboard,
  jobs: {
    /** Monday morning: email the week's chase list to the workspace's owners and admins. */
    async daily(services, org, date) {
      if (org.is_demo || org.settings?.weekly_digest === false) return { skipped: 'off' };
      if (new Date(`${date}T12:00:00Z`).getUTCDay() !== 1) return { skipped: 'not Monday' };
      const ctx = { org, services, user: null, cache: {}, role: 'viewer' };
      const t = base(ctx).today;
      const live = allInvoices(ctx).filter((i) => !i.fig.settled && i.status !== 'Written off' && i.next.on && i.next.on <= addDays(t, 6));
      if (!live.length) return { actions: 0 };
      live.sort((a, b) => (a.next.on < b.next.on ? -1 : 1));
      const { config, db, mailer } = services;
      const line = (i) => `- ${i.number} (${i.customer__label}), ${fmtGBP(i.balance)}: ${i.next.label}${i.next.on > t ? ` on ${i.next.on.split('-').reverse().join('/')}` : ''}`;
      const now = live.filter((i) => i.next.on <= t);
      const later = live.filter((i) => i.next.on > t);
      const text = `Good morning,\n\nHere's this week's chase list for ${org.name}.\n\n${now.length ? `Do today (${now.length}):\n${now.map(line).join('\n')}\n\n` : ''}${later.length ? `Later this week (${later.length}):\n${later.map(line).join('\n')}\n\n` : ''}Open the chase list: ${config.BASE_URL}/app/chase\n\nYou get this because you're an admin of ${org.name}. Turn it off in Settings.\n\nPaidOnTime`;
      const people = db.all("SELECT u.id, u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.org_id = ? AND m.role IN ('owner', 'admin')", org.id);
      let sent = 0;
      for (const p of people) {
        const r = await mailer.send({ orgId: org.id, to: p.email, subject: `Chase list: ${now.length} to do today, ${later.length} later this week`, text, related: 'digest', dedupeKey: `digest:${org.id}:${date}:${p.id}` });
        if (!r.duplicate) sent++;
      }
      return { actions: live.length, sent };
    },
  },
};

export default definition;
