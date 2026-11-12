// End-to-end tests for PaidOnTime over real HTTP: sample data, figures and next actions (the v0.9 kit's QA tests 5 and 6),
// sending and logging reminders, payments, the chase log, validation, plan features, the calendar feed, the Monday email,
// the demo, the public calculator and the waitlist.
process.env.APP_TODAY = '2026-11-11';

const { test, before, after } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const { startTestApp } = await import('../../../test/helpers.js');
const { definition } = await import('../definition.js');

let t;
let owner;
let org;
const OWNER = { name: 'Priya Shah', email: 'priya@example.com', orgName: 'Shah Interiors Ltd', password: 'copper-kettle-77' };

before(async () => {
  t = await startTestApp({ definition });
  owner = t.client();
  await owner.get('/signup');
  const r = await owner.post('/signup', OWNER);
  assert.equal(r.status, 303, r.text.slice(0, 300));
  org = t.db.get('SELECT * FROM orgs ORDER BY id LIMIT 1');
});
after(async () => {
  await t?.stop();
});

const ctxFor = (orgId = org.id) => ({ org: t.services.auth.getOrg(orgId), services: t.services, cache: {}, user: null, role: 'owner' });
const invoices = (orgId) => {
  const { resources } = t.services;
  return Object.fromEntries(resources.query(ctxFor(orgId), resources.get('invoices'), { all: true }).rows.map((i) => [i.number, i]));
};
const customers = (orgId) => {
  const { resources } = t.services;
  return Object.fromEntries(resources.query(ctxFor(orgId), resources.get('customers'), { all: true }).rows.map((c) => [c.name.replace('SAMPLE · ', ''), c]));
};
const idOf = (number) => t.db.get('SELECT id FROM r_invoices WHERE org_id = ? AND number = ?', org.id, number).id;
const text = (r) => r.text.replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

test('public pages sell the whole system and price it as a one-off', async () => {
  const c = t.client();
  const home = await c.get('/');
  assert.equal(home.status, 200);
  assert.match(text(home), /Get paid on time/);
  assert.match(text(home), /chase calendar/i);
  const pricing = text(await c.get('/pricing'));
  assert.match(pricing, /£49 one-off/);
  assert.match(pricing, /£99 one-off/);
  assert.doesNotMatch(pricing, /\/ month/);
  const terms = text(await c.get('/terms'));
  assert.match(terms, /one-off payment/);
  assert.match(terms, /refund policy to be decided/);
  const calc = text(await c.get('/calculator?amount=1000&due=2026-01-01&until=2026-02-20&rate=0.5'));
  assert.match(calc, /£11\.64/);
  assert.match(calc, /£70\.00/); // £1,000 is in the £70 band
  const auto = text(await c.get('/calculator?amount=2400&due=2026-10-01&until=2026-11-11'));
  assert.match(auto, /base rate on 30 Jun 2026: 3\.75%/);
  assert.match(text(await c.get('/calculator?amount=abc&due=')), /Enter the amount owed/);
});

test('new workspaces get templates and the v0.9 sample customers with the right totals', () => {
  assert.equal(t.db.get('SELECT COUNT(*) AS n FROM r_templates WHERE org_id = ? AND is_sample = 0', org.id).n, 8);
  const c = customers();
  assert.equal(c['Brightside Joinery Ltd'].outstanding, 2400);
  assert.equal(c['Brightside Joinery Ltd'].credit_check, 'Over 30 days overdue');
  assert.equal(c['Northgate Events Ltd'].outstanding, 13350);
  assert.equal(c['Northgate Events Ltd'].credit_check, 'Over credit limit');
  assert.equal(c['J. Patel (sole trader)'].outstanding, 640);
  assert.equal(c['Harbour Dental LLP'].outstanding, 4130);
  assert.equal(c['Harbour Dental LLP'].overdue, 980);
  assert.equal(c['Kestrel IT Services Ltd'].outstanding, 3200);
});

test('sample invoices show the right figures and next actions', () => {
  const i = invoices();
  assert.equal(i['INV-1005'].next.stage, 0);
  assert.equal(i['INV-1001'].next.kind, 'broken');
  assert.equal(i['INV-1001'].days_overdue, 41);
  assert.equal(i['INV-1001'].ref_rate, 3.75);
  assert.equal(i['INV-1001'].interest, 31.68); // 2400 × 11.75% × 41 ÷ 365
  assert.equal(i['INV-1001'].fixed_sum, 70);
  assert.equal(i['INV-1002'].next.stage, 3);
  assert.equal(i['INV-1003'].next.stage, 5);
  assert.equal(i['INV-1003'].fixed_sum, 100);
  assert.equal(i['INV-1004'].next.stage, 2);
  assert.equal(i['INV-1006'].next.kind, 'paid-late');
  assert.equal(i['INV-1006'].days_overdue, 16);
  assert.equal(i['INV-1007'].next.kind, 'dispute');
  assert.equal(i['INV-1008'].next.label, 'Paid');
  assert.equal(i['INV-1008'].fixed_sum, 0);
  assert.equal(i['INV-1009'].status, 'On payment plan');
  assert.equal(i['INV-1009'].balance, 3200);
  assert.equal(i['INV-1009'].next.kind, 'promise');
});

test('the dashboard, chase list and board show the work to do', async () => {
  const dash = text(await owner.get('/app'));
  assert.match(dash, /To chase now/);
  assert.match(dash, /Letter before action/);
  assert.match(dash, /Customers to watch/);
  const list = text(await owner.get('/app/chase'));
  assert.match(list, /Overdue actions/);
  assert.match(list, /Chase the broken promise to pay by 19 Oct 2026/);
  const board = text(await owner.get('/app/chase/board'));
  assert.match(board, /5 · Letter before action/);
  assert.match(board, /On payment plan/);
  const view = text(await owner.get('/app/invoices?view=now'));
  assert.match(view, /INV-1003/);
  assert.doesNotMatch(view, /INV-1008/);
});

test('composing fills in the figures and sending logs the email and the contact', async () => {
  const id = idOf('INV-1002');
  const page = await owner.get(`/app/invoices/${id}/compose?t=3`);
  assert.equal(page.status, 200);
  assert.match(page.text, /Final notice: invoice INV-1002, £850\.00/);
  assert.match(page.text, /Check before sending/); // Template 3's optional "[and to pause further work…]" clause
  assert.match(page.text, /optional wording/);
  const lba = text(await owner.get(`/app/invoices/${idOf('INV-1004')}/compose?t=5`));
  assert.match(lba, /Pre-Action Protocol/);
  assert.match(lba, /11 December 2026/); // sole trader: 30 days to reply
  const sent = await owner.post(`/app/invoices/${id}/compose`, { t: '3', to: 'accounts@n-sample.example', subject: 'Final notice: invoice INV-1002', body: 'Please pay £850.00 by 18 November 2026.', send: '1' });
  assert.equal(sent.status, 303);
  assert.equal(sent.location, `/app/invoices/${id}`);
  const mail = t.db.get("SELECT * FROM outbox WHERE related = 'chase' ORDER BY id DESC LIMIT 1");
  assert.equal(mail.to_addr, 'accounts@n-sample.example');
  assert.equal(mail.reply_to, OWNER.email);
  const logged = t.db.get('SELECT * FROM r_chases WHERE org_id = ? AND invoice = ? ORDER BY id DESC LIMIT 1', org.id, id);
  assert.equal(logged.stage, '3 · Final notice');
  assert.equal(logged.outcome, 'Sent');
  assert.equal(logged.outbox_id, mail.id);
  assert.equal(logged.next_follow_up, '2026-11-18');
  const after = invoices()['INV-1002'].next;
  assert.equal(after.kind, 'follow-up');
  assert.equal(after.on, '2026-11-18');
  const bad = await owner.post(`/app/invoices/${id}/compose`, { t: '3', to: 'not-an-email', subject: 'x', body: 'y', send: '1' });
  assert.equal(bad.status, 422);
  const letter = await owner.post(`/app/invoices/${idOf('INV-1003')}/letter`, { t: '5', subject: 'Unpaid invoice', body: '**Shah Interiors Ltd**\n\n| Item | Amount |\n| --- | --- |\n| Invoice | £12,500.00 |' });
  assert.equal(letter.status, 200);
  assert.match(letter.text, /<table class="md-table">/);
  assert.match(letter.text, /Print or save as PDF/);
  const logLetter = await owner.post(`/app/invoices/${idOf('INV-1003')}/log-letter`, { t: '5' });
  assert.equal(logLetter.status, 303);
  assert.equal(t.db.get('SELECT channel FROM r_chases WHERE org_id = ? ORDER BY id DESC LIMIT 1', org.id).channel, 'Letter');
});

test('settings fill the merge fields', async () => {
  await owner.get('/app/settings');
  const r = await owner.post('/app/settings', {
    org_name: 'Shah Interiors Ltd', company_name: 'Shah Interiors Ltd', sender_name: 'Priya Shah', phone: '0113 496 0000', bank_details: 'Shah Interiors Ltd, 12-34-56, 12345678',
    default_terms: '30', stop_days: '30', weekly_digest: '1', pre_due_days: '3', stage2_from: '8', stage3_from: '15', stage4_from: '31', stage5_from: '46',
  });
  assert.equal(r.status, 303, text(r).slice(0, 300));
  const page = await owner.get(`/app/invoices/${idOf('INV-1005')}/compose?t=0`);
  assert.match(page.text, /12-34-56, 12345678/);
  assert.match(page.text, /Priya Shah/);
});

test('part payments reduce the balance and interest, and full payment marks the invoice paid', async () => {
  const id = idOf('INV-1004');
  await owner.get(`/app/payments/new?invoice=${id}`);
  const part = await owner.post('/app/payments', { invoice: String(id), date: '2026-11-11', amount: '240', method: 'Bank transfer' });
  assert.equal(part.status, 303);
  assert.equal(part.location, `/app/invoices/${id}`);
  let inv = invoices()['INV-1004'];
  assert.equal(inv.balance, 400);
  assert.equal(inv.status, 'Open');
  const over = await owner.post('/app/payments', { invoice: String(id), date: '2026-11-11', amount: '500', method: 'Bank transfer' });
  assert.equal(over.status, 422);
  assert.match(text(over), /Only £400\.00 is still owed/);
  await owner.post('/app/payments', { invoice: String(id), date: '2026-11-11', amount: '400', method: 'Bank transfer' });
  inv = invoices()['INV-1004'];
  assert.equal(inv.status, 'Paid');
  assert.equal(inv.paid_date, '2026-11-11');
  assert.equal(inv.next.kind, 'paid-late');
  // Deleting a payment reopens the invoice.
  const last = t.db.get('SELECT id FROM r_payments WHERE org_id = ? AND invoice = ? ORDER BY id DESC LIMIT 1', org.id, id).id;
  await owner.post(`/app/payments/${last}/delete`);
  assert.equal(invoices()['INV-1004'].status, 'Open');
});

test('chase log outcomes update the invoice', async () => {
  const id = idOf('INV-1002');
  await owner.get('/app/chases/new');
  await owner.post('/app/chases', { invoice: String(id), date: '2026-11-11', channel: 'Phone', stage: '3 · Final notice', outcome: 'Promise to pay', promised_date: '2026-11-20' });
  assert.equal(invoices()['INV-1002'].promised_date, '2026-11-20');
  assert.equal(invoices()['INV-1002'].next.kind, 'promise');
  await owner.post('/app/chases', { invoice: String(id), date: '2026-11-11', channel: 'Email', stage: 'Dispute', outcome: 'Dispute raised' });
  assert.equal(invoices()['INV-1002'].status, 'Disputed');
  const resolve = await owner.post(`/app/invoices/${id}/action/resolve`);
  assert.equal(resolve.status, 303);
  assert.equal(invoices()['INV-1002'].status, 'Open');
});

test('invoices validate numbers, consumer claims and default the due date from terms', async () => {
  const cust = t.db.get("SELECT id FROM r_customers WHERE org_id = ? AND name LIKE '%Brightside%'", org.id).id;
  await owner.get('/app/invoices/new');
  const made = await owner.post('/app/invoices', { number: 'INV-2001', customer: String(cust), invoice_date: '2026-11-01', amount: '1500', status: 'Open', claim_interest: '1' });
  assert.equal(made.status, 303);
  assert.equal(t.db.get("SELECT due_date FROM r_invoices WHERE number = 'INV-2001'").due_date, '2026-12-01');
  const dup = await owner.post('/app/invoices', { number: 'inv-2001', customer: String(cust), invoice_date: '2026-11-01', amount: '10', status: 'Open' });
  assert.equal(dup.status, 422);
  assert.match(text(dup), /already has this number/);
  await owner.get('/app/customers/new');
  await owner.post('/app/customers', { name: 'Jo Bloggs', customer_type: 'Consumer (not a business)', terms_days: '14', account_status: 'Active' });
  const consumer = t.db.get("SELECT id FROM r_customers WHERE name = 'Jo Bloggs'").id;
  const claim = await owner.post('/app/invoices', { number: 'INV-2002', customer: String(consumer), invoice_date: '2026-11-01', amount: '100', status: 'Open', claim_interest: '1' });
  assert.equal(claim.status, 422);
  assert.match(text(claim), /only applies to business customers/);
  const ok = await owner.post('/app/invoices', { number: 'INV-2002', customer: String(consumer), invoice_date: '2026-11-01', amount: '100', status: 'Open', claim_interest: '0' });
  assert.equal(ok.status, 303);
});

test('reference rates entered by the workspace fill gaps in the built-in table', async () => {
  const cust = t.db.get("SELECT id FROM r_customers WHERE org_id = ? AND name LIKE '%Kestrel%'", org.id).id;
  t.db.run("INSERT INTO r_invoices (org_id, created_at, updated_at, is_sample, number, customer, invoice_date, due_date, amount, status, claim_interest) VALUES (?, '2026-01-01', '2026-01-01', 0, 'INV-2027', ?, '2026-12-01', '2026-12-31', 1000, 'Open', 1)", org.id, cust);
  // Not overdue yet on 11 Nov 2026, but the rate check already says which date to look up.
  assert.match(invoices()['INV-2027'].rate_check, /31 Dec 2026 isn't known yet/);
  await owner.get('/app/rates/new');
  const bad = await owner.post('/app/rates', { from: '2027-02-01', rate: '4' });
  assert.equal(bad.status, 422);
  const good = await owner.post('/app/rates', { from: '2027-01-01', rate: '4', checked_by: 'PS' });
  assert.equal(good.status, 303);
  assert.equal(invoices()['INV-2027'].ref_rate, 4);
});

test('the calendar feed lists next actions and its link can be replaced', async () => {
  const token = t.db.get('SELECT feed_token FROM orgs WHERE id = ?', org.id).feed_token;
  const feed = await t.client().get(`/feed/${token}.ics`);
  assert.equal(feed.status, 200);
  assert.match(feed.headers.get('content-type'), /text\/calendar/);
  assert.match(feed.text, /BEGIN:VCALENDAR/);
  assert.match(feed.text, /DTSTART;VALUE=DATE:20261111/);
  // The letter before action was logged earlier, so INV-1003's next step is deciding on formal recovery.
  assert.match(feed.text.replace(/\r\n /g, ''), /SUMMARY:Decide on formal recovery \(take advice first\): INV-1003/);
  assert.match(feed.text.replace(/\r\n /g, ''), /SUMMARY:Pre-due reminder: INV-1005/);
  assert.equal((await t.client().get('/feed/not-a-real-token-123.ics')).status, 404);
  await owner.get('/app/chase/calendar');
  await owner.post('/app/chase/calendar/reset');
  assert.equal((await t.client().get(`/feed/${token}.ics`)).status, 404);
});

test('Core plan features are limited and Complete unlocks them', async () => {
  await owner.get('/app/billing');
  await owner.post('/app/billing/simulate', { plan: 'core' });
  const lba = text(await owner.get(`/app/invoices/${idOf('INV-1003')}/compose?t=5`));
  assert.match(lba, /part of the Complete plan/);
  const send = await owner.post(`/app/invoices/${idOf('INV-1003')}/compose`, { t: '4', to: 'a@b.co', subject: 's', body: 'b', send: '1' });
  assert.equal(send.status, 402);
  assert.match(text(await owner.get('/app/reports')), /part of the Complete plan/);
  assert.match(text(await owner.get('/app/policy')), /part of the Complete plan/);
  assert.match(text(await owner.get(`/app/invoices/${idOf('INV-1002')}/compose?t=1`)), /Send email and log it/);
  const billing = text(await owner.get('/app/billing'));
  assert.match(billing, /Activate Complete/);
  await owner.post('/app/billing/simulate', { plan: 'complete' });
  assert.match(text(await owner.get('/app/billing')), /Included/);
  assert.match(text(await owner.get('/app/reports')), /Share of invoices paid on time/);
  const statement = await owner.get(`/app/customers/${t.db.get("SELECT id FROM r_customers WHERE org_id = ? AND name LIKE '%Northgate%'", org.id).id}/statement`);
  assert.match(text(statement), /Statement of account/);
  assert.match(text(statement), /INV-1003/);
  await owner.get('/app/policy');
  const saved = await owner.post('/app/policy', { policy_owner: 'Office manager', policy_approver: 'Managing director', policy_limit: '5000', policy_claim: 'We will claim' });
  assert.equal(saved.status, 303);
  const policy = text(await owner.get('/app/policy'));
  assert.match(policy, /Standard limit £5,000/);
  assert.match(policy, /We will claim statutory interest/);
  assert.match(text(await owner.get('/app/guides/sop')), /Owner: Office manager/);
});

test('the Monday email lists the week and only goes out once', async () => {
  const daily = definition.jobs.daily;
  const fresh = t.services.auth.getOrg(org.id);
  assert.deepEqual(await daily(t.services, fresh, '2026-11-11'), { skipped: 'not Monday' });
  const out = await daily(t.services, fresh, '2026-11-16');
  assert.ok(out.actions > 0);
  assert.equal(out.sent, 1);
  const mail = t.db.get("SELECT * FROM outbox WHERE related = 'digest' ORDER BY id DESC LIMIT 1");
  assert.equal(mail.to_addr, OWNER.email);
  assert.match(mail.body_text, /Do today/);
  assert.match(mail.body_text, /INV-1001 .*Chase the broken promise/);
  assert.equal((await daily(t.services, fresh, '2026-11-16')).sent, 0);
});

test('removing sample data keeps templates and your own records', async () => {
  await owner.get('/app/settings');
  const r = await owner.post('/app/settings/remove-samples');
  assert.equal(r.status, 303);
  assert.equal(t.db.get('SELECT COUNT(*) AS n FROM r_invoices WHERE org_id = ? AND is_sample = 1', org.id).n, 0);
  assert.equal(t.db.get('SELECT COUNT(*) AS n FROM r_templates WHERE org_id = ?', org.id).n, 8);
  assert.ok(t.db.get("SELECT id FROM r_invoices WHERE org_id = ? AND number = 'INV-2001'", org.id));
});

test('the demo works end to end without sending email', async () => {
  const v = t.client();
  await v.get('/demo');
  const r = await v.post('/demo');
  assert.equal(r.status, 303);
  const demo = t.db.get('SELECT * FROM orgs WHERE is_demo = 1 ORDER BY id DESC LIMIT 1');
  const inv = t.db.get("SELECT id FROM r_invoices WHERE org_id = ? AND number = 'INV-1002'", demo.id).id;
  await v.get(`/app/invoices/${inv}/compose?t=3`);
  const sent = await v.post(`/app/invoices/${inv}/compose`, { t: '3', to: 'accounts@n-sample.example', subject: 'Final notice', body: 'Please pay.', send: '1' });
  assert.equal(sent.status, 303);
  const mail = t.db.get('SELECT * FROM outbox WHERE org_id = ? ORDER BY id DESC LIMIT 1', demo.id);
  assert.equal(mail.provider, 'demo');
  assert.deepEqual(await definition.jobs.daily(t.services, t.services.auth.getOrg(demo.id), '2026-11-16'), { skipped: 'off' });
});

test('the waitlist records interest once per email and ignores bots', async () => {
  const c = t.client();
  await c.get('/waitlist');
  const bad = await c.post('/waitlist', { name: '', email: 'nope' });
  assert.equal(bad.status, 422);
  const ok = await c.post('/waitlist', { name: 'Sam Lee', email: 'Sam@Example.com', company: 'Lee Plumbing', staff: '2–9', invoices: '10–49', today: 'Spreadsheet and email', price: '£49 one-off (Core)' });
  assert.equal(ok.status, 200);
  assert.match(text(ok), /you're on the list/i);
  await c.post('/waitlist', { name: 'Sam Lee', email: 'sam@example.com', price: '£99 one-off (Complete)' });
  const rows = t.db.all("SELECT * FROM leads WHERE kind = 'waitlist'");
  assert.equal(rows.length, 1);
  assert.equal(JSON.parse(rows[0].data).price, '£99 one-off (Complete)');
  await c.post('/waitlist', { name: 'Bot', email: 'bot@example.com', website: 'http://spam' });
  assert.equal(t.db.get("SELECT COUNT(*) AS n FROM leads WHERE kind = 'waitlist'").n, 1);
  const { waitlistCsv } = await import('../pages/guides.js');
  assert.match(waitlistCsv(t.db), /sam@example\.com.*£99 one-off/);
});
