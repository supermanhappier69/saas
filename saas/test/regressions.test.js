// Regression tests for bugs found in a bug hunt of the shared core: money parsing and rounding, CSV import and export,
// delete confirmations, deleting a workspace, and invitations that outlive their workspace.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, testDefinition, tokenFromOutbox } from './helpers.js';
import { parseMoney, parseNumber, round2 } from '../core/util.js';
import { createBilling } from '../core/billing.js';
import { clientIp } from '../core/auth.js';

process.env.APP_TODAY = '2026-11-11';

const definition = testDefinition({
  resources: [
    { name: 'companies', label: 'Companies', singular: 'Company', fields: [{ key: 'name', label: 'Name', type: 'text', required: true }] },
    {
      name: 'deals',
      label: 'Deals',
      singular: 'Deal',
      defaultView: 'open',
      views: [{ id: 'open', label: 'Open', filter: (row) => row.stage !== 'Won' }],
      fields: [
        { key: 'title', label: 'Title', type: 'text', required: true },
        { key: 'company', label: 'Company', type: 'ref', ref: 'companies', required: true, onDelete: 'cascade' },
        { key: 'stage', label: 'Stage', type: 'select', options: ['Open', 'Won'], default: 'Open', required: true },
        { key: 'live', label: 'Live', type: 'bool', default: true },
        { key: 'value', label: 'Value', type: 'money' },
      ],
    },
  ],
});

let t;
let owner;
const OWNER = { name: 'Rhea Owner', email: 'rhea@example.com', orgName: 'Rhea Trading Ltd', password: 'river-lantern-42' };
const text = (r) => r.text.replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

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

const orgId = () => t.db.get('SELECT id FROM orgs ORDER BY id LIMIT 1').id;
const addCompany = async (name) => {
  await owner.get('/app/companies/new');
  const r = await owner.post('/app/companies', { name });
  assert.equal(r.status, 303);
  return t.db.get('SELECT id FROM r_companies WHERE org_id = ? AND name = ? ORDER BY id DESC LIMIT 1', orgId(), name).id;
};
const importCsv = async (resource, csv, commit = false) => {
  await owner.get(`/app/${resource}/import`);
  return owner.post(`/app/${resource}/import`, commit ? { csv, commit: '1' } : { csv });
};

test('money and number parsing accepts UK and decimal-comma formats and rejects nonsense grouping', () => {
  assert.equal(parseMoney('£1,250.50'), 1250.5);
  assert.equal(parseMoney('1250'), 1250);
  assert.equal(parseMoney('1,250'), 1250);
  assert.equal(parseMoney('(20)'), -20);
  assert.equal(parseMoney('-£5'), -5);
  // Semicolon CSVs from European Excel use a decimal comma. These used to become 1.25 and 150000.
  assert.equal(parseMoney('1.250,50'), 1250.5);
  assert.equal(parseMoney('1500,00'), 1500);
  assert.equal(parseMoney('12,5'), 12.5);
  // Commas that cannot be separators used to be dropped, so '1,2,3' became 123.
  assert.equal(parseMoney('1,2,3'), undefined);
  assert.equal(parseMoney('12,34,567'), undefined);
  assert.equal(parseMoney('1e3'), undefined);
  assert.equal(parseMoney(''), null);
  assert.equal(parseNumber('4,5%'), 4.5);
  assert.equal(parseNumber('1,250'), 1250);
  assert.equal(parseNumber('-3.75'), -3.75);
  assert.equal(parseNumber('30,5,1'), undefined);
});

test('round2 rounds half pennies up whatever the binary representation', () => {
  assert.equal(round2(1.005), 1.01);
  assert.equal(round2(4.005), 4.01); // 4.005 * 100 is 400.49999999999994
  assert.equal(round2(10.075), 10.08);
  assert.equal(round2(1234.565), 1234.57);
  assert.equal(round2(1.0049999999), 1);
  assert.equal(round2(-4.005), -4.01);
  assert.equal(round2(0), 0);
  assert.equal(round2('abc'), 0);
});

test('a CSV reads a number in a reference column as a name first, and blank cells take the field defaults', async () => {
  const alpha = await addCompany('Alpha Ltd'); // id 1 in a fresh workspace
  const numbered = await addCompany('1'); // a company whose NAME is "1"
  const gamma = await addCompany('Gamma Ltd');
  assert.equal(alpha, 1);
  // "1" is a company's name here. It used to be read as company id 1 (Alpha), so the deal landed on the wrong company.
  const csv = 'Title,Company,Stage,Live,Value\nBy number name,1,,,"£1,000"\nBy name,Alpha Ltd,Won,No,50\nBy id,' + gamma + ',,,\n';
  const preview = await importCsv('deals', csv);
  assert.equal(preview.status, 200, preview.text.slice(0, 500));
  assert.match(text(preview), /Ready to import 3 rows/);
  const done = await importCsv('deals', csv, true);
  assert.equal(done.status, 303, done.text.slice(0, 500));
  const row = (title) => t.db.get('SELECT * FROM r_deals WHERE title = ?', title);
  assert.equal(row('By number name').company, numbered);
  // Blank Stage and Live cells on a new row mean "use the default" (Open, ticked) instead of "required" or "off".
  assert.equal(row('By number name').stage, 'Open');
  assert.equal(row('By number name').live, 1);
  assert.equal(row('By number name').value, 1000);
  assert.equal(row('By name').company, alpha);
  assert.equal(row('By name').stage, 'Won');
  assert.equal(row('By name').live, 0);
  // A number that matches no name still works as an ID.
  assert.equal(row('By id').company, gamma);
});

test('a CSV that names a company twice asks which one instead of picking the first', async () => {
  await addCompany('Twin Ltd');
  await addCompany('Twin Ltd');
  const preview = await importCsv('deals', 'Title,Company\nAmbiguous,Twin Ltd\n');
  assert.equal(preview.status, 200);
  assert.match(text(preview), /More than one company is called “Twin Ltd”/);
  assert.equal(t.db.get("SELECT COUNT(*) AS n FROM r_deals WHERE title = 'Ambiguous'").n, 0);
});

test('exports are complete unless a view is asked for, and the list page asks for the view it is showing', async () => {
  const co = await addCompany('Export Co');
  await owner.post('/app/deals', { title: 'Still open', company: String(co), stage: 'Open' });
  await owner.post('/app/deals', { title: 'Already won', company: String(co), stage: 'Won' });
  // The Settings page links to /app/deals/export.csv with no view. The default "Open" view used to trim it to open deals only.
  const everything = await owner.get('/app/deals/export.csv');
  assert.equal(everything.status, 200);
  assert.match(everything.text, /Still open/);
  assert.match(everything.text, /Already won/);
  const open = await owner.get('/app/deals/export.csv?view=open');
  assert.match(open.text, /Still open/);
  assert.doesNotMatch(open.text, /Already won/);
  // The list shows the default Open view, so its Export button asks for exactly that.
  const list = await owner.get('/app/deals');
  assert.match(list.text, /href="\/app\/deals\/export\.csv\?view=open"/);
  const all = await owner.get('/app/deals?view=all');
  assert.match(all.text, /href="\/app\/deals\/export\.csv"/);
});

test('a list with a default view shows the "none yet" help in an empty workspace, and "See all" on a record shows everything', async () => {
  const fresh = t.client();
  await fresh.get('/signup');
  assert.equal((await fresh.post('/signup', { name: 'Eve Empty', email: 'eve@example.com', orgName: 'Empty Ltd', password: 'river-lantern-42' })).status, 303);
  const none = text(await fresh.get('/app/deals'));
  assert.match(none, /No deals yet/, 'it used to say "No matching records. Try a different search, filter or view."');
  assert.doesNotMatch(none, /No matching records/);
  assert.match((await fresh.get('/app/deals')).text, /href="\/app\/deals\/new"/);
  // Once something exists but the default Open view hides it, "no matching records" is the right message.
  await fresh.get('/app/companies/new');
  await fresh.post('/app/companies', { name: 'Won Co' });
  const co = t.db.get("SELECT id FROM r_companies WHERE name = 'Won Co'").id;
  await fresh.get('/app/deals/new');
  assert.equal((await fresh.post('/app/deals', { title: 'Only a won deal', company: String(co), stage: 'Won' })).status, 303);
  assert.match(text(await fresh.get('/app/deals')), /No matching records/);
  // A company with more than 25 deals lists 25 and links to the rest. That link must not land on the default view.
  for (let i = 1; i <= 26; i++) await fresh.post('/app/deals', { title: `Deal ${i}`, company: String(co), stage: 'Won' });
  const page = await fresh.get(`/app/companies/${co}`);
  const href = /href="([^"]*f_company[^"]*)">See all 27</.exec(page.text)?.[1];
  assert.ok(href, 'the See all link is there');
  assert.match(href.replace(/&amp;/g, '&'), /view=all/);
  const all = await fresh.get(href.replace(/&amp;/g, '&'));
  assert.equal((all.text.match(/class="row-link"/g) || []).length, 27, 'it used to list only the open deals (none) under "See all 27"');
});

test('the delete confirmation says which records go with the one being deleted', async () => {
  const co = await addCompany('Cascade Co');
  await owner.post('/app/deals', { title: 'First', company: String(co) });
  await owner.post('/app/deals', { title: 'Second', company: String(co) });
  const page = await owner.get(`/app/companies/${co}`);
  assert.equal(page.status, 200);
  assert.match(page.text, /This also deletes 2 deals\./);
  const lonely = await addCompany('Lonely Co');
  const lonelyPage = await owner.get(`/app/companies/${lonely}`);
  assert.doesNotMatch(lonelyPage.text, /This also deletes/);
});

test('the trial badge says when the trial ends today', async () => {
  t.db.run('UPDATE orgs SET trial_ends = ? WHERE id = ?', '2026-11-11', orgId());
  const page = await owner.get('/app/billing');
  assert.match(text(page), /Trial ends today/);
  assert.doesNotMatch(text(page), /0 days left/);
  t.db.run('UPDATE orgs SET trial_ends = ? WHERE id = ?', '2026-11-25', orgId());
  assert.match(text(await owner.get('/app/billing')), /Trial: 14 days left/);
});

test('deleting a workspace also deletes its sent emails and live invitations, and a leftover invitation shows as expired', async () => {
  const c = t.client();
  await c.get('/signup');
  const made = await c.post('/signup', { name: 'Dee Deleter', email: 'dee@example.com', orgName: 'Doomed Ltd', password: 'river-lantern-42' });
  assert.equal(made.status, 303);
  const doomed = t.db.get("SELECT id FROM orgs WHERE name = 'Doomed Ltd'").id;
  await c.get('/app/team');
  const invited = await c.post('/app/team/invite', { email: 'newbie@example.com', role: 'member' });
  assert.equal(invited.status, 200, invited.text.slice(0, 300));
  const token = tokenFromOutbox(t.db, 'newbie@example.com', 'invite');
  assert.ok(token);
  assert.ok(t.db.get('SELECT COUNT(*) AS n FROM outbox WHERE org_id = ?', doomed).n > 0, 'welcome and invitation emails were queued');
  assert.equal((await t.client().get(`/invite/${token}`)).status, 200);
  await c.get('/app/settings');
  const gone = await c.post('/app/settings/delete', { confirm: 'Doomed Ltd' });
  assert.equal(gone.status, 303);
  assert.equal(t.db.get('SELECT COUNT(*) AS n FROM orgs WHERE id = ?', doomed).n, 0);
  // These tables have no foreign key to orgs. Their rows used to survive, keeping recipients, subjects and message bodies.
  assert.equal(t.db.get('SELECT COUNT(*) AS n FROM outbox WHERE org_id = ?', doomed).n, 0);
  assert.equal(t.db.get('SELECT COUNT(*) AS n FROM tokens WHERE org_id = ?', doomed).n, 0);
  assert.equal((await t.client().get(`/invite/${token}`)).status, 410);
});

test('test billing is refused in production once Stripe is configured, so a forgotten flag cannot hand out paid plans', () => {
  const plans = [{ id: 'core', name: 'Core', price: 49 }];
  const live = createBilling({ db: {}, config: { STRIPE_SECRET_KEY: 'sk_live_x', ALLOW_FAKE_BILLING: true, NODE_ENV: 'production' }, definition: { plans } });
  assert.throws(() => live.simulate({ id: 1 }, 'core'), (err) => err.status === 403);
  const writes = [];
  const staging = createBilling({ db: { run: (...args) => writes.push(args) }, config: { ALLOW_FAKE_BILLING: true, NODE_ENV: 'production' }, definition: { plans } });
  staging.simulate({ id: 1 }, 'core');
  assert.equal(writes.length, 1, 'a staging site without Stripe can still use test billing');
  const dev = createBilling({ db: { run: (...args) => writes.push(args) }, config: { STRIPE_SECRET_KEY: 'sk_test_x', ALLOW_FAKE_BILLING: true, NODE_ENV: 'development' }, definition: { plans } });
  dev.simulate({ id: 1 }, 'core');
  assert.equal(writes.length, 2);
});

test('demo workspaces are cleaned up after the number of days the demo page promises', async () => {
  const demoApp = await startTestApp({ definition: testDefinition({ demoDays: 5 }) });
  try {
    const visitor = demoApp.client();
    await visitor.get('/demo');
    assert.match((await visitor.get('/demo')).text, /deleted automatically after 5 days/);
    assert.equal((await visitor.post('/demo')).status, 303);
    const demo = demoApp.db.get('SELECT id FROM orgs WHERE is_demo = 1').id;
    const ago = (days) => new Date(Date.now() - days * 86400000).toISOString();
    demoApp.db.run('UPDATE orgs SET created_at = ? WHERE id = ?', ago(3), demo);
    await demoApp.services.jobs.runDaily('2026-11-11');
    assert.ok(demoApp.db.get('SELECT id FROM orgs WHERE id = ?', demo), 'three days old with five promised: it used to be deleted after two');
    demoApp.db.run('UPDATE orgs SET created_at = ? WHERE id = ?', ago(6), demo);
    await demoApp.services.jobs.runDaily('2026-11-12');
    assert.equal(demoApp.db.get('SELECT id FROM orgs WHERE id = ?', demo), undefined);
  } finally {
    await demoApp.stop();
  }
});

test('behind a trusted proxy the client address is the one the proxy saw, so a spoofed X-Forwarded-For cannot dodge rate limits', () => {
  const req = (headers, remote = '10.0.0.1') => ({ headers, socket: { remoteAddress: remote } });
  assert.equal(clientIp(req({ 'x-forwarded-for': '6.6.6.6' }), { TRUST_PROXY: false }), '10.0.0.1', 'ignored unless the proxy is trusted');
  // The client sent "6.6.6.6"; the proxy appended the real address.
  assert.equal(clientIp(req({ 'x-forwarded-for': '6.6.6.6, 203.0.113.5' }), { TRUST_PROXY: true }), '203.0.113.5');
  assert.equal(clientIp(req({ 'x-forwarded-for': '203.0.113.9' }), { TRUST_PROXY: true }), '203.0.113.9');
  assert.equal(clientIp(req({ 'fly-client-ip': '198.51.100.7', 'x-forwarded-for': '6.6.6.6' }), { TRUST_PROXY: true }), '198.51.100.7');
  assert.equal(clientIp(req({}), { TRUST_PROXY: true }), '10.0.0.1', 'no header: fall back to the socket');
});

test('starting in production warns about a missing MAIL_FROM and about test billing', async () => {
  const warnings = [];
  const prod = await startTestApp({
    env: { NODE_ENV: 'production', APP_SECRET: 'a-long-random-secret-for-this-test-only', BASE_URL: 'https://app.example.com', RESEND_API_KEY: 're_test', ALLOW_FAKE_BILLING: '1' },
    options: { log: { info() {}, error() {}, warn: (m) => warnings.push(m) } },
  });
  await prod.stop();
  assert.ok(warnings.some((m) => /MAIL_FROM is not set/.test(m)), warnings.join('|'));
  assert.ok(warnings.some((m) => /ALLOW_FAKE_BILLING is on in production/.test(m)));
});

test('an invitation whose workspace no longer exists shows as expired instead of crashing on accept', async () => {
  const c = t.client();
  await c.get('/signup');
  await c.post('/signup', { name: 'Orla Orphan', email: 'orla@example.com', orgName: 'Orphaned Ltd', password: 'river-lantern-42' });
  const orphaned = t.db.get("SELECT id FROM orgs WHERE name = 'Orphaned Ltd'").id;
  await c.get('/app/team');
  await c.post('/app/team/invite', { email: 'late@example.com', role: 'member' });
  const token = tokenFromOutbox(t.db, 'late@example.com', 'invite');
  // Simulate a token left behind by an older delete: remove only the workspace row.
  t.db.run('DELETE FROM orgs WHERE id = ?', orphaned);
  const guest = t.client();
  await guest.get('/login'); // picks up the anonymous form token, as a page opened before the workspace was deleted would have
  assert.equal((await guest.get(`/invite/${token}`)).status, 410);
  const accept = await guest.post(`/invite/${token}`, { name: 'Late Guest', password: 'river-lantern-42' });
  assert.equal(accept.status, 410, 'it used to fail with a foreign key error (500)');
  assert.equal(t.db.get("SELECT COUNT(*) AS n FROM users WHERE email = 'late@example.com'").n, 0);
});
