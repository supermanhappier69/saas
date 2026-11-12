// The public site and app shell: the landing page's worked example must match the app's own calculator,
// fonts and marketing styles are served correctly, and workspace search finds records by linked names.
process.env.APP_TODAY = '2026-11-11';

const { test, before, after } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const { startTestApp } = await import('../../../test/helpers.js');
const { definition } = await import('../definition.js');
const { invoiceFigures } = await import('../lib/calc.js');
const { ASSET_VERSION } = await import('../../../core/layout.js');

let t;
let owner;
const OWNER = { name: 'Ada Brooks', email: 'ada@example.com', orgName: 'Brooks Studio Ltd', password: 'quiet-harbour-42' };
const text = (r) => r.text.replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

before(async () => {
  t = await startTestApp({ definition });
  owner = t.client();
  await owner.get('/signup');
  const r = await owner.post('/signup', OWNER);
  assert.equal(r.status, 303, r.text.slice(0, 300));
});
after(async () => {
  await t?.stop();
});

test('the landing page worked example matches the calculator', async () => {
  const fig = invoiceFigures({ amount: 12500, dueDate: '2026-09-10', today: '2026-11-12' });
  assert.equal(fig.daysOverdue, 63);
  assert.equal(fig.reference.rate, 3.75);
  assert.equal(fig.interest, 253.51);
  assert.equal(fig.fixedSum, 100);
  assert.equal(fig.claimable, 353.51);
  const home = await t.client().get('/');
  assert.equal(home.status, 200);
  const page = text(home);
  for (const s of ['£253.51', '£353.51', '£4.02', '11.75% a year', 'Bank Rate on 30 June 2026', 'Letter before action', '63 days late']) {
    assert.ok(page.includes(s), `landing page should show ${s}`);
  }
  // Pre-launch, so no unearned "Most popular" claim on the featured plan.
  assert.doesNotMatch(page, /Most popular/);
  assert.match(page, /Recommended/);
  assert.match(home.text, /href="\/assets\/marketing\.css\?v=/);
  assert.match(home.text, /rel="preload" href="\/assets\/fonts\/inter-var\.woff2/);
});

test('fonts, the marketing stylesheet and the favicon are served', async () => {
  const c = t.client();
  const font = await c.get('/assets/fonts/inter-var.woff2?v=2');
  assert.equal(font.status, 200);
  assert.equal(font.headers.get('content-type'), 'font/woff2');
  const serif = await c.get('/assets/fonts/source-serif-4-var.woff2?v=2');
  assert.equal(serif.status, 200);
  const css = await c.get(`/assets/marketing.css?v=${ASSET_VERSION}`);
  assert.equal(css.status, 200);
  assert.match(css.headers.get('content-type'), /^text\/css/);
  const icon = await c.get('/static/favicon.svg');
  assert.equal(icon.status, 200);
  assert.match(icon.headers.get('content-type'), /^image\/svg\+xml/);
});

test('workspace search finds invoices by customer name and escapes the query', async () => {
  const r = await owner.get('/app/search?q=northgate');
  assert.equal(r.status, 200);
  const page = text(r);
  assert.match(page, /Customers 1/);
  assert.match(page, /INV-1003/, 'invoices match on their customer name, not just their own fields');
  const xss = await owner.get('/app/search?q=%3Cscript%3Ealert(1)%3C%2Fscript%3E');
  assert.equal(xss.status, 200);
  assert.doesNotMatch(xss.text, /<script>alert\(1\)<\/script>/);
  assert.match(text(xss), /Nothing matches/);
  const anon = await t.client().get('/app/search?q=northgate');
  assert.notEqual(anon.status, 200, 'search needs a signed-in user');
});

test('the app shell has workspace search and a new-invoice shortcut', async () => {
  const dash = await owner.get('/app');
  assert.equal(dash.status, 200);
  assert.match(dash.text, /<form class="topbar-search" method="get" action="\/app\/search"/);
  assert.match(dash.text, /class="btn btn-primary btn-sm topbar-new" href="\/app\/invoices\/new"/);
});

test('signing up while signed in goes back to the app instead of creating and switching to a second account', async () => {
  const users = () => t.db.get('SELECT COUNT(*) AS n FROM users').n;
  const before = users();
  await owner.get('/app');
  const r = await owner.post('/signup', { name: 'Someone Else', email: 'else@example.com', orgName: 'Else Ltd', password: 'another-pass-99' });
  assert.equal(r.status, 303);
  assert.equal(r.location, '/app');
  assert.equal(users(), before);
  assert.match(text(await owner.get('/app/account')), /ada@example\.com/);
});

test('successful logins do not count towards the account lockout', async () => {
  const c = t.client();
  for (let i = 0; i < 12; i++) {
    await c.get('/login');
    const r = await c.post('/login', { email: OWNER.email, password: OWNER.password });
    assert.equal(r.status, 303, `login ${i + 1} should succeed`);
    await c.post('/logout');
  }
});

test('chase ladder stages saved out of order are rejected rather than silently reordered', async () => {
  await owner.get('/app/settings');
  const form = { org_name: 'Brooks Studio Ltd', default_terms: '30', stop_days: '30', weekly_digest: '1', email_footer: '1', pre_due_days: '3', stage2_from: '8', stage3_from: '8', stage4_from: '31', stage5_from: '46' };
  const bad = await owner.post('/app/settings', form);
  assert.equal(bad.status, 422);
  assert.match(text(bad), /Stage 3 must start later than Stage 2 \(day 8\)/);
  const good = await owner.post('/app/settings', { ...form, stage3_from: '15' });
  assert.equal(good.status, 303);
});

test('the dashboard "You can claim" figure opens the matching list of invoices', async () => {
  const dash = await owner.get('/app');
  assert.match(dash.text, /href="\/app\/invoices\?view=claim"/);
  const list = text(await owner.get('/app/invoices?view=claim'));
  assert.match(list, /INV-1003/, 'the long-overdue sample invoice carries a claim');
  assert.doesNotMatch(list, /INV-1005/, 'an invoice that is not yet due has nothing to claim');
});

test('logging a sent payment-plan agreement puts the invoice on a payment plan', async () => {
  const org = t.db.get('SELECT id FROM orgs ORDER BY id LIMIT 1');
  const inv = t.db.get("SELECT id, status FROM r_invoices WHERE org_id = ? AND number = 'INV-1002'", org.id);
  assert.notEqual(inv.status, 'On payment plan');
  await owner.get(`/app/invoices/${inv.id}`);
  const r = await owner.post(`/app/invoices/${inv.id}/log-letter`, { t: 'plan' });
  assert.equal(r.status, 303);
  assert.equal(t.db.get('SELECT status FROM r_invoices WHERE id = ?', inv.id).status, 'On payment plan');
});

test('uploading an Excel workbook as a CSV explains how to save it as CSV', () => {
  const { csv, resources } = t.services;
  const ctx = { org: t.services.auth.getOrg(t.db.get('SELECT id FROM orgs ORDER BY id LIMIT 1').id), services: t.services, cache: {}, user: null, role: 'owner' };
  assert.throws(() => csv.importCSV(ctx, resources.get('customers'), 'PK\u0003\u0004\u0014\u0000binary'), /Excel workbook/);
});
