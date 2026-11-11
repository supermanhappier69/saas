// One-off plans: Stripe Checkout takes a single payment instead of starting a subscription.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBilling } from '../core/billing.js';

const definition = {
  plans: [
    { id: 'core', name: 'Core', price: 49, oneOff: true },
    { id: 'pro', name: 'Pro', price: 19 },
  ],
};
const config = { STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_PRICE_CORE: 'price_core', STRIPE_PRICE_PRO: 'price_pro', BASE_URL: 'https://app.example.com' };

async function checkoutBody(planId) {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, body: new URLSearchParams(init.body) });
    return new Response(JSON.stringify({ url: 'https://checkout.stripe.com/c/pay/x' }), { status: 200 });
  };
  try {
    const billing = createBilling({ db: null, config, definition });
    const url = await billing.checkout({ id: 7, stripe_customer: null }, { email: 'a@example.com' }, planId);
    assert.equal(url, 'https://checkout.stripe.com/c/pay/x');
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(calls.length, 1);
  return calls[0].body;
}

test('one-off plans use a payment checkout with a receipt invoice', async () => {
  const body = await checkoutBody('core');
  assert.equal(body.get('mode'), 'payment');
  assert.equal(body.get('line_items[0][price]'), 'price_core');
  assert.equal(body.get('metadata[plan]'), 'core');
  assert.equal(body.get('customer_creation'), 'always');
  assert.equal(body.get('invoice_creation[enabled]'), 'true');
  assert.equal(body.get('subscription_data[metadata][plan]'), null);
});

test('monthly plans still start a subscription', async () => {
  const body = await checkoutBody('pro');
  assert.equal(body.get('mode'), 'subscription');
  assert.equal(body.get('subscription_data[metadata][plan]'), 'pro');
  assert.equal(body.get('invoice_creation[enabled]'), null);
});
