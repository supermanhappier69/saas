// Trial lifecycle emails: what each one says, when it goes, and that it goes once, only to trialling workspaces.
process.env.APP_TODAY = '2026-11-11';

const { test, before, after } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const { startTestApp } = await import('../../../test/helpers.js');
const { definition } = await import('../definition.js');
const { trialStage } = await import('../lifecycle.js');

let t;
let orgId;
const OWNER = { name: 'Sam Okafor', email: 'sam@example.com', orgName: 'Okafor Electrical Ltd', password: 'amber-lantern-31' };
const org = () => t.services.auth.getOrg(orgId);
const daily = (date) => definition.jobs.daily(t.services, org(), date);
const trialMail = () => t.db.all("SELECT * FROM outbox WHERE related = 'trial' AND org_id = ? ORDER BY id", orgId);
const ctx = () => ({ org: org(), services: t.services, cache: {}, user: null, role: 'owner' });

before(async () => {
  t = await startTestApp({ definition });
  const c = t.client();
  await c.get('/signup');
  assert.equal((await c.post('/signup', OWNER)).status, 303);
  orgId = t.db.get('SELECT id FROM orgs ORDER BY id DESC LIMIT 1').id;
});
after(async () => {
  await t?.stop();
});

test('the stage for each day of a 14-day trial', () => {
  const o = { trial_ends: '2026-11-25' };
  const at = (d) => trialStage(o, d, 14);
  assert.equal(at('2026-11-11'), null);
  assert.equal(at('2026-11-12'), null);
  assert.equal(at('2026-11-13'), 'activate');
  assert.equal(at('2026-11-19'), 'activate');
  assert.equal(at('2026-11-20'), 'recap');
  assert.equal(at('2026-11-21'), 'recap');
  assert.equal(at('2026-11-22'), 'ending');
  assert.equal(at('2026-11-25'), 'ending');
  assert.equal(at('2026-11-26'), 'ended');
  assert.equal(at('2026-12-02'), 'ended');
  assert.equal(at('2026-12-03'), null, 'long-lapsed trials are left alone');
});

test('a trial with only sample data gets one getting-started email', async () => {
  assert.equal((await daily('2026-11-11')).trial, undefined);
  assert.equal((await daily('2026-11-13')).trial, 'activate');
  assert.equal((await daily('2026-11-14')).trial, undefined, 'sent once, not every day of the window');
  const mails = trialMail();
  assert.equal(mails.length, 1);
  assert.equal(mails[0].to_addr, OWNER.email);
  assert.match(mails[0].subject, /Add your unpaid invoices/);
  assert.match(mails[0].body_text, /^Hi Sam,/);
  assert.match(mails[0].body_text, /\/app\/invoices\/import/);
  assert.match(mails[0].body_text, /Turn trial emails off in Settings/);
});

test('the recap gives your own figures, and the trial-ending emails name the date and the one-off prices', async () => {
  const { resources } = t.services;
  const customer = resources.create(ctx(), resources.get('customers'), { name: 'Volt Fit-out Ltd', customer_type: 'Limited company / LLP' });
  resources.create(ctx(), resources.get('invoices'), { number: 'OE-101', customer: customer.id ?? customer, invoice_date: '2026-08-01', due_date: '2026-08-31', amount: '1800.00' });
  assert.equal((await daily('2026-11-20')).trial, 'recap');
  const recap = trialMail().at(-1);
  assert.match(recap.subject, /£1,800\.00 outstanding, £\d[\d,]*\.\d\d you can claim/);
  assert.match(recap.body_text, /1 unpaid invoice, £1,800\.00 outstanding/);
  assert.match(recap.body_text, /Core, £49 one-off/);
  assert.match(recap.body_text, /Complete, £99 one-off/);
  assert.equal((await daily('2026-11-22')).trial, 'ending');
  assert.match(trialMail().at(-1).subject, /trial ends on 25 November 2026/);
  assert.match(trialMail().at(-1).body_text, /read-only: nothing is deleted/);
  assert.equal((await daily('2026-11-26')).trial, 'ended');
  assert.match(trialMail().at(-1).subject, /trial has ended/);
  assert.equal(trialMail().length, 4);
});

test('no trial emails for paid, opted-out or demo workspaces', async () => {
  const before = t.db.get("SELECT COUNT(*) AS n FROM outbox WHERE related = 'trial'").n;
  t.db.run("UPDATE orgs SET trial_ends = '2026-11-24' WHERE id = ?", orgId);
  t.db.run("UPDATE orgs SET plan_status = 'active', plan = 'core' WHERE id = ?", orgId);
  assert.equal((await daily('2026-11-22')).trial, undefined);
  t.db.run("UPDATE orgs SET plan_status = 'trialing', settings = json_set(settings, '$.trial_emails', json('false')) WHERE id = ?", orgId);
  assert.equal(org().settings.trial_emails, false);
  assert.equal((await daily('2026-11-27')).trial, undefined);
  const v = t.client();
  await v.get('/demo');
  await v.post('/demo');
  const demo = t.services.auth.getOrg(t.db.get('SELECT id FROM orgs WHERE is_demo = 1 ORDER BY id DESC LIMIT 1').id);
  assert.deepEqual(await definition.jobs.daily(t.services, demo, '2026-11-13'), { skipped: 'off' });
  assert.equal(t.db.get("SELECT COUNT(*) AS n FROM outbox WHERE related = 'trial'").n, before);
});
