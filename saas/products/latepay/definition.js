// PaidOnTime: the UK Late Payment & Credit Control Kit as a working app on the shared core.
import { HttpError, addDays, todayISO, fmtGBP, fmtDateUK } from '../../core/util.js';
import { html } from '../../core/ui.js';
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
import { landingBody } from './pages/landing.js';
import { registerSearch } from '../../core/search.js';
import { trialEmails } from './lifecycle.js';

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
  { key: 'stop_days', label: 'Pause work when an invoice is more than this many days overdue', type: 'int', min: 1, max: 365, required: true, group: 'Credit control' },
  { key: 'weekly_digest', label: 'Email admins the chase list every Monday morning', type: 'bool', group: 'Credit control' },
  { key: 'email_footer', label: 'Add “Sent with PaidOnTime” to the end of reminder emails (removed on the Complete plan)', type: 'bool', group: 'Credit control' },
  { key: 'pre_due_days', label: 'Pre-due reminder: days before the due date', type: 'int', min: 0, max: 30, required: true, group: 'Chase ladder (days overdue each stage starts)' },
  { key: 'stage2_from', label: 'Stage 2, firm reminder and call', type: 'int', min: 2, max: 365, required: true, group: 'Chase ladder (days overdue each stage starts)' },
  { key: 'stage3_from', label: 'Stage 3, final notice', type: 'int', min: 3, max: 365, required: true, group: 'Chase ladder (days overdue each stage starts)' },
  { key: 'stage4_from', label: 'Stage 4, interest and compensation claim', type: 'int', min: 4, max: 365, required: true, group: 'Chase ladder (days overdue each stage starts)' },
  { key: 'stage5_from', label: 'Stage 5, letter before action', type: 'int', min: 5, max: 400, required: true, group: 'Chase ladder (days overdue each stage starts)' },
  { key: 'trial_emails', label: 'During the free trial, email owners and admins a few reminders (getting started, a summary of what you’re owed, and when the trial ends)', type: 'bool', group: 'Emails from PaidOnTime' },
];

// The mark: a clock face whose hands form a tick. Colours come from the theme via the logo-* classes.
const LOGO_SVG = '<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><rect class="logo-bg" width="32" height="32" rx="8"/><circle class="logo-fg" cx="16" cy="16" r="9.4" fill="none" stroke-width="2.1"/><path class="logo-fg" d="m11.4 15.2 3.9 3.9 6.3-7.2" fill="none" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export const definition = {
  slug: 'latepay',
  name: 'PaidOnTime',
  logoText: '£',
  logoSvg: LOGO_SVG,
  search: { placeholder: 'Search customers and invoices' },
  quickCreate: { label: 'New invoice', href: '/app/invoices/new' },
  tagline: 'Credit control for UK small businesses',
  description: 'A chase calendar, ready-to-send reminders and letters, and the statutory interest and compensation UK law lets you claim, worked out for every late invoice.',
  port: 3101,
  publicDir: new URL('./public/', import.meta.url),
  theme: { css: 'theme.css', color: '#0f5f4a', favicon: 'favicon.svg' },
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
  defaultSettings: { default_terms: 30, stop_days: 30, weekly_digest: true, email_footer: true, trial_emails: true, ...DEFAULT_LADDER },
  settingsFields: SETTINGS_FIELDS,
  // The ladder silently reorders out-of-order stages, so refuse them instead of saving numbers that aren't used.
  validateSettings(values) {
    const errors = {};
    const order = [['stage2_from', 'Stage 2'], ['stage3_from', 'Stage 3'], ['stage4_from', 'Stage 4'], ['stage5_from', 'Stage 5']];
    for (let i = 1; i < order.length; i++) {
      const [key, label] = order[i];
      const [prevKey, prevLabel] = order[i - 1];
      const v = values[key];
      const prev = values[prevKey];
      if (Number.isInteger(v) && Number.isInteger(prev) && v <= prev) errors[key] = `${label} must start later than ${prevLabel} (day ${prev}).`;
    }
    return errors;
  },
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
    landing: (ctx) => landingBody(ctx),
    featuredLabel: 'Recommended',
    pricingHeadline: 'Pay once. Chase for good.',
    metaDescription: 'Credit control for UK small businesses: a chase calendar, ready-to-send reminders and letters, and statutory late payment interest and compensation worked out. One price, no subscription.',
    footer: [
      { title: 'Product', links: [{ label: 'How it works', href: '/#how' }, { label: 'Pricing', href: '/pricing' }, { label: 'Try the demo', href: '/demo' }, { label: 'Start free trial', href: '/signup' }] },
      { title: 'Free tools', links: [{ label: 'Late payment calculator', href: '/calculator' }, { label: 'Reminder templates', href: '/free/payment-reminder-templates' }, { label: 'Letter before action', href: '/free/letter-before-action' }, { label: 'Payment terms', href: '/free/payment-terms' }] },
      { title: 'Company', links: [{ label: 'Contact', href: '/contact' }, { label: 'Log in', href: '/login' }] },
      { title: 'Legal', links: [{ label: 'Terms', href: '/terms' }, { label: 'Privacy', href: '/privacy' }] },
    ],
    faq: [
      { q: 'Is it legal to charge interest on late invoices?', a: 'Yes, between businesses. The Late Payment of Commercial Debts (Interest) Act 1998 lets you claim statutory interest at 8% a year plus the Bank of England reference rate, and fixed compensation of £40, £70 or £100 per invoice, unless your contract sets its own late-payment terms. It does not apply to consumer sales.' },
      { q: 'Does it send reminders automatically?', a: 'No. You stay in control: the chase list tells you what is due, and you send each email with one click after checking it. That keeps good customer relationships intact.' },
      { q: 'Do I need to connect my accounting software?', a: 'No. Add invoices by hand or import a CSV export. There is nothing to integrate.' },
      { q: 'Which Bank of England rate does it use?', a: 'The rate in force on 30 June or 31 December before interest starts, as the 2002 Order requires. Published rates are built in; if a debt needs a rate that isn\'t published yet, the app tells you which date to look up.' },
      { q: 'Is this legal advice?', a: 'No. The templates and guides are general information based on official UK guidance. Have a solicitor check the interest claim, the letter before action and your payment terms before you first use them.' },
      { q: 'What does it cost?', a: 'A one-off £49 for Core or £99 for Complete, after a 14-day free trial of everything. No monthly subscription.' },
    ],
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
    registerSearch(router);
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
    router.post('/app/chase/skip/:id', chaseSkip);
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
    /** Each day: the trial email that's due (if any), then the Monday chase list. */
    async daily(services, org, date) {
      const trial = await trialEmails(services, org, date);
      const digest = await definition.jobs.digest(services, org, date);
      return trial ? { ...digest, trial } : digest;
    },
    /** Monday morning: email the week's chase list to the workspace's owners and admins. */
    async digest(services, org, date) {
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
