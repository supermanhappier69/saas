// Billing and activity pages: plans, usage, Stripe checkout and portal, test billing, webhooks, the audit log and sent emails.
import { HttpError, fmtDateUK } from './util.js';
import { html, postButton, pageHeader, card, table, alert, badge, tabs, pagination, urlWith, progress } from './ui.js';
import { appPage } from './layout.js';
import { requireRole, can, fmtWhen } from './crud.js';

const priceText = (p) => (typeof p.price === 'number' ? (p.price ? `£${p.price}` : 'Free') : p.price || '');
const PAGE_SIZE = 50;
const EMAIL_STATUS = {
  sent: ['Sent', 'green'],
  logged: ['Not sent: email not set up', 'gray'],
  failed: ['Failed', 'red'],
  missing: ['No address', 'orange'],
  queued: ['Queued', 'blue'],
};
const emailStatus = (m) => (m.provider === 'demo' ? ['Not sent: demo workspace', 'gray'] : EMAIL_STATUS[m.status] || [m.status, 'gray']);

function usageCard(ctx) {
  const { billing, resources, db } = ctx.services;
  const plan = billing.effectivePlan(ctx.org);
  const limits = plan?.limits || {};
  const items = resources.all.filter((r) => r.limitKey).map((r) => ({
    label: r.label,
    used: db.get(`SELECT COUNT(*) AS n FROM "${r.table}" WHERE org_id = ? AND is_sample = 0`, ctx.org.id).n,
    max: limits[r.limitKey],
  }));
  items.push({ label: 'Team members', used: db.get('SELECT COUNT(*) AS n FROM memberships WHERE org_id = ?', ctx.org.id).n, max: limits.seats });
  const row = (u) => {
    const capped = typeof u.max === 'number' && Number.isFinite(u.max);
    return html`<li><span class="usage-label">${u.label}</span>${
      capped ? html`${progress(u.used, u.max, `${u.label}: ${u.used} of ${u.max}`)} <span class="small">${u.used} of ${u.max}</span>` : html`<span class="muted small">${u.used} · no limit</span>`
    }</li>`;
  };
  return card({ title: plan ? `Usage on the ${plan.name} plan` : 'Usage', body: html`<ul class="usage">${items.map(row)}</ul><p class="help">Sample records don't count towards limits.</p>` });
}

function planAction(ctx, p) {
  const { billing, config } = ctx.services;
  const org = ctx.org;
  if (org.plan_status === 'active' && org.plan === p.id) return badge('Current plan', 'green');
  if (org.is_demo) return html`<p class="muted small">Plans can't be changed in the demo.</p>`;
  if (!can(ctx, 'owner')) return html`<p class="muted small">Only the workspace owner can change plans.</p>`;
  if (!p.price) return '';
  if (billing.enabled && billing.priceId(p)) return postButton(ctx, '/app/billing/checkout', `Choose ${p.name}`, { variant: 'primary', fields: { plan: p.id } });
  if (config.ALLOW_FAKE_BILLING) return postButton(ctx, '/app/billing/simulate', `Activate ${p.name} (test mode)`, { fields: { plan: p.id } });
  return html`<p class="muted small">Online payment isn't switched on yet. <a href="/contact">Contact us</a> to subscribe.</p>`;
}

function billingPage(ctx) {
  const { billing, config } = ctx.services;
  const org = ctx.org;
  const access = billing.access(org);
  const current = billing.planFor(org);
  const notice = ctx.query.checkout === 'success'
    ? alert('Thanks, your payment went through. It can take a few seconds for your plan to update here.', 'green', 'Payment received.')
    : ctx.query.checkout === 'cancelled' ? alert('Checkout was cancelled. You have not been charged.', 'orange') : '';
  let summary = '';
  if (org.is_demo) summary = 'This is a demo workspace, so billing is switched off.';
  else if (org.plan_status === 'active') summary = html`You're on the <strong>${current?.name || 'paid'}</strong> plan.`;
  else if (access.trial) summary = html`Your free trial ends on <strong>${fmtDateUK(org.trial_ends)}</strong>. Choose a plan any time; you won't lose anything you've added.`;
  const manage = org.stripe_customer && billing.enabled && can(ctx, 'owner') ? postButton(ctx, '/app/billing/portal', 'Manage billing and invoices', { size: 'sm' }) : '';
  const status = card({
    title: 'Your plan',
    body: html`<p class="plan-status">${badge(access.label, access.tone)} ${summary}</p>${access.warning ? alert(access.warning, access.readOnly ? 'red' : 'orange') : ''}${manage}`,
  });
  const plans = billing.plans.filter((p) => !p.hidden).map((p) => {
    const isCurrent = org.plan_status === 'active' && org.plan === p.id;
    return html`<div class="${isCurrent ? 'plan plan-current' : 'plan'}"><h3>${p.name}</h3><p class="plan-price"><span class="amount">${priceText(p)}</span>${
      typeof p.price === 'number' && p.price ? html`<span class="per"> / month</span>` : ''
    }</p>${p.description ? html`<p class="muted">${p.description}</p>` : ''}${
      p.features?.length ? html`<ul class="ticks">${p.features.map((f) => html`<li>${f}</li>`)}</ul>` : ''
    }<div class="plan-action">${planAction(ctx, p)}</div></div>`;
  });
  const testNote = !billing.enabled && config.ALLOW_FAKE_BILLING
    ? alert('Test billing is on, so plans switch without payment. Remove ALLOW_FAKE_BILLING before going live.', 'yellow', 'Test mode.') : '';
  return appPage(ctx, {
    title: 'Billing',
    active: 'billing',
    body: html`${pageHeader({ title: 'Billing', subtitle: ctx.definition.billingNote || 'Monthly plans. Cancel any time.' })}${notice}${testNote}${status}<div class="plans">${plans}</div>${usageCard(ctx)}`,
  });
}

function activityTabs(ctx, active) {
  const items = [{ id: 'log', label: 'Activity', href: '/app/activity' }];
  if (can(ctx, 'member')) items.push({ id: 'emails', label: 'Emails', href: '/app/activity/emails' });
  return tabs(items, active);
}

function paging(ctx, total) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(Math.max(1, Number(ctx.query.page) || 1), pages);
  return { page, pages, offset: (page - 1) * PAGE_SIZE };
}

function activityPage(ctx) {
  const { db, config, resources } = ctx.services;
  const tz = config?.TIMEZONE;
  const total = db.get('SELECT COUNT(*) AS n FROM audit WHERE org_id = ?', ctx.org.id).n;
  const { page, pages, offset } = paging(ctx, total);
  const rows = db.all('SELECT a.*, u.name AS who FROM audit a LEFT JOIN users u ON u.id = a.user_id WHERE a.org_id = ? ORDER BY a.id DESC LIMIT ? OFFSET ?', ctx.org.id, PAGE_SIZE, offset);
  const what = (a) => (a.resource && a.record_id && a.action !== 'delete' && resources.has(a.resource) ? html`<a href="/app/${a.resource}/${a.record_id}">${a.summary}</a>` : a.summary);
  const list = table({
    columns: [
      { key: 'created_at', label: 'When', render: (a) => fmtWhen(a.created_at, tz) },
      { key: 'who', label: 'Who', render: (a) => a.who || html`<span class="muted">System</span>` },
      { key: 'summary', label: 'What happened', render: what },
    ],
    rows,
    empty: html`<p class="muted">Nothing has happened yet.</p>`,
  });
  return appPage(ctx, {
    title: 'Activity',
    active: 'activity',
    body: html`${pageHeader({ title: 'Activity', subtitle: 'Everything added, changed or deleted in this workspace.' })}${activityTabs(ctx, 'log')}${card({ body: html`${list}${pagination({ page, pages, total, url: (p) => urlWith('/app/activity', { page: p }) })}` })}`,
  });
}

function emailsPage(ctx) {
  requireRole(ctx, 'member');
  const { db, config } = ctx.services;
  const tz = config?.TIMEZONE;
  const total = db.get('SELECT COUNT(*) AS n FROM outbox WHERE org_id = ?', ctx.org.id).n;
  const { page, pages, offset } = paging(ctx, total);
  const rows = db.all('SELECT id, to_addr, subject, status, provider, error, created_at FROM outbox WHERE org_id = ? ORDER BY id DESC LIMIT ? OFFSET ?', ctx.org.id, PAGE_SIZE, offset);
  const list = table({
    columns: [
      { key: 'created_at', label: 'When', render: (m) => fmtWhen(m.created_at, tz) },
      { key: 'to_addr', label: 'To', render: (m) => m.to_addr || '—' },
      { key: 'subject', label: 'Subject', render: (m) => html`<a href="/app/activity/emails/${m.id}">${m.subject || '(no subject)'}</a>` },
      { key: 'status', label: 'Status', render: (m) => badge(...emailStatus(m)) },
    ],
    rows,
    empty: html`<p class="muted">No emails yet.</p>`,
  });
  const note = ctx.services.mailer?.provider === 'log'
    ? alert('Email delivery is not set up, so emails are saved here instead of being sent. Add RESEND_API_KEY or POSTMARK_TOKEN to send them.', 'blue') : '';
  return appPage(ctx, {
    title: 'Emails',
    active: 'activity',
    body: html`${pageHeader({ title: 'Activity', subtitle: 'Emails sent from this workspace.' })}${activityTabs(ctx, 'emails')}${note}${card({ body: html`${list}${pagination({ page, pages, total, url: (p) => urlWith('/app/activity/emails', { page: p }) })}` })}`,
  });
}

function emailPage(ctx) {
  requireRole(ctx, 'member');
  const { db, config } = ctx.services;
  const tz = config?.TIMEZONE;
  const m = db.get('SELECT * FROM outbox WHERE org_id = ? AND id = ?', ctx.org.id, Number(ctx.params.id));
  if (!m) throw new HttpError(404, 'Email not found');
  const [label, tone] = emailStatus(m);
  const meta = [
    ['To', m.to_addr], ['Cc', m.cc], ['Reply-to', m.reply_to], ['Subject', m.subject],
    ['Created', fmtWhen(m.created_at, tz)], ['Sent', m.sent_at ? fmtWhen(m.sent_at, tz) : null], ['Error', m.error],
  ].filter(([, v]) => v);
  const body = html`<dl class="details">${meta.map(([k, v]) => html`<div class="detail"><dt>${k}</dt><dd>${v}</dd></div>`)}<div class="detail"><dt>Status</dt><dd>${badge(label, tone)}</dd></div></dl><pre class="email-body">${m.body_text || ''}</pre>`;
  return appPage(ctx, {
    title: m.subject || 'Email',
    active: 'activity',
    body: html`${pageHeader({ title: m.subject || 'Email', crumbs: [{ label: 'Activity', href: '/app/activity' }, { label: 'Emails', href: '/app/activity/emails' }, { label: 'Email' }] })}${card({ body })}`,
  });
}

export function registerBilling(router) {
  router.get('/app/billing', billingPage);
  router.post('/app/billing/checkout', async (ctx) => {
    requireRole(ctx, 'owner');
    if (ctx.org.is_demo) throw new HttpError(403, 'Billing is switched off in the demo workspace.');
    return { redirect: await ctx.services.billing.checkout(ctx.org, ctx.user, String(ctx.body.plan || '')) };
  });
  router.post('/app/billing/portal', async (ctx) => {
    requireRole(ctx, 'owner');
    return { redirect: await ctx.services.billing.portal(ctx.org) };
  });
  router.post('/app/billing/simulate', (ctx) => {
    requireRole(ctx, 'owner');
    if (ctx.org.is_demo) throw new HttpError(403, 'Billing is switched off in the demo workspace.');
    const plan = ctx.services.billing.planById(String(ctx.body.plan || ''));
    ctx.services.billing.simulate(ctx.org, plan?.id);
    ctx.audit?.('billing', null, null, `Plan set to ${plan.name} (test billing)`);
    return { redirect: '/app/billing', flash: `${plan.name} plan activated in test mode.` };
  });
  router.post('/billing/webhook', (ctx) => {
    const { billing } = ctx.services;
    const event = billing.verifyWebhook(ctx.rawBody, ctx.req.headers['stripe-signature']);
    return { json: { received: true, ...(billing.applyEvent(event) || {}) } };
  }, { raw: true, public: true, api: true });
  router.get('/app/activity', activityPage);
  router.get('/app/activity/emails', emailsPage);
  router.get('/app/activity/emails/:id', emailPage);
}
