// v3 regression tests: the compose note, "skip" in the chase queue, duplicate customer names, the founder console's email check,
// overpayments, and a few smaller fixes found in the last audit.
process.env.APP_TODAY = '2026-11-11';

const { test, before, after } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const { startTestApp, tokenFromOutbox } = await import('../../../test/helpers.js');
const { definition } = await import('../definition.js');
const { invoiceFigures } = await import('../lib/calc.js');
const { ladderFrom, nextAction } = await import('../lib/ladder.js');

let t;
let owner;
let org;
const OWNER = { name: 'Vic Owner', email: 'vic@example.com', orgName: 'Vic Builders Ltd', password: 'copper-kettle-77' };
const text = (r) => r.text.replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

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

const ctxFor = () => ({ org: t.services.auth.getOrg(org.id), services: t.services, cache: {}, user: null, role: 'owner' });
const invoice = (number) => {
  const { resources } = t.services;
  return resources.query(ctxFor(), resources.get('invoices'), { all: true }).rows.find((i) => i.number === number);
};
const customer = (name) => {
  const { resources } = t.services;
  return resources.query(ctxFor(), resources.get('customers'), { all: true }).rows.find((c) => c.name === name);
};
const idOf = (number) => t.db.get('SELECT id FROM r_invoices WHERE org_id = ? AND number = ?', org.id, number).id;
const customerId = (like) => t.db.get('SELECT id FROM r_customers WHERE org_id = ? AND name LIKE ?', org.id, like).id;
const addInvoice = async (number, extra = {}) => {
  await owner.get('/app/invoices/new');
  const r = await owner.post('/app/invoices', {
    number, customer: String(customerId('%Brightside%')), invoice_date: '2026-10-01', due_date: '2026-10-31', amount: '1000', status: 'Open', claim_interest: '1', ...extra,
  });
  assert.equal(r.status, 303, text(r).slice(0, 400));
  return idOf(number);
};
const pay = (invoiceId, amount, date = '2026-11-05', extra = {}) => owner.post('/app/payments', { invoice: String(invoiceId), date, amount: String(amount), method: 'Bank transfer', ...extra });
const addPayment = async (invoiceId, amount, date, extra) => {
  await owner.get(`/app/payments/new?invoice=${invoiceId}`);
  const r = await pay(invoiceId, amount, date, extra);
  assert.equal(r.status, 303, text(r).slice(0, 400));
  return t.db.get('SELECT id FROM r_payments WHERE invoice = ? ORDER BY id DESC LIMIT 1', invoiceId).id;
};
const addCustomer = (name, extra = {}) => owner.post('/app/customers', { name, customer_type: 'Sole trader', terms_days: '30', account_status: 'Active', ...extra });
const apiKey = async () => {
  await owner.get('/app/settings');
  const made = await owner.post('/app/settings/api-keys', { name: 'v3 tests' });
  return made.text.match(/id="new-key">([^<]+)</)[1];
};

/* ------------------------------------------------------------------ the compose note */

test('"Check before sending" shows each bracket once: optional wording in its own sentence, empty merge fields under "Still in brackets"', async () => {
  const note = (html) => /<div class="alert alert-orange"[^>]*><strong>Check before sending\.<\/strong>(.*?)<\/div>/s.exec(html)?.[1] ?? '';
  const wording = '[and to pause further work on your account]';
  const final = note((await owner.get(`/app/invoices/${idOf('INV-1002')}/compose?t=3`)).text);
  assert.ok(final, 'the note is shown');
  assert.equal(final.split(wording).length - 1, 1, `the optional wording appeared ${final.split(wording).length - 1} times in: ${final}`);
  assert.match(final, /is optional wording: keep it or delete it, brackets included/);
  assert.doesNotMatch(final, /Still in brackets/);

  // A template with an empty merge field (no phone number in Settings) and its own optional clause: each is named exactly once.
  await owner.get('/app/templates/new');
  const made = await owner.post('/app/templates', { code: '9', name: 'Chase with a call', channel: 'Email', subject: 'About [Invoice number]', body: 'Hi [Contact name], please ring [Phone] about [Invoice number]. [and mention the deposit if you wish]' });
  assert.equal(made.status, 303, text(made).slice(0, 300));
  const mixed = note((await owner.get(`/app/invoices/${idOf('INV-1002')}/compose?t=9`)).text);
  assert.equal(mixed.split('[Phone]').length - 1, 1);
  assert.equal(mixed.split('[and mention the deposit if you wish]').length - 1, 1);
  assert.match(text({ text: mixed }), /Still in brackets: \[Phone\]\. Fill the missing details/);
  assert.match(text({ text: mixed }), /\[and mention the deposit if you wish\] is optional wording/);

  // A phone script is read aloud: its [date] blank is not something to "check before sending".
  const call = (await owner.get(`/app/invoices/${idOf('INV-1002')}/compose?t=call`)).text;
  assert.doesNotMatch(call, /Check before sending/);
});

/* ------------------------------------------------------------------ skipping is not contact */

test('a skipped reminder is deferred a day but is not a contact anywhere', async () => {
  const L = ladderFrom({});
  const fig = invoiceFigures({ amount: 500, dueDate: '2026-10-25', today: '2026-11-11' });
  const skip = { id: 9, date: '2026-11-11', channel: 'Other', stage: null, outcome: 'Skipped', next_follow_up: '2026-11-12' };
  const broken = { status: 'Open', due_date: '2026-10-25', promised_date: '2026-10-30' };
  assert.equal(nextAction(broken, fig, [], { today: '2026-11-11', L }).kind, 'broken');
  assert.equal(nextAction(broken, fig, [skip], { today: '2026-11-11', L }).kind, 'broken', 'a skip is not a contact made after the promise, so the promise is still broken');
  const stage1 = nextAction({ status: 'Open', due_date: '2026-10-25' }, fig, [{ ...skip, outcome: 'Sent', stage: '1 · Friendly reminder' }], { today: '2026-11-11', L });
  assert.equal(stage1.stage >= 1, true);

  const id = idOf('INV-1002');
  const was = invoice('INV-1002');
  assert.equal(was.last_contact, '2026-10-28', 'the sample email logged 14 days ago');
  assert.equal(was.next.now, true);
  const dashboard = text(await owner.get('/app'));
  assert.match(dashboard, /0 of 6 done/);
  await owner.get('/app/chase');
  const skipped = await owner.post(`/app/chase/skip/${id}`);
  assert.equal(skipped.status, 303);
  assert.equal(skipped.location, '/app/chase/next');
  const row = t.db.get('SELECT * FROM r_chases WHERE org_id = ? AND invoice = ? ORDER BY id DESC LIMIT 1', org.id, id);
  assert.equal(row.outcome, 'Skipped');
  assert.equal(row.next_follow_up, '2026-11-12', 'still deferred to tomorrow');
  const now = invoice('INV-1002');
  assert.equal(now.next.on, '2026-11-12');
  assert.equal(now.next.now, false);
  assert.equal(now.next.stage, was.next.stage, 'the ladder stage is unchanged');
  assert.equal(now.last_contact, '2026-10-28', '"Last contact" used to become today');
  assert.match(text(await owner.get(`/app/invoices/${id}`)), /Last contact 28 Oct 2026/);
  assert.match(text(await owner.get('/app')), /0 of 6 done/, 'a skip is not "your first reminder"');
  assert.match(text(await owner.get('/app/reports')), /No contacts logged yet this month/, 'a skip is not counted under "Chasing this month"');
  assert.match(text(await owner.get('/app/chases')), /skipped/i, 'it is still visible in the chase log');

  // A broken promise stays broken: the skip must not look like a contact made after it.
  const promise = idOf('INV-1001');
  assert.equal(invoice('INV-1001').next.kind, 'broken');
  assert.equal((await owner.post(`/app/chase/skip/${promise}`)).status, 303);
  assert.equal(invoice('INV-1001').next.kind, 'broken');
  assert.equal(invoice('INV-1001').last_contact, '2026-10-13');

  // A paid invoice has nothing to defer.
  const paid = idOf('INV-1006');
  const logged = () => t.db.get('SELECT COUNT(*) AS n FROM r_chases WHERE invoice = ?', paid).n;
  const before = logged();
  assert.equal((await owner.post(`/app/chase/skip/${paid}`)).status, 303);
  assert.equal(logged(), before);
});

/* ------------------------------------------------------------------ duplicate customers */

test('customer names are unique within a workspace, ignoring case, spaces and accents in capitals', async () => {
  await owner.get('/app/customers/new');
  assert.equal((await addCustomer('Acme Dupes Ltd')).status, 303);
  const dup = await addCustomer('  acme   DUPES ltd ');
  assert.equal(dup.status, 422);
  assert.match(text(dup), /You already have a customer called “Acme Dupes Ltd”/);
  assert.match(dup.text, /acme\s+DUPES ltd/, 'what was typed is kept in the form');
  assert.equal(t.db.get("SELECT COUNT(*) AS n FROM r_customers WHERE org_id = ? AND lower(trim(name)) = 'acme dupes ltd'", org.id).n, 1);
  assert.equal((await addCustomer('Müller Bau Ltd')).status, 303);
  assert.equal((await addCustomer('MÜLLER BAU LTD')).status, 422, 'SQL lower() would not see these as the same');

  // Editing: another customer cannot take the name, but a customer can change the case of its own.
  assert.equal((await addCustomer('Beta Dupes Ltd')).status, 303);
  const beta = customer('Beta Dupes Ltd');
  await owner.get(`/app/customers/${beta.id}/edit`);
  const clash = await owner.post(`/app/customers/${beta.id}`, { name: 'ACME DUPES LTD', customer_type: 'Sole trader', terms_days: '30', account_status: 'Active' });
  assert.equal(clash.status, 422);
  assert.equal(customer('Beta Dupes Ltd').id, beta.id, 'unchanged');
  const recase = await owner.post(`/app/customers/${beta.id}`, { name: 'BETA DUPES LTD', customer_type: 'Sole trader', terms_days: '30', account_status: 'Active' });
  assert.equal(recase.status, 303);

  // Names that were already duplicated before this rule do not block other edits, such as putting the account on stop.
  t.db.run("INSERT INTO r_customers (org_id, created_at, updated_at, name, customer_type, account_status) VALUES (?, '2026-01-01', '2026-01-01', 'Legacy Twin Ltd', 'Sole trader', 'Active')", org.id);
  t.db.run("INSERT INTO r_customers (org_id, created_at, updated_at, name, customer_type, account_status) VALUES (?, '2026-01-01', '2026-01-01', 'Legacy Twin Ltd', 'Sole trader', 'Active')", org.id);
  const twin = t.db.get("SELECT id FROM r_customers WHERE org_id = ? AND name = 'Legacy Twin Ltd' ORDER BY id LIMIT 1", org.id).id;
  await owner.get(`/app/customers/${twin}`);
  assert.equal((await owner.post(`/app/customers/${twin}/action/stop`)).status, 303);
  assert.equal(t.db.get('SELECT account_status FROM r_customers WHERE id = ?', twin).account_status, 'On stop');
  const phone = await owner.post(`/app/customers/${twin}`, { name: 'Legacy Twin Ltd', customer_type: 'Sole trader', terms_days: '30', account_status: 'On stop', phone: '0113 496 0000' });
  assert.equal(phone.status, 303, 'only a changed name is checked');
});

test('a CSV import refuses a customer name that is already taken, in the file or in the workspace', async () => {
  await owner.get('/app/customers/import');
  const dupInFile = await owner.post('/app/customers/import', { csv: 'Legal name,Customer type\nGamma Dupes Ltd,Partnership\nGAMMA DUPES LTD,Partnership' });
  assert.equal(dupInFile.status, 200);
  assert.match(text(dupInFile), /Row 3: Legal name: You already have a customer called “Gamma Dupes Ltd”/);
  assert.match(text(dupInFile), /1 of 2 rows have problems/);
  const dupInWorkspace = await owner.post('/app/customers/import', { csv: 'Legal name,Customer type\nacme dupes ltd,Partnership' });
  assert.match(text(dupInWorkspace), /Row 2: Legal name: You already have a customer called “Acme Dupes Ltd”/);
  // A row that names an existing customer by its ID is an update, not a duplicate.
  const acme = customer('Acme Dupes Ltd');
  const update = await owner.post('/app/customers/import', { csv: `ID,Legal name,Phone\n${acme.id},Acme Dupes Ltd,0113 496 0001` });
  assert.match(text(update), /Ready to import 1 rows: 0 new and 1 updated/);
});

test('the API refuses a duplicate customer name too', async () => {
  const key = await apiKey();
  const dup = await owner.api('POST', '/api/v1/customers', key, { name: 'ACME dupes LTD', customer_type: 'Sole trader' });
  assert.equal(dup.status, 422);
  assert.match(dup.json().fieldErrors.name, /already have a customer called/);
  assert.equal((await owner.api('POST', '/api/v1/customers', key, { name: 'Delta Dupes Ltd', customer_type: 'Sole trader' })).status, 201);
});

/* ------------------------------------------------------------------ overpayments */

test('invoice figures keep money received above the invoice as a credit, and the invoice settles when its amount is reached', () => {
  const f = invoiceFigures({ amount: 1000, dueDate: '2026-10-15', today: '2026-11-11', status: 'Paid', payments: [{ date: '2026-11-02', amount: 1000 }, { date: '2026-11-09', amount: 200 }] });
  assert.equal(f.paid, 1200);
  assert.equal(f.balance, 0);
  assert.equal(f.credit, 200);
  assert.equal(f.settledOn, '2026-11-02', 'the first payment settled it; the second is the overpayment');
  assert.equal(f.daysOverdue, 18);
  const interestOnly = invoiceFigures({ amount: 1000, dueDate: '2026-10-15', today: '2026-11-11', status: 'Paid', payments: [{ date: '2026-11-02', amount: 1000 }] });
  assert.equal(f.interest, interestOnly.interest, 'interest stops when the invoice is settled, whatever is paid after');
  const manual = invoiceFigures({ amount: 1000, dueDate: '2026-10-15', today: '2026-11-11', status: 'Paid', payments: [{ date: '2026-11-02', amount: 600 }] });
  assert.equal(manual.paid, 1000, 'a hand-set Paid status still wins over a short payment record');
  assert.equal(manual.credit, 0);
  assert.equal(invoiceFigures({ amount: 1000, dueDate: '2026-10-15', today: '2026-11-11', status: 'Paid', paidDate: '2026-11-02' }).credit, 0);
  const next = nextAction({ status: 'Paid', due_date: '2026-10-15' }, invoiceFigures({ amount: 1000, dueDate: '2026-10-15', today: '2026-10-14', status: 'Paid', payments: [{ date: '2026-10-14', amount: 1200 }] }), [], { today: '2026-11-11', L: ladderFrom({}) });
  assert.equal(next.label, 'Paid, £200.00 overpaid');
});

test('a payment above what is owed needs the overpayment box ticked, then shows as a credit on the invoice, the customer and the statement', async () => {
  const id = await addInvoice('OVER-1', { amount: '1000', invoice_date: '2026-10-01', due_date: '2026-10-31' });
  await addPayment(id, 600, '2026-11-01');
  await owner.get(`/app/payments/new?invoice=${id}`);
  const refused = await pay(id, 500, '2026-11-05');
  assert.equal(refused.status, 422);
  assert.match(text(refused), /Only £400\.00 is still owed on this invoice\. If the customer paid more, turn on “Record as overpayment”/);
  assert.match(refused.text, /value="500"/, 'the amount typed is kept');
  assert.equal(t.db.get('SELECT COUNT(*) AS n FROM r_payments WHERE invoice = ?', id).n, 1);

  const over = await pay(id, 500, '2026-11-05', { overpayment: '1' });
  assert.equal(over.status, 303, text(over).slice(0, 300));
  const i = invoice('OVER-1');
  assert.equal(i.status, 'Paid');
  assert.equal(i.paid_total, 1100);
  assert.equal(i.balance, 0);
  assert.equal(i.credit, 100);
  assert.equal(i.paid_date, '2026-11-05', 'the second payment settled it');
  assert.equal(i.next.label, 'Paid, £100.00 overpaid');

  const page = text(await owner.get(`/app/invoices/${id}`));
  assert.match(page, /Credit \(overpaid\) £100\.00/);
  assert.match(page, /Paid so far £1,100\.00/);
  assert.match(page, /The customer has paid £100\.00 more than this invoice/);
  const brightside = customerId('%Brightside%');
  assert.match(text(await owner.get(`/app/customers/${brightside}`)), /Credit held £100\.00/);
  const statement = text(await owner.get(`/app/customers/${brightside}/statement`));
  assert.match(statement, /OVER-1 .*£1,000\.00 £1,100\.00 -£100\.00 credit/);
  assert.match(statement, /A negative balance marked credit is money received above the invoice amount/);
  assert.match(text(await owner.get('/app/invoices?view=paid')), /OVER-1/);
  const exported = (await owner.get('/app/invoices/export.csv')).text;
  assert.match(exported, /Overpaid \(credit\)/);

  // Deleting the overpayment takes the credit away again and leaves the invoice paid.
  const second = t.db.get('SELECT id FROM r_payments WHERE invoice = ? ORDER BY id DESC LIMIT 1', id).id;
  await owner.post(`/app/payments/${second}/delete`);
  assert.equal(invoice('OVER-1').credit, 0);
  assert.equal(invoice('OVER-1').status, 'Open', 'only £600 of £1,000 is left');
});

test('paying an invoice again is an overpayment too, and the money counts in the month it arrived', async () => {
  const id = await addInvoice('OVER-2', { amount: '300' });
  await addPayment(id, 300, '2026-11-02');
  assert.equal(invoice('OVER-2').status, 'Paid');
  await owner.get(`/app/payments/new?invoice=${id}`);
  const again = await pay(id, 300, '2026-11-09');
  assert.equal(again.status, 422);
  assert.match(text(again), /This invoice is already fully paid\. If the customer paid it again, turn on “Record as overpayment”/);
  assert.equal((await pay(id, 300, '2026-11-09', { overpayment: '1' })).status, 303);
  const i = invoice('OVER-2');
  assert.equal(i.credit, 300);
  assert.equal(i.paid_date, '2026-11-02', 'the Paid date is when the invoice was settled, not when it was paid a second time');
  const nov = t.db.get("SELECT SUM(amount) AS s FROM r_payments WHERE org_id = ? AND date LIKE '2026-11-%'", org.id).s;
  const reports = (await owner.get('/app/reports')).text;
  const collected = (/data-label="Month">Nov 2026<\/td>.*?data-label="Collected">([^<]*)</s.exec(reports) || [])[1];
  assert.equal(collected, `£${nov.toLocaleString('en-GB', { minimumFractionDigits: 2 })}`, 'cash received includes the overpayment');
  // Lowering the amount of the overpayment to what was owed is fine, and clears the credit.
  const second = t.db.get('SELECT id FROM r_payments WHERE invoice = ? ORDER BY id DESC LIMIT 1', id).id;
  await owner.get(`/app/payments/${second}/edit`);
  const edit = await owner.post(`/app/payments/${second}`, { invoice: String(id), date: '2026-11-09', amount: '0.01', overpayment: '1', method: 'Bank transfer' });
  assert.equal(edit.status, 303);
  assert.equal(invoice('OVER-2').credit, 0.01);
});

test('overpayments work through the API and CSV import with the same confirmation', async () => {
  const id = await addInvoice('OVER-3', { amount: '200' });
  const key = await apiKey();
  const refused = await owner.api('POST', '/api/v1/payments', key, { invoice: id, date: '2026-11-05', amount: 250 });
  assert.equal(refused.status, 422);
  assert.match(refused.json().fieldErrors.amount, /Record as overpayment/);
  const ok = await owner.api('POST', '/api/v1/payments', key, { invoice: id, date: '2026-11-05', amount: 250, overpayment: true });
  assert.equal(ok.status, 201);
  assert.equal(ok.json().data.overpayment, true);
  assert.equal((await owner.api('GET', `/api/v1/invoices/${id}`, key)).json().data.credit, 50);

  const other = await addInvoice('OVER-4', { amount: '100' });
  await owner.get('/app/payments/import');
  const bad = await owner.post('/app/payments/import', { csv: `Invoice,Date received,Amount\nOVER-4,2026-11-05,150` });
  assert.match(text(bad), /Row 2: Amount: Only £100\.00 is still owed/);
  const good = await owner.post('/app/payments/import', { csv: `Invoice,Date received,Amount,Record as overpayment\nOVER-4,2026-11-05,150,Yes`, commit: '1' });
  assert.equal(good.status, 303, text(good).slice(0, 300));
  assert.equal(invoice('OVER-4').credit, 50);
  assert.equal(other, idOf('OVER-4'));
});

/* ------------------------------------------------------------------ the founder console needs a verified email */

const founderApp = async (env = {}, { signups = ['founder@example.com'] } = {}) => {
  const app = await startTestApp({ definition, env: { FOUNDER_EMAILS: 'Founder@Example.com, second@example.com', ...env } });
  const clients = {};
  for (const email of signups) {
    const c = app.client();
    await c.get('/signup');
    const r = await c.post('/signup', { name: email.split('@')[0], email, orgName: `${email.split('@')[0]} Ltd`, password: 'copper-kettle-77' });
    assert.equal(r.status, 303, r.text.slice(0, 200));
    clients[email] = c;
  }
  return { app, clients };
};
const PAGES = ['/app/founder', '/app/founder/checklist', '/app/founder/plan', '/app/founder/marketing', '/app/founder/model', '/app/founder/leads', '/app/founder/leads.csv'];

test('an address listed in FOUNDER_EMAILS sees nothing of the console until it has been verified by an emailed link', async () => {
  const { app, clients } = await founderApp({}, { signups: ['founder@example.com', 'stranger@example.com'] });
  try {
    const founder = clients['founder@example.com'];
    await app.client().post('/waitlist', {});
    // Before: every console page is the verification page (nothing about revenue or leads), and the menu still offers the console.
    assert.match(text(await founder.get('/app')), /Founder console/);
    for (const p of PAGES) {
      const r = await founder.get(p);
      assert.equal(r.status, 403, p);
      assert.match(text(r), /Verify your email address/, p);
      assert.doesNotMatch(text(r), /Revenue recognised|Sign-ups|Leads \(|Launch readiness|Path to £1m/, `${p} leaked the console`);
    }
    assert.equal((await founder.post('/app/founder/checklist', { item: 'solicitor' })).status, 403, 'ticking the checklist needs verification too');
    assert.equal(app.db.kvGet('founder:checklist'), null);
    // Someone who is not listed gets the plain 403 and cannot ask for a link.
    const stranger = clients['stranger@example.com'];
    for (const p of PAGES) assert.equal((await stranger.get(p)).status, 403, p);
    assert.doesNotMatch(text(await stranger.get('/app/founder')), /Verify your email address/);
    assert.equal((await stranger.post('/app/founder/verify')).status, 403);
    assert.equal(app.db.get("SELECT COUNT(*) AS n FROM tokens WHERE kind = 'founder-verify'").n, 0);
  } finally {
    await app.stop();
  }
});

test('the verification link is emailed, single-use, expires and only works for the account it was sent to', async () => {
  const { app, clients } = await founderApp({}, { signups: ['founder@example.com', 'second@example.com', 'stranger@example.com'] });
  try {
    const founder = clients['founder@example.com'];
    await founder.get('/app/founder');
    const asked = await founder.post('/app/founder/verify');
    assert.equal(asked.status, 303);
    assert.equal(asked.location, '/app/founder');
    const mail = app.db.get("SELECT * FROM outbox WHERE related = 'verify' ORDER BY id DESC LIMIT 1");
    assert.equal(mail.to_addr, 'founder@example.com');
    assert.match(mail.body_text, new RegExp(`${app.base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/app/founder/verify/[A-Za-z0-9_-]+`));
    const token = tokenFromOutbox(app.db, 'founder@example.com', 'verify');
    // With no email provider (development) the message is in the workspace's Activity → Emails, so it can be followed.
    assert.match(text(await founder.get('/app/activity/emails')), /Open the PaidOnTime founder console/);

    // Not signed in: log in first, then come back to the link. Signed in as someone else: refused, and nothing is used up.
    const anon = app.client();
    const bounced = await anon.get(`/app/founder/verify/${token}`);
    assert.equal(bounced.status, 303);
    assert.match(bounced.location, /^\/login\?next=%2Fapp%2Ffounder%2Fverify%2F/);
    assert.equal((await clients['stranger@example.com'].get(`/app/founder/verify/${token}`)).status, 403);
    const second = clients['second@example.com'];
    const wrong = await second.get(`/app/founder/verify/${token}`);
    assert.equal(wrong.status, 403, 'a different listed founder cannot use it either');
    assert.match(text(wrong), /sent for a different account/);
    assert.equal((await second.get('/app/founder')).status, 403);
    assert.equal(app.db.get("SELECT used_at FROM tokens WHERE kind = 'founder-verify'").used_at, null);

    // Asking again retires the older link.
    await founder.post('/app/founder/verify');
    const newer = tokenFromOutbox(app.db, 'founder@example.com', 'verify');
    assert.notEqual(newer, token);
    const stale = await founder.get(`/app/founder/verify/${token}`);
    assert.equal(stale.status, 410);
    assert.match(text(stale), /expired or has already been used/);
    assert.equal((await founder.get('/app/founder')).status, 403);

    // An expired link does nothing.
    app.db.run("UPDATE tokens SET expires_at = '2026-01-01T00:00:00.000Z' WHERE kind = 'founder-verify' AND used_at IS NULL");
    assert.equal((await founder.get(`/app/founder/verify/${newer}`)).status, 410);
    assert.equal((await founder.get('/app/founder')).status, 403);

    // A fresh link, used while signed in as the founder, opens everything.
    await founder.post('/app/founder/verify');
    const fresh = tokenFromOutbox(app.db, 'founder@example.com', 'verify');
    const ok = await founder.get(`/app/founder/verify/${fresh}`);
    assert.equal(ok.status, 303);
    assert.equal(ok.location, '/app/founder');
    for (const p of PAGES) assert.equal((await founder.get(p)).status, 200, p);
    assert.match(text(await founder.get('/app/founder')), /Sign-ups/);
    // Single use: with the verification forgotten, the same link no longer works.
    app.db.run("DELETE FROM kv WHERE key LIKE 'founder:verified:%'");
    assert.equal((await founder.get(`/app/founder/verify/${fresh}`)).status, 410);
    assert.equal((await founder.get('/app/founder')).status, 403);
  } finally {
    await app.stop();
  }
});

test('the verification email stays out of the workspace outbox when a real provider sends it, and is refused in production with none', async () => {
  const realFetch = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith('https://api.resend.com/')) {
      sent.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ id: 're_1' }), { status: 200 });
    }
    return realFetch(url, init);
  };
  const withProvider = await founderApp({ RESEND_API_KEY: 'test-key' });
  try {
    const founder = withProvider.clients['founder@example.com'];
    await founder.get('/app/founder');
    assert.equal((await founder.post('/app/founder/verify')).status, 303);
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].to, ['founder@example.com']);
    assert.match(sent[0].text, /\/app\/founder\/verify\//);
    const row = withProvider.app.db.get("SELECT org_id, status FROM outbox WHERE related = 'verify'");
    assert.equal(row.status, 'sent');
    assert.equal(row.org_id, null, 'otherwise whoever registered the address first could read the link in Activity → Emails');
    assert.doesNotMatch(text(await founder.get('/app/activity/emails')), /founder console/);
  } finally {
    globalThis.fetch = realFetch;
    await withProvider.app.stop();
  }
  const prod = await founderApp({ NODE_ENV: 'production', BASE_URL: 'https://paidontime.test' });
  try {
    const founder = prod.clients['founder@example.com'];
    const page = await founder.get('/app/founder');
    assert.equal(page.status, 403);
    assert.match(text(page), /Email delivery is not set up \(add RESEND_API_KEY or POSTMARK_TOKEN\)/);
    assert.doesNotMatch(page.text, /Email me the link/);
    assert.equal((await founder.post('/app/founder/verify')).status, 503);
    assert.equal(prod.app.db.get("SELECT COUNT(*) AS n FROM tokens WHERE kind = 'founder-verify'").n, 0, 'no link could be read from the outbox, so none is made');
  } finally {
    await prod.app.stop();
  }
});

test('with no FOUNDER_EMAILS in development the first user opens the console as before, and a lapsed workspace does not lock a founder out of verifying', async () => {
  const dev = await startTestApp({ definition });
  try {
    const first = dev.client();
    await first.get('/signup');
    assert.equal((await first.post('/signup', { name: 'First User', email: 'first@example.com', orgName: 'First Ltd', password: 'copper-kettle-77' })).status, 303);
    assert.equal((await first.get('/app/founder')).status, 200);
  } finally {
    await dev.stop();
  }
  const { app, clients } = await founderApp();
  try {
    const founder = clients['founder@example.com'];
    app.db.run("UPDATE orgs SET trial_ends = '2026-01-01', plan_status = 'trialing'");
    assert.equal((await founder.post('/app/founder/checklist', { item: 'solicitor' })).status, 403, 'unverified');
    assert.equal((await founder.post('/app/founder/verify')).status, 303, 'the founder console is not workspace data, so a read-only workspace does not block it');
    await founder.get(`/app/founder/verify/${tokenFromOutbox(app.db, 'founder@example.com', 'verify')}`);
    assert.equal((await founder.post('/app/founder/checklist', { item: 'solicitor' })).status, 303);
  } finally {
    await app.stop();
  }
});

/* ------------------------------------------------------------------ smaller fixes */

test('a workspace name with a stray carriage return cannot inject lines into the calendar feed', async () => {
  const c = t.client();
  await c.get('/signup');
  assert.equal((await c.post('/signup', { name: 'Eve', email: 'eve@example.com', orgName: 'Eve\rBEGIN:VEVENT\rSUMMARY:injected', password: 'copper-kettle-77' })).status, 303);
  const token = t.db.get("SELECT feed_token FROM orgs WHERE name LIKE 'Eve%'").feed_token;
  const feed = await t.client().get(`/feed/${token}.ics`);
  assert.equal(feed.status, 200);
  assert.doesNotMatch(feed.text, /\r(?!\n)/, 'no bare carriage returns');
  assert.ok(!feed.text.split('\r\n').some((l) => l === 'SUMMARY:injected'));
});
