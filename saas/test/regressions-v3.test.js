// v3 regression tests for the shared core: upgrading a one-off plan, delayed Stripe payments, invitation links in the email log,
// password reset links, and revoking an API key in a read-only workspace.
import crypto from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, testDefinition, tokenFromOutbox } from './helpers.js';
import { createBilling } from '../core/billing.js';

process.env.APP_TODAY = '2026-11-11';

const text = (r) => r.text.replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const OWNER = { name: 'Rhea Owner', email: 'rhea@example.com', orgName: 'Rhea Trading Ltd', password: 'river-lantern-42' };
const signUp = async (app, details = OWNER) => {
  const c = app.client();
  await c.get('/signup');
  const r = await c.post('/signup', details);
  assert.equal(r.status, 303, r.text.slice(0, 300));
  return c;
};

/* ------------------------------------------------------------------ upgrading a one-off plan */

const ONE_OFF = [
  { id: 'core', name: 'Core', price: 49, oneOff: true, limits: { seats: 2 } },
  { id: 'complete', name: 'Complete', price: 99, oneOff: true, limits: { seats: 5 } },
];
const STRIPE_ENV = { STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_PRICE_CORE: 'price_core', STRIPE_PRICE_COMPLETE: 'price_complete', STRIPE_WEBHOOK_SECRET: 'whsec_test' };

/** Runs fn while Stripe's API is stubbed; other URLs (the app under test) pass through. Returns what was sent to Stripe. */
async function withStripe(fn) {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (!String(url).startsWith('https://api.stripe.com/')) return realFetch(url, init);
    calls.push({ url: String(url), body: new URLSearchParams(init.body) });
    return new Response(JSON.stringify({ url: `https://checkout.stripe.com/c/pay/cs_test_${calls.length}` }), { status: 200 });
  };
  try {
    await fn();
  } finally {
    globalThis.fetch = realFetch;
  }
  return calls;
}

test('a workspace that has paid for a one-off plan upgrades by paying only the difference', () => {
  const billing = createBilling({ db: null, config: STRIPE_ENV, definition: { plans: ONE_OFF, trialPlan: 'complete' } });
  const core = { id: 1, plan: 'core', plan_status: 'active' };
  const quote = billing.upgrade(core, 'complete');
  assert.equal(quote.amount, 50);
  assert.equal(quote.from.id, 'core');
  assert.equal(billing.upgrade({ id: 1, plan: 'complete', plan_status: 'trialing' }, 'complete'), null, 'a trial has paid for nothing');
  assert.equal(billing.upgrade({ id: 1, plan: 'core', plan_status: 'trialing' }, 'complete'), null);
  assert.equal(billing.upgrade({ id: 1, plan: 'core', plan_status: 'active', is_demo: 1 }, 'complete'), null);
  assert.equal(billing.upgrade({ id: 1, plan: 'complete', plan_status: 'active' }, 'core'), null, 'no discount for a cheaper plan');
  assert.equal(billing.upgrade(core, 'core'), null);
  assert.equal(billing.owns({ plan: 'complete', plan_status: 'active' }, 'core'), true, 'Complete includes Core');
  assert.equal(billing.owns({ plan: 'core', plan_status: 'active' }, 'core'), true);
  assert.equal(billing.owns(core, 'complete'), false);
  assert.equal(billing.owns({ plan: 'core', plan_status: 'trialing' }, 'core'), false);
  const fractional = createBilling({ db: null, config: STRIPE_ENV, definition: { plans: [{ id: 'core', name: 'Core', price: 19.5, oneOff: true }, { id: 'complete', name: 'Complete', price: 49.99, oneOff: true }] } });
  assert.equal(fractional.upgrade(core, 'complete').amount, 30.49);
});

test('Stripe Checkout for an upgrade charges the difference as a one-off line item and keeps the metadata that activates the plan', async () => {
  const billing = createBilling({ db: null, config: { ...STRIPE_ENV, BASE_URL: 'https://app.example.com' }, definition: { plans: ONE_OFF, trialPlan: 'complete' } });
  const user = { email: 'rhea@example.com' };
  let url;
  const [call] = await withStripe(async () => {
    url = await billing.checkout({ id: 7, plan: 'core', plan_status: 'active', stripe_customer: 'cus_123' }, user, 'complete');
  });
  assert.equal(url, 'https://checkout.stripe.com/c/pay/cs_test_1');
  const b = call.body;
  assert.equal(b.get('mode'), 'payment');
  assert.equal(b.get('line_items[0][price_data][currency]'), 'gbp');
  assert.equal(b.get('line_items[0][price_data][unit_amount]'), '5000', '£99 − £49 = £50, in pence');
  assert.match(b.get('line_items[0][price_data][product_data][name]'), /Complete.*upgrade from Core/);
  assert.equal(b.get('line_items[0][quantity]'), '1');
  assert.equal(b.get('line_items[0][price]'), null, 'the £99 price must not be charged again');
  assert.equal(b.get('metadata[plan]'), 'complete', 'the webhook activates this plan');
  assert.equal(b.get('metadata[org_id]'), '7');
  assert.equal(b.get('metadata[upgrade_from]'), 'core');
  assert.equal(b.get('payment_intent_data[metadata][plan]'), 'complete');
  assert.equal(b.get('customer'), 'cus_123', 'the same Stripe customer, so the receipts stay together');
  assert.equal(b.get('customer_creation'), null);
  assert.equal(b.get('invoice_creation[enabled]'), 'true');
  assert.equal(b.get('success_url'), 'https://app.example.com/app/billing?checkout=success');

  // A workspace on its trial still pays the full price, through the configured price.
  const [full] = await withStripe(async () => {
    await billing.checkout({ id: 7, plan: 'complete', plan_status: 'trialing', stripe_customer: null }, user, 'complete');
  });
  assert.equal(full.body.get('line_items[0][price]'), 'price_complete');
  assert.equal(full.body.get('line_items[0][price_data][unit_amount]'), null);
  assert.equal(full.body.get('metadata[upgrade_from]'), null);

  // Paying for a plan it already has, or one that Complete includes, is refused before Stripe is called.
  const none = await withStripe(async () => {
    for (const [plan, want] of [['complete', 'complete'], ['complete', 'core'], ['core', 'core']]) {
      await assert.rejects(billing.checkout({ id: 7, plan, plan_status: 'active' }, user, want), (err) => err.status === 409 && /already paid/.test(err.message));
    }
  });
  assert.equal(none.length, 0);
});

test('the billing page offers "Upgrade for £50" to a Core workspace and the checkout it starts charges £50', async () => {
  const app = await startTestApp({ definition: testDefinition({ plans: ONE_OFF, trialPlan: 'complete' }), env: STRIPE_ENV });
  try {
    const owner = await signUp(app);
    const org = app.db.get('SELECT id FROM orgs ORDER BY id LIMIT 1').id;
    const trial = text(await owner.get('/app/billing'));
    assert.match(trial, /Choose Core/);
    assert.match(trial, /Choose Complete/);
    assert.doesNotMatch(trial, /Upgrade for/);

    app.db.run("UPDATE orgs SET plan = 'core', plan_status = 'active', stripe_customer = 'cus_core' WHERE id = ?", org);
    const core = text(await owner.get('/app/billing'));
    assert.match(core, /Upgrade for £50/);
    assert.match(core, /You have already paid £49 for Core, so upgrading costs just the £50 difference/);
    assert.doesNotMatch(core, /Choose Complete/);
    assert.match(core, /Current plan/);

    const calls = await withStripe(async () => {
      const r = await owner.post('/app/billing/checkout', { plan: 'complete' });
      assert.equal(r.status, 303);
      assert.equal(r.location, 'https://checkout.stripe.com/c/pay/cs_test_1');
      const again = await owner.post('/app/billing/checkout', { plan: 'core' });
      assert.equal(again.status, 409, 'buying the plan it already has is refused');
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].body.get('line_items[0][price_data][unit_amount]'), '5000');

    app.db.run("UPDATE orgs SET plan = 'complete' WHERE id = ?", org);
    const complete = text(await owner.get('/app/billing'));
    assert.match(complete, /Included/);
    assert.doesNotMatch(complete, /Upgrade for/);
    const none = await withStripe(async () => {
      assert.equal((await owner.post('/app/billing/checkout', { plan: 'core' })).status, 409, 'Complete already includes Core');
      assert.equal((await owner.post('/app/billing/checkout', { plan: 'complete' })).status, 409);
    });
    assert.equal(none.length, 0);
  } finally {
    await app.stop();
  }
});

test('a Checkout that has completed but not been paid (a bank debit) activates the plan only once the payment succeeds', async () => {
  const app = await startTestApp({ definition: testDefinition({ plans: ONE_OFF, trialPlan: 'complete' }), env: STRIPE_ENV });
  try {
    await signUp(app);
    const org = app.db.get('SELECT id FROM orgs ORDER BY id LIMIT 1').id;
    app.db.run("UPDATE orgs SET plan = 'core', plan_status = 'active' WHERE id = ?", org);
    const post = async (event) => {
      const body = JSON.stringify(event);
      const ts = Math.floor(Date.now() / 1000);
      const sig = crypto.createHmac('sha256', STRIPE_ENV.STRIPE_WEBHOOK_SECRET).update(`${ts}.${body}`).digest('hex');
      return app.client().request('POST', '/billing/webhook', { body, headers: { 'content-type': 'application/json', 'stripe-signature': `t=${ts},v1=${sig}` } });
    };
    const session = (payment_status) => ({ object: 'checkout.session', mode: 'payment', payment_status, customer: 'cus_up', metadata: { org_id: String(org), plan: 'complete' } });
    const plan = () => app.db.get('SELECT plan, plan_status, stripe_customer FROM orgs WHERE id = ?', org);
    assert.equal((await post({ id: 'evt_1', type: 'checkout.session.completed', data: { object: session('unpaid') } })).status, 200);
    assert.equal(plan().plan, 'core', 'nothing has been paid yet');
    assert.equal((await post({ id: 'evt_2', type: 'checkout.session.async_payment_succeeded', data: { object: session('paid') } })).status, 200);
    assert.deepEqual(plan(), { plan: 'complete', plan_status: 'active', stripe_customer: 'cus_up' });
    // A card payment, paid straight away, still activates on the first event.
    app.db.run("UPDATE orgs SET plan = 'core' WHERE id = ?", org);
    assert.equal((await post({ id: 'evt_3', type: 'checkout.session.completed', data: { object: session('paid') } })).status, 200);
    assert.equal(plan().plan, 'complete');
  } finally {
    await app.stop();
  }
});

/* ------------------------------------------------------------------ invitations and reset links */

test('a member cannot read an invitation link in Activity → Emails and so cannot take the role it offers', async () => {
  const app = await startTestApp();
  try {
    const owner = await signUp(app);
    const invite = async (email, role) => {
      await owner.get('/app/team');
      assert.ok([200, 303].includes((await owner.post('/app/team/invite', { email, role })).status));
      return tokenFromOutbox(app.db, email, 'invite');
    };
    const memberToken = await invite('mia@example.com', 'member');
    const member = app.client();
    await member.get(`/invite/${memberToken}`);
    assert.equal((await member.post(`/invite/${memberToken}`, { name: 'Mia Member', password: 'river-lantern-43' })).status, 303);

    const adminToken = await invite('ada@example.com', 'admin');
    const mail = app.db.get("SELECT id FROM outbox WHERE to_addr = 'ada@example.com'").id;
    const asMember = await member.get(`/app/activity/emails/${mail}`);
    assert.equal(asMember.status, 200);
    assert.doesNotMatch(asMember.text, new RegExp(adminToken), 'the token must not be on the page');
    assert.doesNotMatch(asMember.text, /\/invite\/[A-Za-z0-9_-]{16,}/);
    assert.match(text(asMember), /only shown to workspace admins/);
    assert.match(text(asMember), /invited you to Rhea Trading Ltd/, 'the rest of the email is still readable');
    assert.match(text(await member.get('/app/activity/emails')), /invited you to Rhea Trading Ltd/, 'and it is still listed');

    const asOwner = await owner.get(`/app/activity/emails/${mail}`);
    assert.match(asOwner.text, new RegExp(`/invite/${adminToken}`), 'admins can still copy the link');
    assert.doesNotMatch(text(asOwner), /only shown to workspace admins/);
  } finally {
    await app.stop();
  }
});

test('resetting or changing a password retires every other reset link', async () => {
  const app = await startTestApp();
  try {
    const owner = await signUp(app);
    const links = () => app.db.all("SELECT body_text FROM outbox WHERE to_addr = ? AND related = 'reset' ORDER BY id", OWNER.email).map((m) => m.body_text.match(/\/reset\/([A-Za-z0-9_-]+)/)[1]);
    const anon = app.client();
    for (let i = 0; i < 2; i++) {
      await anon.get('/forgot');
      assert.equal((await anon.post('/forgot', { email: OWNER.email })).status, 200);
    }
    const [older, newer] = links();
    assert.equal((await anon.get(`/reset/${older}`)).status, 200, 'both links work until one is used');
    await anon.get(`/reset/${newer}`);
    assert.equal((await anon.post(`/reset/${newer}`, { password: 'river-lantern-44', confirm: 'river-lantern-44' })).status, 303);
    const late = app.client();
    await late.get('/forgot');
    assert.equal((await late.get(`/reset/${older}`)).status, 410, 'the older link would let someone who read that email take the account back');
    assert.equal((await late.post(`/reset/${older}`, { password: 'river-lantern-45', confirm: 'river-lantern-45' })).status, 410);
    assert.ok(app.services.auth.login(OWNER.email, 'river-lantern-44'));

    // Changing the password from the account page does the same for a link requested earlier.
    const again = app.client();
    await again.get('/login');
    assert.equal((await again.post('/login', { email: OWNER.email, password: 'river-lantern-44' })).status, 303);
    await again.get('/forgot');
    await again.post('/forgot', { email: OWNER.email });
    const pending = links().pop();
    await again.get('/app/account');
    assert.equal((await again.post('/app/account/password', { current: 'river-lantern-44', password: 'river-lantern-46', confirm: 'river-lantern-46' })).status, 303);
    assert.equal((await late.get(`/reset/${pending}`)).status, 410);
  } finally {
    await app.stop();
  }
});

test('an owner whose workspace is read only can still revoke an API key', async () => {
  const app = await startTestApp();
  try {
    const owner = await signUp(app);
    await owner.get('/app/settings');
    const made = await owner.post('/app/settings/api-keys', { name: 'zap' });
    const key = made.text.match(/id="new-key">([^<]+)</)[1];
    assert.equal((await owner.api('GET', '/api/v1/contacts', key)).status, 200);
    app.db.run("UPDATE orgs SET trial_ends = '2026-01-01', plan_status = 'trialing'");
    assert.equal((await owner.api('POST', '/api/v1/contacts', key, { name: 'Nope' })).status, 402);
    assert.equal((await owner.post('/app/settings/api-keys', { name: 'another' })).status, 402, 'new keys are still a change');
    const id = app.db.get('SELECT id FROM api_keys ORDER BY id LIMIT 1').id;
    const revoked = await owner.post(`/app/settings/api-keys/${id}/revoke`);
    assert.equal(revoked.status, 303);
    assert.equal(revoked.location, '/app/settings');
    assert.equal((await owner.api('GET', '/api/v1/contacts', key)).status, 401, 'the key no longer works');
  } finally {
    await app.stop();
  }
});
