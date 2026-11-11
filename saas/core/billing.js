// Plans, trials, limits and Stripe billing (Checkout, customer portal, signed webhooks).
import crypto from 'node:crypto';
import { HttpError, nowISO, todayISO, daysBetween } from './util.js';

const STRIPE_API = ['https:', '', 'api.stripe.com', 'v1', ''].join('/');

export function formEncode(obj, prefix = '', out = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') formEncode(v, key, out);
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  }
  return out.join('&');
}

const STATUS_MAP = {
  active: 'active', trialing: 'active', past_due: 'past_due', unpaid: 'past_due', incomplete: 'past_due',
  canceled: 'canceled', incomplete_expired: 'canceled', paused: 'canceled',
};

export function createBilling({ db, config, definition }) {
  const plans = definition.plans || [];
  const enabled = Boolean(config.STRIPE_SECRET_KEY);
  const priceId = (plan) => config[`STRIPE_PRICE_${plan.id.toUpperCase()}`] || null;
  const planById = (id) => plans.find((p) => p.id === id) || null;
  const planFor = (org) => planById(org.plan) || planById(definition.trialPlan) || plans[0];
  const effectivePlan = (org) => (org.plan_status === 'trialing' || org.is_demo ? planById(definition.trialPlan) || planFor(org) : planFor(org));

  function access(org) {
    const today = todayISO();
    if (org.is_demo) return { ok: true, readOnly: false, label: 'Demo workspace', tone: 'blue' };
    if (org.plan_status === 'active') return { ok: true, readOnly: false, label: `${planFor(org)?.name || 'Paid'} plan`, tone: 'green' };
    if (org.plan_status === 'past_due') return { ok: true, readOnly: false, label: 'Payment overdue', tone: 'orange', warning: 'Your last payment failed. Update your card in Billing to keep access.' };
    if (org.plan_status === 'trialing' && org.trial_ends && org.trial_ends >= today) {
      const left = daysBetween(today, org.trial_ends);
      return { ok: true, readOnly: false, trial: true, daysLeft: left, label: `Trial: ${left} day${left === 1 ? '' : 's'} left`, tone: left <= 3 ? 'orange' : 'blue' };
    }
    return {
      ok: false, readOnly: true, tone: 'red',
      label: org.plan_status === 'canceled' ? 'Subscription ended' : 'Trial ended',
      warning: 'Your workspace is read-only. Choose a plan to keep adding and changing records. Your data is safe and you can still export it.',
    };
  }

  const limit = (org, key) => effectivePlan(org)?.limits?.[key] ?? Infinity;
  const can = (org, flag) => Boolean(effectivePlan(org)?.flags?.[flag]);

  async function stripe(path, params) {
    if (!enabled) throw new HttpError(503, 'Online payments are not set up yet.');
    const res = await fetch(STRIPE_API + path, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formEncode(params),
      signal: AbortSignal.timeout(20000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new HttpError(502, body.error?.message || `Stripe error ${res.status}`);
    return body;
  }

  async function checkout(org, user, planId) {
    const plan = planById(planId);
    if (!plan || !plan.price) throw new HttpError(400, 'Choose a paid plan.');
    const price = priceId(plan);
    if (!price) throw new HttpError(503, `Online payments for this plan are not set up yet (missing STRIPE_PRICE_${plan.id.toUpperCase()}).`);
    const session = await stripe('checkout/sessions', {
      mode: 'subscription',
      line_items: [{ price, quantity: 1 }],
      success_url: `${config.BASE_URL}/app/billing?checkout=success`,
      cancel_url: `${config.BASE_URL}/app/billing?checkout=cancelled`,
      client_reference_id: String(org.id),
      customer: org.stripe_customer || undefined,
      customer_email: org.stripe_customer ? undefined : user.email,
      allow_promotion_codes: 'true',
      metadata: { org_id: String(org.id), plan: plan.id },
      subscription_data: { metadata: { org_id: String(org.id), plan: plan.id } },
    });
    return session.url;
  }

  async function portal(org) {
    if (!org.stripe_customer) throw new HttpError(400, 'There is no billing account yet. Choose a plan first.');
    const s = await stripe('billing_portal/sessions', { customer: org.stripe_customer, return_url: `${config.BASE_URL}/app/billing` });
    return s.url;
  }

  /** Verifies a Stripe-Signature header (HMAC-SHA256 of "t.payload") and returns the parsed event. */
  function verifyWebhook(rawBody, header, { tolerance = 300, now = Math.floor(Date.now() / 1000) } = {}) {
    const secret = config.STRIPE_WEBHOOK_SECRET;
    if (!secret) throw new HttpError(503, 'Webhook secret not configured');
    let t = null;
    const sigs = [];
    for (const item of String(header || '').split(',')) {
      const i = item.indexOf('=');
      if (i < 0) continue;
      const k = item.slice(0, i).trim();
      const v = item.slice(i + 1).trim();
      if (k === 't') t = Number(v);
      else if (k === 'v1' && v) sigs.push(v);
    }
    if (!t || !sigs.length) throw new HttpError(400, 'Invalid signature header');
    if (Math.abs(now - t) > tolerance) throw new HttpError(400, 'Signature timestamp outside tolerance');
    const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody.toString('utf8')}`).digest('hex');
    const ok = sigs.some((s) => s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
    if (!ok) throw new HttpError(400, 'Signature mismatch');
    return JSON.parse(rawBody.toString('utf8'));
  }

  const planFromPrice = (pid) => plans.find((p) => priceId(p) && priceId(p) === pid)?.id || null;

  function applyEvent(event) {
    if (!event?.id || !event.type) throw new HttpError(400, 'Invalid event');
    if (db.get('SELECT id FROM billing_events WHERE event_id = ?', event.id)) return { duplicate: true };
    const obj = event.data?.object || {};
    let orgId = null;
    const findOrg = () => {
      const meta = Number(obj.metadata?.org_id || obj.client_reference_id);
      if (meta && db.get('SELECT id FROM orgs WHERE id = ?', meta)) return meta;
      const sub = obj.object === 'subscription' ? obj.id : obj.subscription;
      const bySub = sub && db.get('SELECT id FROM orgs WHERE stripe_subscription = ?', sub);
      if (bySub) return bySub.id;
      const byCust = obj.customer && db.get('SELECT id FROM orgs WHERE stripe_customer = ?', obj.customer);
      return byCust ? byCust.id : null;
    };
    db.tx(() => {
      orgId = findOrg();
      if (orgId) {
        switch (event.type) {
          case 'checkout.session.completed':
            db.run("UPDATE orgs SET plan = COALESCE(?, plan), plan_status = 'active', stripe_customer = COALESCE(?, stripe_customer), stripe_subscription = COALESCE(?, stripe_subscription) WHERE id = ?",
              planById(obj.metadata?.plan) ? obj.metadata.plan : null, obj.customer || null, obj.subscription || null, orgId);
            break;
          case 'customer.subscription.created':
          case 'customer.subscription.updated': {
            const plan = planFromPrice(obj.items?.data?.[0]?.price?.id) || (planById(obj.metadata?.plan) ? obj.metadata.plan : null);
            db.run('UPDATE orgs SET plan = COALESCE(?, plan), plan_status = ?, stripe_subscription = ?, stripe_customer = COALESCE(?, stripe_customer) WHERE id = ?',
              plan, STATUS_MAP[obj.status] || 'past_due', obj.id, obj.customer || null, orgId);
            break;
          }
          case 'customer.subscription.deleted':
            db.run("UPDATE orgs SET plan_status = 'canceled' WHERE id = ?", orgId);
            break;
          case 'invoice.payment_failed':
            db.run("UPDATE orgs SET plan_status = 'past_due' WHERE id = ?", orgId);
            break;
          case 'invoice.paid':
            db.run("UPDATE orgs SET plan_status = 'active' WHERE id = ? AND plan_status = 'past_due'", orgId);
            break;
          default:
            break;
        }
      }
      db.run('INSERT INTO billing_events (org_id, event_id, type, payload, created_at) VALUES (?, ?, ?, ?, ?)', orgId, event.id, event.type, JSON.stringify(event).slice(0, 20000), nowISO());
    });
    return { orgId, type: event.type };
  }

  /** Development and demo only: switch plan without a payment. Requires ALLOW_FAKE_BILLING=1. */
  function simulate(org, planId) {
    if (!config.ALLOW_FAKE_BILLING) throw new HttpError(403, 'Test billing is turned off.');
    if (!planById(planId)) throw new HttpError(400, 'Unknown plan');
    db.run("UPDATE orgs SET plan = ?, plan_status = 'active' WHERE id = ?", planId, org.id);
  }

  return { plans, enabled, planById, planFor, effectivePlan, access, limit, can, checkout, portal, verifyWebhook, applyEvent, simulate, priceId };
}
