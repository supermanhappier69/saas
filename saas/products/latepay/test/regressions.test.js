// Regression tests for PaidOnTime bugs found in a bug hunt: invoice and payment bookkeeping, statutory interest for consumers,
// the chase log and "work through the list", failed emails, exports, CSV imports, public pages and the founder model.
process.env.APP_TODAY = '2026-11-11';

const { test, before, after } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const { startTestApp } = await import('../../../test/helpers.js');
const { definition } = await import('../definition.js');
const { ladderFrom, nextAction } = await import('../lib/ladder.js');
const { invoiceFigures } = await import('../lib/calc.js');
const { waitlistCsv } = await import('../pages/guides.js');
const { modelFor } = await import('../pages/founder.js');

let t;
let owner;
let org;
const OWNER = { name: 'Mina Patel', email: 'mina@example.com', orgName: 'Patel Print Ltd', password: 'copper-kettle-77' };

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

const text = (r) => r.text.replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const ctxFor = () => ({ org: t.services.auth.getOrg(org.id), services: t.services, cache: {}, user: null, role: 'owner' });
const invoice = (number) => {
  const { resources } = t.services;
  return resources.query(ctxFor(), resources.get('invoices'), { all: true }).rows.find((i) => i.number === number);
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
const addPayment = async (invoiceId, amount, date = '2026-11-05') => {
  await owner.get(`/app/payments/new?invoice=${invoiceId}`);
  const r = await owner.post('/app/payments', { invoice: String(invoiceId), date, amount: String(amount), method: 'Bank transfer' });
  assert.equal(r.status, 303, text(r).slice(0, 400));
  return t.db.get('SELECT id FROM r_payments WHERE invoice = ? ORDER BY id DESC LIMIT 1', invoiceId).id;
};

test('statutory interest never applies to a consumer, even when the customer is switched to Consumer after the invoice exists', async () => {
  const was = invoice('INV-1002');
  assert.ok(was.interest > 0 && was.fixed_sum === 40, 'a business customer is charged interest and the fixed sum');
  const northgate = t.db.get("SELECT customer AS id FROM r_invoices WHERE number = 'INV-1002'").id;
  await owner.get(`/app/customers/${northgate}/edit`);
  const r = await owner.post(`/app/customers/${northgate}`, { name: 'SAMPLE · Northgate Events Ltd', customer_type: 'Consumer (not a business)', terms_days: '30', account_status: 'Active' });
  assert.equal(r.status, 303);
  const now = invoice('INV-1002');
  assert.equal(now.claim_interest, true, 'the tick box is untouched');
  assert.equal(now.interest, 0);
  assert.equal(now.fixed_sum, 0);
  assert.equal(now.fig.claim, false);
  assert.match(now.rate_check, /Not claiming statutory interest/);
  const page = text(await owner.get(`/app/invoices/${now.id}`));
  assert.match(page, /Not claiming statutory interest/);
  assert.doesNotMatch(page, /Bank of England base rate on/);
});

test('deleting the only payment on a paid invoice reopens it', async () => {
  const id = await addInvoice('REG-PAID');
  const pay = await addPayment(id, 1000);
  assert.equal(invoice('REG-PAID').status, 'Paid');
  assert.equal(invoice('REG-PAID').paid_date, '2026-11-05');
  assert.equal((await owner.post(`/app/payments/${pay}/delete`)).status, 303);
  const after = invoice('REG-PAID');
  assert.equal(after.status, 'Open', 'it used to stay Paid with a £0 balance');
  assert.equal(after.balance, 1000);
  assert.equal(after.paid_date, null);
});

test('an invoice marked Paid by hand stays Paid when a part-payment record is deleted', async () => {
  const id = await addInvoice('REG-MANUAL');
  const pay = await addPayment(id, 200, '2026-10-20');
  // The rest was settled outside the app (a credit note, say), so the owner marks the invoice Paid by hand.
  await owner.get(`/app/invoices/${id}/edit`);
  const marked = await owner.post(`/app/invoices/${id}`, { number: 'REG-MANUAL', customer: String(customerId('%Brightside%')), invoice_date: '2026-10-01', due_date: '2026-10-31', amount: '1000', status: 'Paid', claim_interest: '1', paid_date: '2026-11-02' });
  assert.equal(marked.status, 303);
  assert.equal(invoice('REG-MANUAL').status, 'Paid');
  await owner.post(`/app/payments/${pay}/delete`);
  assert.equal(invoice('REG-MANUAL').status, 'Paid', 'the Paid date (2 Nov) is not the deleted payment date (20 Oct), so that payment did not set it');
});

test('moving a payment to another invoice updates both invoices', async () => {
  const one = await addInvoice('REG-MOVE-1', { amount: '300' });
  const two = await addInvoice('REG-MOVE-2', { amount: '300' });
  const pay = await addPayment(one, 300);
  assert.equal(invoice('REG-MOVE-1').status, 'Paid');
  await owner.get(`/app/payments/${pay}/edit`);
  const moved = await owner.post(`/app/payments/${pay}`, { invoice: String(two), date: '2026-11-05', amount: '300', method: 'Bank transfer' });
  assert.equal(moved.status, 303);
  assert.equal(invoice('REG-MOVE-2').status, 'Paid');
  const left = invoice('REG-MOVE-1');
  assert.equal(left.status, 'Open', 'the invoice the payment left used to stay Paid');
  assert.equal(left.balance, 300);
});

test('changing an invoice amount re-checks it against its payments', async () => {
  const id = await addInvoice('REG-AMOUNT');
  await addPayment(id, 1000);
  assert.equal(invoice('REG-AMOUNT').status, 'Paid');
  await owner.get(`/app/invoices/${id}/edit`);
  const raised = await owner.post(`/app/invoices/${id}`, { number: 'REG-AMOUNT', customer: String(customerId('%Brightside%')), invoice_date: '2026-10-01', due_date: '2026-10-31', amount: '1500', status: 'Paid', claim_interest: '1', paid_date: '2026-11-05' });
  assert.equal(raised.status, 303);
  assert.equal(invoice('REG-AMOUNT').status, 'Open', 'it used to stay Paid with a £0 balance although only £1,000 of £1,500 was paid');
  assert.equal(invoice('REG-AMOUNT').balance, 500);
  const lowered = await owner.post(`/app/invoices/${id}`, { number: 'REG-AMOUNT', customer: String(customerId('%Brightside%')), invoice_date: '2026-10-01', due_date: '2026-10-31', amount: '1000', status: 'Open', claim_interest: '1' });
  assert.equal(lowered.status, 303);
  assert.equal(invoice('REG-AMOUNT').status, 'Paid');
});

test('the invoice delete confirmation counts the payments and chase entries that go with it', async () => {
  const id = await addInvoice('REG-DELETE', { amount: '900' });
  await addPayment(id, 100, '2026-11-01');
  await addPayment(id, 200, '2026-11-02');
  await owner.get('/app/chases/new');
  for (const date of ['2026-11-03', '2026-11-04']) assert.equal((await owner.post('/app/chases', { invoice: String(id), date, channel: 'Phone' })).status, 303);
  assert.match((await owner.get(`/app/invoices/${id}`)).text, /This also deletes 2 payments and 2 chase log entries\./);
  const bare = await addInvoice('REG-NOTHING-ELSE', { amount: '50' });
  assert.doesNotMatch((await owner.get(`/app/invoices/${bare}`)).text, /This also deletes/);
});

test('payments and chase entries cannot be dated in the future, and a promise to pay needs its date', async () => {
  const id = await addInvoice('REG-DATES');
  await owner.get(`/app/payments/new?invoice=${id}`);
  const future = await owner.post('/app/payments', { invoice: String(id), date: '2026-11-12', amount: '10', method: 'Cash' });
  assert.equal(future.status, 422);
  assert.match(text(future), /can't be in the future/);
  await owner.get('/app/chases/new');
  const chase = await owner.post('/app/chases', { invoice: String(id), date: '2026-12-01', channel: 'Phone' });
  assert.equal(chase.status, 422);
  assert.match(text(chase), /can't be in the future/);
  const noDate = await owner.post('/app/chases', { invoice: String(id), date: '2026-11-11', channel: 'Phone', outcome: 'Promise to pay', promised_date: '' });
  assert.equal(noDate.status, 422);
  assert.match(text(noDate), /Enter the date they promised to pay by/);
  const ok = await owner.post('/app/chases', { invoice: String(id), date: '2026-11-11', channel: 'Phone', outcome: 'Promise to pay', promised_date: '2026-11-20' });
  assert.equal(ok.status, 303);
  assert.equal(invoice('REG-DATES').promised_date, '2026-11-20');
});

test('two templates cannot share a number', async () => {
  await owner.get('/app/templates/new');
  const dup = await owner.post('/app/templates', { code: '1', name: 'Another friendly one', channel: 'Email', body: 'Hello' });
  assert.equal(dup.status, 422);
  assert.match(text(dup), /Another template already uses this number/);
  const first = t.db.get("SELECT id FROM r_templates WHERE org_id = ? AND code = '1'", org.id).id;
  await owner.get(`/app/templates/${first}/edit`);
  const keep = await owner.post(`/app/templates/${first}`, { code: '1', name: 'Friendly reminder', channel: 'Email', stage: '1 · Friendly reminder', subject: 'Overdue', body: 'Hi [Contact name]' });
  assert.equal(keep.status, 303, 'saving a template with its own number is fine');
});

test('a failed email is not logged as a sent reminder, and the wording is kept for another try', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => (String(url).startsWith('https://api.resend.com')
    ? new Response(JSON.stringify({ message: 'Invalid API key' }), { status: 401 })
    : realFetch(url, opts));
  const failing = await startTestApp({ definition, env: { RESEND_API_KEY: 're_test', MAIL_FROM: 'PaidOnTime <noreply@example.com>' } });
  try {
    const c = failing.client();
    await c.get('/signup');
    assert.equal((await c.post('/signup', { name: 'Fay Fail', email: 'fay@example.com', orgName: 'Fail Ltd', password: 'copper-kettle-77' })).status, 303);
    const id = failing.db.get("SELECT id FROM r_invoices WHERE number = 'INV-1002'").id;
    const logged = () => failing.db.get('SELECT COUNT(*) AS n FROM r_chases WHERE invoice = ?', id).n;
    const was = logged();
    await c.get(`/app/invoices/${id}/compose?t=3`);
    const sent = await c.post(`/app/invoices/${id}/compose`, { t: '3', to: 'cust@example.com', subject: 'Final notice', body: 'Please pay my edited wording.' });
    assert.equal(sent.status, 422);
    assert.match(text(sent), /The email could not be sent, so nothing was logged/);
    assert.match(sent.text, /Please pay my edited wording\./, 'the textarea keeps what was typed');
    assert.equal(logged(), was, 'it used to log a "Sent" contact and push the follow-up out a week');
    assert.equal(failing.db.get("SELECT status FROM outbox WHERE to_addr = 'cust@example.com'").status, 'failed');
  } finally {
    globalThis.fetch = realFetch;
    await failing.stop();
  }
});

test('"work through the list" skips reminders the plan does not include instead of trapping the user on an upgrade page', async () => {
  const stage4 = await addInvoice('REG-STAGE4', { invoice_date: '2026-09-01', due_date: '2026-10-05', amount: '500' });
  assert.equal(invoice('REG-STAGE4').next.template, '4', '37 days overdue is the interest claim stage, a Complete-only template');
  const dueCount = async () => Number(/Send the (\d+) due reminder/.exec(text(await owner.get('/app/chase')))[1]);
  let next = await owner.get('/app/chase/next');
  assert.equal(next.status, 303);
  assert.match(next.location, new RegExp(`/app/invoices/${stage4}/compose\\?t=4`), 'Complete includes it, and it is the oldest');
  const onComplete = await dueCount();
  t.db.run("UPDATE orgs SET plan = 'core', plan_status = 'active' WHERE id = ?", org.id);
  try {
    next = await owner.get('/app/chase/next');
    assert.equal(next.status, 303);
    assert.doesNotMatch(next.location, new RegExp(`/invoices/${stage4}/`), 'the Complete-only email is left out of the queue');
    assert.match(next.location, /\/compose\?t=[0-3]&queue=/);
    assert.equal(await dueCount(), onComplete - 1);
  } finally {
    t.db.run("UPDATE orgs SET plan = 'complete', plan_status = 'trialing' WHERE id = ?", org.id);
  }
});

test('optional wording in brackets is not advised as a merge field to fill in from Settings', async () => {
  const page = text(await owner.get(`/app/invoices/${idOf('INV-1002')}/compose?t=3`));
  assert.match(page, /Still in brackets: \[and to pause further work on your account\]/);
  assert.match(page, /\[and to pause further work on your account\] is optional wording: keep it or delete it, brackets included/);
  assert.doesNotMatch(page, /add them in Settings/, 'nothing here can be filled in from Settings');
  // A real merge field with no value still gets the original advice, and is not called optional.
  const preDue = text(await owner.get(`/app/invoices/${idOf('INV-1002')}/compose?t=0`));
  assert.match(preDue, /Still in brackets: \[Bank details\]/);
  assert.match(preDue, /add them in Settings/);
  assert.doesNotMatch(preDue, /optional wording/);
});

test('guide and free page names that match object properties are 404s, not crashes', async () => {
  for (const p of ['/app/guides/constructor', '/app/guides/__proto__', '/app/guides/toString/print', '/free/constructor', '/free/__proto__', '/free/hasOwnProperty']) {
    const r = await owner.get(p);
    assert.equal(r.status, 404, `${p} gave ${r.status}`);
  }
  assert.equal((await owner.get('/app/guides/sop')).status, 200);
  assert.equal((await owner.get('/free/letter-before-action')).status, 200);
});

test('the waitlist CSV neutralises spreadsheet formulas', async () => {
  const c = t.client();
  await c.get('/waitlist');
  const joined = await c.post('/waitlist', { name: '=HYPERLINK("http://example.invalid","click")', email: 'formula@example.com', company: '+SUM(A1)', message: '@cmd' });
  assert.equal(joined.status, 200, text(joined).slice(0, 300));
  const csv = waitlistCsv(t.db);
  assert.match(csv, /'=HYPERLINK/);
  assert.match(csv, /'\+SUM\(A1\)/);
  assert.match(csv, /'@cmd/);
  assert.doesNotMatch(csv, /,=HYPERLINK|,\+SUM|,@cmd/);
});

test('exporting a list from Settings includes paid invoices, and the list page exports what it shows', async () => {
  const everything = await owner.get('/app/invoices/export.csv');
  assert.equal(everything.status, 200);
  assert.match(everything.text, /INV-1006/, 'a paid invoice used to be missing because Unpaid is the default view');
  assert.match(everything.text, /INV-1001/);
  const unpaid = await owner.get('/app/invoices/export.csv?view=unpaid');
  assert.doesNotMatch(unpaid.text, /INV-1006/);
  assert.match((await owner.get('/app/invoices')).text, /href="\/app\/invoices\/export\.csv\?view=unpaid"/);
  assert.match((await owner.get('/app/invoices?view=all')).text, /href="\/app\/invoices\/export\.csv"/);
  assert.match((await owner.get('/app/settings')).text, /href="\/app\/invoices\/export\.csv"/);
});

test('searching the invoice list finds paid invoices too, unless a view is chosen', async () => {
  const found = text(await owner.get('/app/invoices?q=INV-1006'));
  assert.match(found, /INV-1006/, 'a search used to be limited to the default Unpaid view and said "No matching records"');
  assert.doesNotMatch(found, /No matching records/);
  const unpaidOnly = text(await owner.get('/app/invoices?q=INV-1006&view=unpaid'));
  assert.match(unpaidOnly, /No matching records/);
  assert.doesNotMatch(text(await owner.get('/app/invoices')), /INV-1006/, 'the plain list is still the Unpaid view');
});

test('the dashboard "Broken promises" card opens a list of exactly the broken promises', async () => {
  const dash = await owner.get('/app');
  assert.match(dash.text, /href="\/app\/invoices\?view=broken"/, 'it used to open every promise, including ones still in the future');
  const cardCount = /Broken promises\s+(\d+)/.exec(text(dash))?.[1];
  const list = await owner.get('/app/invoices?view=broken');
  const tabCount = /Broken promises\s+(\d+)/.exec(text(list))?.[1];
  assert.ok(cardCount && cardCount === tabCount, `card says ${cardCount}, list tab says ${tabCount}`);
  assert.match(text(list), /INV-1001/);
  assert.doesNotMatch(text(list), /INV-1009/, 'its promise (21 Nov) is still to come');
  assert.match(text(await owner.get('/app/invoices?view=promises')), /INV-1009/);
});

test('a payments CSV matches a plain-number invoice number to that invoice, not to the record with that ID', async () => {
  const numbered = await addInvoice('2', { amount: '800' });
  assert.notEqual(numbered, 2);
  assert.equal(t.db.get('SELECT number FROM r_invoices WHERE id = 2').number, 'INV-1002', 'the invoice with record ID 2 is a different one');
  await owner.get('/app/payments/import');
  const csv = `Invoice,Date,Amount\n2,05/11/2026,100\n`;
  const preview = await owner.post('/app/payments/import', { csv });
  assert.equal(preview.status, 200, text(preview).slice(0, 300));
  const done = await owner.post('/app/payments/import', { csv, commit: '1' });
  assert.equal(done.status, 303, text(done).slice(0, 300));
  const pay = t.db.get('SELECT invoice, amount FROM r_payments ORDER BY id DESC LIMIT 1');
  assert.equal(pay.invoice, numbered, 'it used to attach the payment to the invoice whose record ID was 2');
  assert.equal(pay.amount, 100);
});

test('the money in a semicolon CSV with decimal commas is read correctly', async () => {
  await owner.get('/app/customers/import');
  const csv = 'Legal name;Customer type;Credit limit\nDecimal Comma Ltd;Partnership;"1.500,00"\nPlain Comma Ltd;Partnership;1500,50\n';
  const done = await owner.post('/app/customers/import', { csv, commit: '1' });
  assert.equal(done.status, 303, text(done).slice(0, 300));
  assert.equal(t.db.get("SELECT credit_limit FROM r_customers WHERE name = 'Decimal Comma Ltd'").credit_limit, 1500, 'it used to be £1.50');
  assert.equal(t.db.get("SELECT credit_limit FROM r_customers WHERE name = 'Plain Comma Ltd'").credit_limit, 1500.5, 'it used to be £150,050');
});

test('the public calculator says when a date cannot be read instead of quietly using today', async () => {
  const c = t.client();
  const bad = text(await c.get('/calculator?amount=1000&due=2026-10-01&until=not-a-date'));
  assert.match(bad, /Enter a real date for "Paid or checked on"/);
  assert.doesNotMatch(bad, /Statutory interest £/);
  const before = text(await c.get('/calculator?amount=1000&due=2026-10-01&until=2026-09-01'));
  assert.match(before, /can't be before the due date/);
  const blank = text(await c.get('/calculator?amount=1000&due=2026-10-01&until='));
  assert.match(blank, /Days late 41/);
});

test('blank ladder settings fall back to the defaults instead of collapsing the ladder to 0', () => {
  const L = ladderFrom({ pre_due_days: null, stage2_from: '', stage3_from: undefined, stage4_from: ' ', stage5_from: null });
  assert.deepEqual(L, { pre_due_days: 3, stage2_from: 8, stage3_from: 15, stage4_from: 31, stage5_from: 46 });
  assert.equal(ladderFrom({ stage2_from: '10', pre_due_days: '0' }).stage2_from, 10);
  assert.equal(ladderFrom({ pre_due_days: '0' }).pre_due_days, 0, 'an explicit 0 still means no pre-due reminder');
});

test('days are pluralised properly in the chase list and next action labels, and later dates keep their capital letter', async () => {
  await addInvoice('REG-ONE-DAY', { invoice_date: '2026-10-11', due_date: '2026-11-10', amount: '200' });
  await addInvoice('REG-LATER', { invoice_date: '2026-11-01', due_date: '2026-11-30', amount: '200' });
  const list = text(await owner.get('/app/chase'));
  assert.match(list, /REG-ONE-DAY.{0,120}1 day overdue/);
  assert.doesNotMatch(list, /(?<!\d)1 days overdue/);
  assert.match(list, /due 30 Nov 2026/, 'it used to read "due 30 nov 2026"');
  const L = ladderFrom({});
  const fig = invoiceFigures({ amount: 500, dueDate: '2026-10-30', today: '2026-11-11', payments: [{ date: '2026-10-31', amount: 500 }] });
  assert.equal(fig.daysOverdue, 1);
  const next = nextAction({ status: 'Paid', due_date: '2026-10-30' }, fig, [], { today: '2026-11-11', L });
  assert.match(next.label, /^Paid 1 day late: £/);
});

test('the chase-list "skip" action is a CSRF-protected POST, not a GET link', async () => {
  const id = idOf('INV-1004');
  const rows = () => t.db.get('SELECT COUNT(*) AS n FROM r_chases WHERE invoice = ?', id).n;
  const was = rows();
  const viaLink = await owner.request('GET', `/app/chase/skip/${id}`, { headers: { 'sec-fetch-site': 'same-origin' } });
  assert.notEqual(viaLink.status, 303);
  assert.equal(rows(), was, 'a plain link (or a link on another site) could previously log a contact');
  const forged = await owner.request('POST', `/app/chase/skip/${id}`, { body: 'x=1', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(forged.status, 403);
  assert.equal(rows(), was);
  await owner.get('/app/chase');
  const real = await owner.post(`/app/chase/skip/${id}`);
  assert.equal(real.status, 303);
  assert.equal(rows(), was + 1);
});

test('the calendar feed folds long lines by octets and never splits a character', async () => {
  const name = `Ünïcode 🚀 ${'客户'.repeat(30)} Ltd`;
  await owner.get('/app/customers/new');
  const made = await owner.post('/app/customers', { name, customer_type: 'Partnership', terms_days: '30', account_status: 'Active' });
  assert.equal(made.status, 303, text(made).slice(0, 300));
  const cust = t.db.get('SELECT id FROM r_customers WHERE org_id = ? AND name = ?', org.id, name).id;
  await addInvoice('REG-ICS', { customer: String(cust), invoice_date: '2026-10-20', due_date: '2026-11-05', amount: '250' });
  const token = t.db.get('SELECT feed_token FROM orgs WHERE id = ?', org.id).feed_token;
  const feed = await t.client().get(`/feed/${token}.ics`);
  assert.equal(feed.status, 200);
  const lines = feed.text.split('\r\n');
  assert.ok(lines.every((l) => Buffer.byteLength(l) <= 75), `longest line is ${Math.max(...lines.map((l) => Buffer.byteLength(l)))} octets`);
  const unfolded = feed.text.replace(/\r\n /g, '');
  assert.ok(unfolded.includes(name), 'the whole name survives folding and unfolding');
  assert.doesNotMatch(unfolded, /\uFFFD/);
});

test('the monthly review counts money in the month each payment arrived', async () => {
  // A fresh workspace, so the only payments besides the samples' are the two made here.
  const c = t.client();
  await c.get('/signup');
  assert.equal((await c.post('/signup', { name: 'Rae Review', email: 'rae@example.com', orgName: 'Review Ltd', password: 'copper-kettle-77' })).status, 303);
  const brightside = t.db.get("SELECT c.id FROM r_customers c JOIN orgs o ON o.id = c.org_id WHERE o.name = 'Review Ltd' AND c.name LIKE '%Brightside%'").id;
  await c.get('/app/invoices/new');
  const made = await c.post('/app/invoices', { number: 'REG-REVIEW', customer: String(brightside), invoice_date: '2026-09-01', due_date: '2026-09-30', amount: '1000', status: 'Open', claim_interest: '1' });
  assert.equal(made.status, 303, text(made).slice(0, 300));
  const id = t.db.get("SELECT id FROM r_invoices WHERE number = 'REG-REVIEW'").id;
  for (const [date, amount] of [['2026-10-05', '400'], ['2026-11-05', '600']]) {
    await c.get(`/app/payments/new?invoice=${id}`);
    assert.equal((await c.post('/app/payments', { invoice: String(id), date, amount, method: 'Bank transfer' })).status, 303);
  }
  const html = (await c.get('/app/reports')).text;
  const collected = (month) => (new RegExp(`data-label="Month">${month}</td>.*?data-label="Collected">([^<]*)<`, 's').exec(html) || [])[1];
  // October: the samples' £300 (INV-1008) and £1,600 (INV-1009) plus this £400. It used to count a whole invoice in the month it was settled.
  assert.equal(collected('Oct 2026'), '£2,300.00');
  assert.equal(collected('Nov 2026'), '£600.00');
});

test('removing sample data also removes what you logged against sample records, and keeps a sample customer your own invoice uses', async () => {
  const c = t.client();
  await c.get('/signup');
  assert.equal((await c.post('/signup', { name: 'Sam Sample', email: 'sam@example.com', orgName: 'Sample Ltd', password: 'copper-kettle-77' })).status, 303);
  const mine = t.db.get("SELECT id FROM orgs WHERE name = 'Sample Ltd'").id;
  const sample = (number) => t.db.get('SELECT id FROM r_invoices WHERE org_id = ? AND number = ?', mine, number).id;
  const kestrel = t.db.get("SELECT id FROM r_customers WHERE org_id = ? AND name LIKE '%Kestrel%'", mine).id;
  // Exploring: log a call and a payment against sample invoices, and add a real invoice for a sample customer.
  await c.get('/app/chases/new');
  assert.equal((await c.post('/app/chases', { invoice: String(sample('INV-1002')), date: '2026-11-10', channel: 'Phone', outcome: 'No response' })).status, 303);
  await c.get(`/app/payments/new?invoice=${sample('INV-1004')}`);
  assert.equal((await c.post('/app/payments', { invoice: String(sample('INV-1004')), date: '2026-11-10', amount: '100', method: 'Cash' })).status, 303);
  await c.get('/app/invoices/new');
  assert.equal((await c.post('/app/invoices', { number: 'REAL-1', customer: String(kestrel), invoice_date: '2026-11-01', due_date: '2026-12-01', amount: '500', status: 'Open', claim_interest: '1' })).status, 303);
  await c.get('/app/settings');
  assert.equal((await c.post('/app/settings/remove-samples')).status, 303);
  const flash = text(await c.get('/app'));
  assert.match(flash, /Removed 22 sample records\. Kept 1 that your own records use/);
  const orphans = (child, parent, column) => t.db.get(`SELECT COUNT(*) AS n FROM ${child} c WHERE c.org_id = ? AND NOT EXISTS (SELECT 1 FROM ${parent} p WHERE p.id = c.${column})`, mine).n;
  assert.equal(orphans('r_chases', 'r_invoices', 'invoice'), 0, 'the call logged on a sample invoice used to be left behind as "#N"');
  assert.equal(orphans('r_payments', 'r_invoices', 'invoice'), 0);
  assert.equal(orphans('r_invoices', 'r_customers', 'customer'), 0, 'the real invoice used to lose its customer');
  assert.equal(t.db.get('SELECT COUNT(*) AS n FROM r_customers WHERE org_id = ?', mine).n, 1);
  assert.equal(t.db.get('SELECT is_sample FROM r_customers WHERE id = ?', kestrel).is_sample, 0, 'the kept customer is now an ordinary record, so the sample banner goes away');
  assert.equal(t.db.get('SELECT COUNT(*) AS n FROM r_invoices WHERE org_id = ? AND is_sample = 1', mine).n, 0);
  assert.ok(t.db.get("SELECT id FROM r_invoices WHERE org_id = ? AND number = 'REAL-1'", mine));
  const page = text(await c.get(`/app/invoices/${t.db.get("SELECT id FROM r_invoices WHERE number = 'REAL-1'").id}`));
  assert.match(page, /Kestrel/);
  assert.doesNotMatch(page, /#\d+/);
  const activity = text(await c.get('/app/activity'));
  assert.match(activity, /Removed 22 sample records, kept 1/);
  assert.ok((activity.match(/deleted/g) || []).length < 5, 'the Activity log gets one line, not one per record');
});

test('the path-to-£1m model counts the buyers of the launch month once', () => {
  const m = modelFor({ visitors: 1000, growth: 0, trialRate: 10, paidRate: 10, churn: 0, retainers: 0, autopilotFrom: 6, autopilotRate: 25, months: 12 });
  // 10 sales a month, so 60 buyers by month 6 and a quarter of them take the plan: 15 subscribers (it used to be 17.5).
  assert.equal(m.rows[5].customers, 60);
  assert.equal(m.rows[5].subs, 15);
  assert.equal(m.rows[5].recurring, 360);
  assert.equal(m.rows[4].subs, 0);
  assert.equal(m.rows[6].recurring, 420, '17.5 subscribers at £24');
});
