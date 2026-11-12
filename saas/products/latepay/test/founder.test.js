// Founder console, free pages, onboarding and the "work through the list" mode.
process.env.APP_TODAY = '2026-11-11';

const { test, before, after } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const { startTestApp } = await import('../../../test/helpers.js');
const { definition } = await import('../definition.js');
const { modelFor, metrics } = await import('../pages/founder.js');

let t;
let founder;
let other;
let org;
const text = (r) => r.text.replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

async function signUp(details) {
  const c = t.client();
  await c.get('/signup');
  const r = await c.post('/signup', details);
  assert.equal(r.status, 303, r.text.slice(0, 300));
  return c;
}

before(async () => {
  t = await startTestApp({ definition, env: { FOUNDER_EMAILS: 'Founder@Example.com' } });
  founder = await signUp({ name: 'Bobby Founder', email: 'founder@example.com', orgName: 'PaidOnTime Ltd', password: 'copper-kettle-77' });
  other = await signUp({ name: 'Someone Else', email: 'else@example.com', orgName: 'Else Ltd', password: 'copper-kettle-78' });
  org = t.db.get("SELECT o.* FROM orgs o JOIN memberships m ON m.org_id = o.id JOIN users u ON u.id = m.user_id WHERE u.email = 'founder@example.com'");
});
after(async () => {
  await t?.stop();
});

test('only the founder can open the console and sees the nav link', async () => {
  const home = await founder.get('/app');
  assert.match(text(home), /Founder console/);
  assert.doesNotMatch(text(await other.get('/app')), /Founder console/);
  for (const p of ['/app/founder', '/app/founder/checklist', '/app/founder/plan', '/app/founder/marketing', '/app/founder/model', '/app/founder/leads', '/app/founder/leads.csv']) {
    assert.equal((await founder.get(p)).status, 200, p);
    assert.equal((await other.get(p)).status, 403, p);
  }
  const plan = text(await founder.get('/app/founder/plan'));
  assert.match(plan, /What it takes to reach £1 million/);
  assert.match(plan, /Commercial Payments Bill/);
  assert.match(text(await founder.get('/app/founder/marketing')), /Accountants and bookkeepers/);
});

test('the numbers page counts real workspaces, trials, waitlist answers and calculator uses', async () => {
  const v = t.client();
  await v.get('/waitlist');
  await v.post('/waitlist', { name: 'Sam', email: 'sam@example.com', price: '£49 one-off (Core)', today: 'Spreadsheet and email' });
  await v.get('/calculator?amount=1000&due=2026-01-01');
  await v.get('/calculator'); // just the form: not a use
  await v.get('/demo');
  await v.post('/demo');
  const m = metrics({ services: t.services, org: t.services.auth.getOrg(org.id) });
  assert.equal(m.signups, 2);
  assert.equal(m.demos, 1);
  assert.equal(m.trialing, 2);
  assert.equal(m.paid, 0);
  assert.equal(m.waitlist, 1);
  assert.equal(m.prices['£49 one-off (Core)'], 1);
  assert.equal(m.calculatorUses, 1);
  assert.equal(m.activated, 0);
  const page = text(await founder.get('/app/founder'));
  assert.match(page, /Sign-ups 2/);
  assert.match(page, /Spreadsheet and email/);
  await founder.get('/app/billing');
  await founder.post('/app/billing/simulate', { plan: 'complete' });
  const m2 = metrics({ services: t.services, org: t.services.auth.getOrg(org.id) });
  assert.equal(m2.paid, 1);
  assert.equal(m2.revenue, 99);
  assert.equal(m2.conversion, 100);
  const csv = await founder.get('/app/founder/leads.csv');
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.match(csv.text, /sam@example\.com/);
});

test('the launch checklist ticks persist', async () => {
  await founder.get('/app/founder/checklist');
  const r = await founder.post('/app/founder/checklist', { item: 'solicitor' });
  assert.equal(r.status, 303);
  assert.match(text(await founder.get('/app/founder/checklist')), /1 of \d+/);
  await founder.post('/app/founder/checklist', { item: 'solicitor' });
  assert.match(text(await founder.get('/app/founder/checklist')), /0 of \d+/);
  assert.equal((await founder.post('/app/founder/checklist', { item: 'nope' })).status, 400);
});

test('the path-to-£1m model is arithmetic that reacts to its inputs', () => {
  const base = modelFor({});
  assert.equal(base.rows.length, 36);
  assert.ok(base.total > 0);
  const oneOffOnly = modelFor({ autopilotRate: 0, retainers: 0, growth: 0, visitors: 2000, trialRate: 3, paidRate: 15, completeShare: 40, months: 12 });
  // 2000 × 3% × 15% = 9 sales × £69 blended = £621 a month.
  assert.equal(oneOffOnly.rows[0].sales, 9);
  assert.equal(oneOffOnly.rows[0].revenue, 621);
  assert.equal(oneOffOnly.total, 7452);
  assert.equal(oneOffOnly.hit, null);
  const big = modelFor({ visitors: 50000, growth: 5, autopilotRate: 30, retainers: 2, months: 36 });
  assert.ok(big.hit !== null && big.hit <= 36);
  const page = await_ok(founder.get('/app/founder/model?visitors=50000&growth=5'));
  return page;
});
const await_ok = async (p) => assert.equal((await p).status, 200);

test('free template pages render the templates and the offer', async () => {
  const c = t.client();
  const reminders = await c.get('/free/payment-reminder-templates');
  assert.equal(reminders.status, 200);
  assert.match(text(reminders), /Template 1: Friendly reminder/);
  assert.match(text(reminders), /Phone script/);
  assert.match(text(reminders), /Try the demo/);
  const lba = text(await c.get('/free/letter-before-action'));
  assert.match(lba, /Letter before action/);
  assert.match(lba, /Pre-Action Protocol/);
  assert.match(text(await c.get('/free/payment-terms')), /Part B · Customer-facing payment terms/);
  assert.equal((await c.get('/free/nope')).status, 404);
  assert.match(text(await c.get('/calculator')), /Commercial Payments Bill/);
  assert.match(text(await c.get('/')), /£26bn/);
});

test('the onboarding checklist tracks setup and disappears when done', async () => {
  const dash = text(await other.get('/app'));
  assert.match(dash, /Set up in 15 minutes/);
  assert.match(dash, /0 of 6 done/);
  await other.get('/app/chase/calendar');
  await other.get('/app/settings');
  await other.post('/app/settings', { org_name: 'Else Ltd', company_name: 'Else Ltd', bank_details: '12-34-56 12345678', default_terms: '30', stop_days: '30', weekly_digest: '1', email_footer: '1', pre_due_days: '3', stage2_from: '8', stage3_from: '15', stage4_from: '31', stage5_from: '46' });
  assert.match(text(await other.get('/app')), /2 of 6 done/);
});

test('working through the list sends reminders one by one and skips', async () => {
  const start = await founder.get('/app/chase/next');
  assert.equal(start.status, 303);
  assert.match(start.location, /\/app\/invoices\/\d+\/compose\?t=\d&queue=\d+/);
  const page = await founder.get(start.location);
  assert.match(text(page), /Working through the list/);
  assert.match(text(page), /Send, log it and open the next/);
  const id = Number(start.location.match(/invoices\/(\d+)/)[1]);
  const sent = await founder.post(`/app/invoices/${id}/compose`, { t: '3', queue: '3', to: 'a@example.com', subject: 's', body: 'b', send: '1' });
  assert.equal(sent.status, 303);
  assert.equal(sent.location, '/app/chase/next');
  const next = await founder.get('/app/chase/next');
  assert.equal(next.status, 303);
  assert.notEqual(Number(next.location.match(/invoices\/(\d+)/)[1]), id, 'the sent invoice is no longer due');
  const skipId = Number(next.location.match(/invoices\/(\d+)/)[1]);
  const skip = await founder.post(`/app/chase/skip/${skipId}`);
  assert.equal(skip.location, '/app/chase/next');
  assert.equal(t.db.get('SELECT next_follow_up FROM r_chases WHERE org_id = ? AND invoice = ? ORDER BY id DESC LIMIT 1', org.id, skipId).next_follow_up, '2026-11-12');
  // Drain the queue: eventually it reports all caught up.
  for (let i = 0; i < 10; i++) {
    const r = await founder.get('/app/chase/next');
    if (r.location === '/app/chase') break;
    const inv = Number(r.location.match(/invoices\/(\d+)/)[1]);
    await founder.post(`/app/chase/skip/${inv}`);
  }
  assert.equal((await founder.get('/app/chase/next')).location, '/app/chase');
});

test('reminder emails carry the footer on Core and not on Complete', async () => {
  // "other" is on trial (Complete features) so no footer; drop it to Core.
  await other.get('/app/billing');
  await other.post('/app/billing/simulate', { plan: 'core' });
  const otherOrg = t.db.get("SELECT o.* FROM orgs o JOIN memberships m ON m.org_id = o.id JOIN users u ON u.id = m.user_id WHERE u.email = 'else@example.com'");
  const inv = t.db.get("SELECT id FROM r_invoices WHERE org_id = ? AND number = 'INV-1002'", otherOrg.id).id;
  await other.get(`/app/invoices/${inv}/compose?t=1`);
  await other.post(`/app/invoices/${inv}/compose`, { t: '1', to: 'a@example.com', subject: 's', body: 'Please pay.', send: '1' });
  let mail = t.db.get('SELECT body_text FROM outbox WHERE org_id = ? ORDER BY id DESC LIMIT 1', otherOrg.id);
  assert.match(mail.body_text, /Sent with PaidOnTime/);
  await other.post('/app/billing/simulate', { plan: 'complete' });
  await other.post(`/app/invoices/${inv}/compose`, { t: '1', to: 'a@example.com', subject: 's', body: 'Please pay again.', send: '1' });
  mail = t.db.get('SELECT body_text FROM outbox WHERE org_id = ? ORDER BY id DESC LIMIT 1', otherOrg.id);
  assert.doesNotMatch(mail.body_text, /Sent with PaidOnTime/);
});
