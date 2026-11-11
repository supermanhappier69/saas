// End-to-end tests of the shared core over real HTTP: public pages, sign up, log in, CSRF, records, CSV import, the API, team invites,
// settings, billing and limits, read-only access, demo email blocking, the contact form and password reset.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, tokenFromOutbox } from './helpers.js';

let t;
let owner;
const OWNER = { name: 'Alice Owner', email: 'alice@example.com', orgName: 'Alice Trading Ltd', password: 'river-lantern-42' };

before(async () => {
  t = await startTestApp();
});
after(async () => {
  await t?.stop();
});

async function signUp(details = OWNER) {
  const c = t.client();
  await c.get('/signup');
  const r = await c.post('/signup', details);
  assert.equal(r.status, 303, r.text.slice(0, 400));
  assert.equal(r.location, '/app');
  return c;
}

const orgOf = (email) => t.db.get(
  'SELECT o.* FROM orgs o JOIN memberships m ON m.org_id = o.id JOIN users u ON u.id = m.user_id WHERE u.email = ? ORDER BY o.id LIMIT 1',
  email,
);

test('public pages render for visitors', async () => {
  const c = t.client();
  const home = await c.get('/');
  assert.equal(home.status, 200);
  assert.match(home.text, /TestApp/);
  assert.match(home.text, /Start free trial/);
  assert.match(home.text, /Most popular/);
  assert.ok(home.headers.get('content-security-policy'));
  for (const p of ['/pricing', '/login', '/signup', '/forgot', '/demo', '/contact', '/terms', '/privacy']) {
    const r = await c.get(p);
    assert.equal(r.status, 200, `${p} returned ${r.status}`);
  }
  assert.match((await c.get('/terms')).text, /Draft for review/);
  assert.match((await c.get('/privacy')).text, /UK data protection law/);
  const health = await c.get('/healthz');
  assert.equal(health.status, 200);
  assert.equal(health.json().ok, true);
  assert.match((await c.get('/robots.txt')).text, /Disallow: \/\n/);
  assert.equal((await c.get('/no-such-page')).status, 404);
});

test('the app sends visitors to log in and the API asks for a key', async () => {
  const c = t.client();
  const r = await c.get('/app/contacts?view=all');
  assert.equal(r.status, 303);
  assert.equal(r.location, '/login?next=%2Fapp%2Fcontacts%3Fview%3Dall');
  const api = await c.api('GET', '/api/v1/contacts');
  assert.equal(api.status, 401);
  assert.match(api.json().error, /API key/);
});

test('sign up validates, starts a trial, signs in and logs the welcome email', async () => {
  const v = t.client();
  await v.get('/signup');
  const invalid = await v.post('/signup', { name: '', email: 'not-an-email', orgName: '', password: 'short' });
  assert.equal(invalid.status, 422);
  owner = await signUp();
  const dash = await owner.get('/app');
  assert.equal(dash.status, 200);
  assert.match(dash.text, /Your 14-day free trial has started/);
  assert.match(dash.text, /Alice Trading Ltd/);
  const again = await owner.get('/app');
  assert.doesNotMatch(again.text, /free trial has started/);
  assert.equal(orgOf(OWNER.email).plan_status, 'trialing');
  const welcome = t.db.get("SELECT * FROM outbox WHERE related = 'welcome' AND to_addr = ?", OWNER.email);
  assert.ok(welcome, 'welcome email recorded');
  assert.equal(welcome.status, 'logged');
  const dup = t.client();
  await dup.get('/signup');
  const r = await dup.post('/signup', OWNER);
  assert.equal(r.status, 409);
  assert.match(r.text, /already exists/);
});

test('log in checks the password and only follows safe next links', async () => {
  const c = t.client();
  await c.get('/login?next=/app/contacts');
  const bad = await c.post('/login', { email: OWNER.email, password: 'wrong-password-1' });
  assert.equal(bad.status, 401);
  assert.match(bad.text, /match an account/);
  const good = await c.post('/login', { email: OWNER.email, password: OWNER.password, next: '/app/contacts' });
  assert.equal(good.status, 303);
  assert.equal(good.location, '/app/contacts');
  const evil = t.client();
  await evil.get('/login');
  const r = await evil.post('/login', { email: OWNER.email, password: OWNER.password, next: '//evil.example/app' });
  assert.equal(r.location, '/app');
  assert.equal((await c.get('/app/contacts')).status, 200);
  const out = await c.post('/logout', {});
  assert.equal(out.status, 303);
  assert.equal(out.location, '/');
  assert.equal((await c.get('/app')).status, 303);
});

test('forms are protected against forged and cross-site requests', async () => {
  await owner.get('/app/contacts/new');
  const forged = await owner.post('/app/contacts', { _csrf: 'forged', name: 'Mallory' });
  assert.equal(forged.status, 403);
  const back = await owner.post('/app/contacts', { _csrf: 'forged', name: 'Mallory' }, { headers: { referer: `${t.base}/app/contacts/new` } });
  assert.equal(back.status, 303);
  assert.equal(back.location, '/app/contacts/new');
  const crossSite = await owner.post('/app/contacts', { name: 'Mallory' }, { headers: { origin: 'https://evil.example' } });
  assert.equal(crossSite.status, 403);
  assert.equal(t.db.get("SELECT COUNT(*) AS n FROM r_contacts WHERE name = 'Mallory'").n, 0);
});

test('records can be added, viewed, edited, exported and deleted', async () => {
  await owner.get('/app/contacts/new');
  const created = await owner.post('/app/contacts', { name: 'Bob Buyer', email: 'bob@example.com', stage: 'Lead', value: '1,250.50' });
  assert.equal(created.status, 303, created.text.slice(0, 400));
  const id = t.db.get("SELECT id FROM r_contacts WHERE name = 'Bob Buyer'").id;
  assert.equal(t.db.get('SELECT value FROM r_contacts WHERE id = ?', id).value, 1250.5);
  const detail = await owner.get(created.location);
  assert.equal(detail.status, 200);
  assert.match(detail.text, /Bob Buyer/);
  assert.match(detail.text, /Contact added/);
  await owner.get('/app/contacts/new');
  const invalid = await owner.post('/app/contacts', { name: '', email: 'not-an-email' });
  assert.equal(invalid.status, 422);
  await owner.get(`/app/contacts/${id}/edit`);
  const edited = await owner.post(`/app/contacts/${id}`, { name: 'Bob Buyer', email: 'bob@example.com', stage: 'Customer', value: '1250.50' });
  assert.equal(edited.status, 303, edited.text.slice(0, 400));
  assert.equal(t.db.get('SELECT stage FROM r_contacts WHERE id = ?', id).stage, 'Customer');
  const csv = await owner.get('/app/contacts/export.csv');
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.match(csv.text, /Bob Buyer/);
  assert.match((await owner.get('/app/contacts')).text, /Bob Buyer/);
  await owner.get('/app/contacts/new');
  await owner.post('/app/contacts', { name: 'Temp Person' });
  const tempId = t.db.get("SELECT id FROM r_contacts WHERE name = 'Temp Person'").id;
  await owner.get(`/app/contacts/${tempId}`);
  const del = await owner.post(`/app/contacts/${tempId}/delete`, {});
  assert.equal(del.status, 303, del.text.slice(0, 400));
  assert.equal(t.db.get('SELECT COUNT(*) AS n FROM r_contacts WHERE id = ?', tempId).n, 0);
  assert.ok(t.db.get('SELECT COUNT(*) AS n FROM audit WHERE org_id = ?', orgOf(OWNER.email).id).n > 0, 'changes are written to the activity log');
});

test('CSV import shows a preview first and only saves on commit', async () => {
  await owner.get('/app/contacts/import');
  const csvText = 'Name,Email,Stage\nCara Client,cara@example.com,Customer\nDan Dealer,dan@example.com,Lead\n';
  const preview = await owner.post('/app/contacts/import', { csv: csvText });
  assert.equal(preview.status, 200, preview.text.slice(0, 400));
  assert.equal(t.db.get("SELECT COUNT(*) AS n FROM r_contacts WHERE name IN ('Cara Client', 'Dan Dealer')").n, 0);
  const commit = await owner.post('/app/contacts/import', { csv: csvText, commit: '1' });
  assert.equal(commit.status, 303, commit.text.slice(0, 400));
  assert.equal(commit.location, '/app/contacts');
  assert.equal(t.db.get("SELECT COUNT(*) AS n FROM r_contacts WHERE name IN ('Cara Client', 'Dan Dealer')").n, 2);
  assert.match((await owner.get('/app/contacts')).text, /Import finished: 2 added/);
});

test('the API works with a workspace key and stops when the key is revoked', async () => {
  await owner.get('/app/settings');
  const made = await owner.post('/app/settings/api-keys', { name: 'Zapier' });
  assert.equal(made.status, 200, made.text.slice(0, 400));
  const key = made.text.match(/testapp_[A-Za-z0-9_-]{20,}/)?.[0];
  assert.ok(key, 'the new key is shown once');
  const c = t.client();
  const index = await c.api('GET', '/api/v1', key);
  assert.equal(index.status, 200, index.text);
  assert.equal(index.json().workspace.name, OWNER.orgName);
  const list = await c.api('GET', '/api/v1/contacts', key);
  assert.equal(list.status, 200, list.text);
  assert.ok(list.json().data.some((r) => r.name === 'Bob Buyer'));
  const created = await c.api('POST', '/api/v1/contacts', key, { name: 'Erin Api', email: 'erin@example.com' });
  assert.equal(created.status, 201, created.text);
  const id = created.json().data.id;
  const patched = await c.api('PATCH', `/api/v1/contacts/${id}`, key, { stage: 'Customer' });
  assert.equal(patched.status, 200, patched.text);
  assert.equal(patched.json().data.stage, 'Customer');
  const bad = await c.api('POST', '/api/v1/contacts', key, { email: 'no-name@example.com' });
  assert.equal(bad.status, 422, bad.text);
  assert.ok(bad.json().fieldErrors?.name, bad.text);
  const removed = await c.api('DELETE', `/api/v1/contacts/${id}`, key);
  assert.ok(removed.status < 300, removed.text);
  const keyId = t.db.get("SELECT id FROM api_keys WHERE name = 'Zapier'").id;
  const revoke = await owner.post(`/app/settings/api-keys/${keyId}/revoke`, {});
  assert.equal(revoke.status, 303, revoke.text.slice(0, 400));
  assert.equal((await c.api('GET', '/api/v1/contacts', key)).status, 401);
});

test('owners can invite people and roles limit what members can do', async () => {
  await owner.get('/app/team');
  const sent = await owner.post('/app/team/invite', { email: 'bea@example.com', role: 'member' });
  assert.equal(sent.status, 200, sent.text.slice(0, 400));
  assert.match(sent.text, /invite-link/);
  const token = tokenFromOutbox(t.db, 'bea@example.com', 'invite');
  assert.ok(token, 'the invitation link is in the email');
  const bea = t.client();
  const page = await bea.get(`/invite/${token}`);
  assert.equal(page.status, 200);
  assert.match(page.text, /Alice Owner invited you to join Alice Trading Ltd/);
  const joined = await bea.post(`/invite/${token}`, { name: 'Bea Member', password: 'meadow-violin-77' });
  assert.equal(joined.status, 303, joined.text.slice(0, 400));
  assert.equal((await bea.get('/app/team')).status, 200);
  const denied = await bea.post('/app/team/invite', { email: 'carl@example.com', role: 'member' });
  assert.equal(denied.status, 403);
  assert.equal((await bea.get(`/invite/${token}`)).status, 410);
  const beaId = t.db.get("SELECT id FROM users WHERE email = 'bea@example.com'").id;
  await owner.get('/app/team');
  const promoted = await owner.post(`/app/team/${beaId}/role`, { role: 'admin' });
  assert.equal(promoted.status, 303, promoted.text.slice(0, 400));
  assert.equal(t.db.get('SELECT role FROM memberships WHERE user_id = ?', beaId).role, 'admin');
});

test('workspace settings save and the JSON export includes the records', async () => {
  await owner.get('/app/settings');
  const saved = await owner.post('/app/settings', { org_name: 'Alice Trading Group' });
  assert.equal(saved.status, 303, saved.text.slice(0, 400));
  assert.equal(orgOf(OWNER.email).name, 'Alice Trading Group');
  const exp = await owner.get('/app/settings/export.json');
  assert.equal(exp.status, 200);
  const data = exp.json();
  assert.equal(data.workspace.name, 'Alice Trading Group');
  assert.ok(data.resources.contacts.length >= 3);
  const empty = await owner.post('/app/settings', { org_name: '' });
  assert.equal(empty.status, 422);
});

test('test billing switches plans and plan limits apply', async () => {
  await owner.get('/app/billing');
  const sim = await owner.post('/app/billing/simulate', { plan: 'starter' });
  assert.equal(sim.status, 303, sim.text.slice(0, 400));
  const org = orgOf(OWNER.email);
  assert.equal(org.plan, 'starter');
  assert.equal(org.plan_status, 'active');
  assert.match((await owner.get('/app/billing')).text, /Starter plan activated in test mode/);
  const count = t.db.get('SELECT COUNT(*) AS n FROM r_contacts WHERE org_id = ? AND is_sample = 0', org.id).n;
  for (let i = count; i < 5; i++) {
    await owner.get('/app/contacts/new');
    const ok = await owner.post('/app/contacts', { name: `Filler ${i}` });
    assert.equal(ok.status, 303, `contact ${i + 1}: ${ok.text.slice(0, 200)}`);
  }
  await owner.get('/app/contacts/new');
  const blocked = await owner.post('/app/contacts', { name: 'One Too Many' });
  assert.equal(blocked.status, 402);
  assert.match(blocked.text, /Upgrade in Billing/);
});

test('a workspace turns read only when the trial ends but billing still works', async () => {
  const org = orgOf(OWNER.email);
  t.db.run("UPDATE orgs SET plan_status = 'trialing', trial_ends = '2020-01-31' WHERE id = ?", org.id);
  const dash = await owner.get('/app');
  assert.equal(dash.status, 200);
  assert.match(dash.text, /read-only/);
  await owner.get('/app/contacts/new');
  const blocked = await owner.post('/app/contacts', { name: 'Blocked Person' });
  assert.equal(blocked.status, 402);
  assert.equal((await owner.get('/app/contacts/export.csv')).status, 200);
  await owner.get('/app/billing');
  const sim = await owner.post('/app/billing/simulate', { plan: 'pro' });
  assert.equal(sim.status, 303, sim.text.slice(0, 400));
  assert.equal(orgOf(OWNER.email).plan_status, 'active');
});

test('the demo workspace never sends email and blocks risky actions', async () => {
  const c = t.client();
  await c.get('/demo');
  const r = await c.post('/demo', {});
  assert.equal(r.status, 303, r.text.slice(0, 400));
  assert.match((await c.get('/app')).text, /demo workspace/i);
  const demo = t.db.get('SELECT * FROM orgs WHERE is_demo = 1 ORDER BY id DESC LIMIT 1');
  assert.ok(demo);
  const sent = await t.services.mailer.send({ orgId: demo.id, to: 'someone@example.com', subject: 'Hello', text: 'Hi' });
  assert.equal(sent.status, 'logged');
  assert.equal(t.db.get('SELECT provider FROM outbox WHERE id = ?', sent.id).provider, 'demo');
  await c.get('/app/settings');
  assert.equal((await c.post('/app/settings/api-keys', { name: 'Nope' })).status, 403);
  await c.get('/app/team');
  assert.equal((await c.post('/app/team/invite', { email: 'x@example.com', role: 'member' })).status, 403);
});

test('the contact form saves enquiries and ignores bots', async () => {
  const c = t.client();
  await c.get('/contact');
  const ok = await c.post('/contact', { name: 'Pat Prospect', email: 'pat@example.com', company: 'Pat Co', message: 'Do you offer a team plan?' });
  assert.equal(ok.status, 200, ok.text.slice(0, 400));
  assert.match(ok.text, /Thanks, your message is on its way/);
  assert.equal(t.db.get("SELECT COUNT(*) AS n FROM leads WHERE email = 'pat@example.com'").n, 1);
  const bot = await c.post('/contact', { name: 'Bot', email: 'bot@example.com', message: 'spam', website: 'spam.example' });
  assert.equal(bot.status, 200);
  assert.equal(t.db.get("SELECT COUNT(*) AS n FROM leads WHERE email = 'bot@example.com'").n, 0);
  assert.equal((await c.post('/contact', { name: '', email: 'x', message: '' })).status, 422);
});

test('password reset works once and does not reveal whether an account exists', async () => {
  const c = t.client();
  await c.get('/forgot');
  const unknown = await c.post('/forgot', { email: 'nobody@example.com' });
  assert.equal(unknown.status, 200);
  assert.match(unknown.text, /an account for/);
  assert.equal(t.db.get("SELECT COUNT(*) AS n FROM outbox WHERE to_addr = 'nobody@example.com'").n, 0);
  const known = await c.post('/forgot', { email: OWNER.email });
  assert.equal(known.status, 200);
  assert.match(known.text, /an account for/);
  const token = tokenFromOutbox(t.db, OWNER.email, 'reset');
  assert.ok(token, 'the reset link is in the email');
  assert.equal((await c.get(`/reset/${token}`)).status, 200);
  const mismatch = await c.post(`/reset/${token}`, { password: 'harbour-pebble-93', confirm: 'something-else-1' });
  assert.equal(mismatch.status, 422);
  const done = await c.post(`/reset/${token}`, { password: 'harbour-pebble-93', confirm: 'harbour-pebble-93' });
  assert.equal(done.status, 303, done.text.slice(0, 400));
  assert.equal(done.location, '/app');
  assert.equal((await c.get(`/reset/${token}`)).status, 410);
  const login = t.client();
  await login.get('/login');
  assert.equal((await login.post('/login', { email: OWNER.email, password: OWNER.password })).status, 401);
  assert.equal((await login.post('/login', { email: OWNER.email, password: 'harbour-pebble-93' })).status, 303);
});
