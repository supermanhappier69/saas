// Public pages: landing page, pricing, sign up, log in, password reset, invitations, demo, contact, legal pages, robots.txt and the health check.
import { HttpError, isEmail, nowISO, randomToken, mdToHtml } from './util.js';
import { html, raw, button, recordForm, csrfField, attrs, alert } from './ui.js';
import { publicPage, authPage } from './layout.js';
import { ROLE_LABELS } from './auth.js';

const HOUR = 60 * 60 * 1000;
const QUARTER = 15 * 60 * 1000;
const md = (text, headingOffset = 1) => raw(mdToHtml(String(text || ''), { headingOffset }));
const clip = (v, n) => String(v ?? '').trim().slice(0, n);
const trialDays = (def) => def.trialDays ?? 14;
const priceText = (p) => (typeof p.price === 'number' ? (p.price ? `£${p.price}` : 'Free') : p.price || '');
const withStatus = (page, status) => (status === 200 ? page : { status, html: page });
/** True when every paid plan is a one-off payment rather than a monthly subscription. */
export const oneOffOnly = (def) => (def.plans || []).filter((p) => p.price).length > 0 && (def.plans || []).filter((p) => p.price).every((p) => p.oneOff);
export const perText = (p) => (p.oneOff ? ' one-off' : ' / month');

/** Only allow redirects back into the app after logging in. */
export const safeNext = (v) => (typeof v === 'string' && /^\/app(\/|\?|$)/.test(v) && !/[\s\\]/.test(v) ? v : '/app');

function limit(ctx, name, max, windowMs, key = ctx.ip || 'unknown') {
  ctx.services.limiter?.(`${name}:${key}`, max, windowMs);
}

const section = (id, title, body, cls = '') => html`<section${attrs({ id, class: cls ? `section ${cls}` : 'section' })}><div class="container"><h2>${title || ''}</h2>${body}</div></section>`;

export function pricingGrid(def) {
  const plans = (def.plans || []).filter((p) => !p.hidden);
  const cta = def.marketing?.cta || 'Start free trial';
  const card = (p) => html`<div class="${p.featured ? 'plan plan-featured' : 'plan'}">${p.featured ? html`<p class="plan-flag">Most popular</p>` : ''}<h3>${p.name}</h3><p class="plan-price"><span class="amount">${priceText(p)}</span>${
    typeof p.price === 'number' && p.price ? html`<span class="per">${perText(p)}</span>` : ''
  }</p>${p.description ? html`<p class="muted">${p.description}</p>` : ''}${
    p.features?.length ? html`<ul class="ticks">${p.features.map((f) => html`<li>${f}</li>`)}</ul>` : ''
  }<div class="plan-action">${button(cta, { href: '/signup', variant: p.featured ? 'primary' : 'secondary' })}</div></div>`;
  return html`<div class="plans">${plans.map(card)}</div><p class="muted small center">${def.billingNote || 'Prices exclude VAT. Cancel any time.'} Every plan starts with a ${trialDays(def)}-day free trial.</p>`;
}

function faqSection(def) {
  const faq = def.marketing?.faq || [];
  if (!faq.length) return '';
  return section('faq', 'Questions', html`<div class="faq-list">${faq.map((f) => html`<details class="faq"><summary>${f.q}</summary><div class="faq-a prose">${md(f.a)}</div></details>`)}</div>`);
}

function landingPage(ctx) {
  const def = ctx.definition;
  const m = def.marketing || {};
  const cta = m.cta || 'Start free trial';
  const actions = html`<div class="hero-actions">${button(cta, { href: '/signup', variant: 'primary' })}${button('Try the demo', { href: '/demo' })}</div>`;
  const visual = m.heroImage
    ? html`<figure class="hero-shot"><img${attrs({ src: m.heroImage.src, alt: m.heroImage.alt || '', width: m.heroImage.width, height: m.heroImage.height })}></figure>`
    : m.heroPanel || '';
  const hero = html`<section class="hero"><div class="container hero-grid"><div class="hero-copy">${m.eyebrow ? html`<p class="eyebrow">${m.eyebrow}</p>` : ''}<h1>${m.headline || def.tagline}</h1><p class="lead">${
    m.subhead || def.description || ''
  }</p>${actions}<p class="muted small">${m.reassurance || `${trialDays(def)}-day free trial. No card needed.`}</p></div>${visual ? html`<div class="hero-visual">${visual}</div>` : ''}</div></section>`;
  const problem = m.problem
    ? section('problem', m.problem.title, html`${m.problem.intro ? html`<p class="lead">${m.problem.intro}</p>` : ''}<ul class="problem-list">${(m.problem.points || []).map((p) => html`<li>${p}</li>`)}</ul>`)
    : '';
  const features = m.features?.length
    ? section('features', m.featuresTitle || `What ${def.name} does`, html`<div class="feature-grid">${m.features.map(
      (f) => html`<div class="feature">${f.icon ? html`<span class="feature-icon" aria-hidden="true">${f.icon}</span>` : ''}<h3>${f.title}</h3><p>${f.text}</p></div>`,
    )}</div>`, 'alt')
    : '';
  const extra = (m.sections || []).map((s) => section(s.id, s.title, s.body, s.alt ? 'alt' : ''));
  const steps = m.steps?.length
    ? section('how', m.stepsTitle || 'How it works', html`<ol class="steps">${m.steps.map((s) => html`<li><h3>${s.title}</h3><p>${s.text}</p></li>`)}</ol>`)
    : '';
  const pricing = def.plans?.length ? section('pricing', m.pricingTitle || 'Pricing', pricingGrid(def), 'alt') : '';
  const closing = html`<section class="section cta-band"><div class="container"><h2>${m.closing?.title || `Try ${def.name} free for ${trialDays(def)} days`}</h2>${
    m.closing?.text ? html`<p>${m.closing.text}</p>` : ''
  }<div class="hero-actions">${button(cta, { href: '/signup', variant: 'primary' })}${button('Ask a question', { href: '/contact' })}</div></div></section>`;
  return publicPage(def, ctx, { description: m.metaDescription || def.description, body: html`${hero}${problem}${features}${extra}${steps}${pricing}${faqSection(def)}${closing}` });
}

const LEGAL = {
  terms: (def, company, contact) => `Last updated: [date]

These terms cover your use of ${def.name} ("the service"), provided by ${company}, a company registered in England and Wales (company number [number]) with its registered office at [address] ("we", "us").

## Your account
- You must be 18 or over and use the service for your business.
- Keep your password safe. You are responsible for activity under your account and your team's accounts.
- Tell us straight away at ${contact} if you think someone has used your account without permission.

## Free trial and paid plans
- New workspaces get a ${trialDays(def)}-day free trial. We don't take payment during the trial.
${oneOffOnly(def)
    ? `- Paid plans are a one-off payment through our payment provider, Stripe, for continued access to the plan you buy, including updates within that version. Prices exclude VAT, which is added where it applies.
- Refunds: [refund policy to be decided before launch]. Nothing in these terms affects your rights under consumer law where they apply.
- We may change prices for new purchases at any time. A price change never affects a plan you have already paid for.`
    : `- Paid plans are billed monthly in advance through our payment provider, Stripe. Prices exclude VAT, which is added where it applies.
- You can cancel any time from the Billing page. Your plan stays active until the end of the period you have paid for. We don't refund part months unless the law requires it.
- We may change prices with at least 30 days' notice by email. The new price applies from your next billing date after the notice ends.`}

## Your data
- You own the information you put into the service ("your data"). We only use it to provide and support the service, as described in our Privacy Policy.
- You can export your data at any time from Settings.
- If you delete your workspace or your account closes, we delete your data within 30 days, apart from records we must keep by law. Backups are overwritten within a further 30 days.

## Using the service properly
You must not break the law, send messages the recipient hasn't agreed to receive where consent is required, upload malware, try to access other customers' data, or overload, probe or reverse engineer the service.

## Templates, calculations and guidance
The service includes templates, calculators and guidance to help you run your business. They are general information, not legal, tax or financial advice. Check they suit your situation and take professional advice where needed. You are responsible for the messages you send and the decisions you make.

## Availability and changes
We work hard to keep the service running, but we can't promise it will always be available or free of errors. We may improve or change features. If a change significantly reduces what you get, we'll tell you in advance and you may cancel.

## Liability
- Nothing in these terms limits liability that cannot be limited by law, including for death or personal injury caused by negligence, or for fraud.
- We are not liable for loss of profit, revenue, business, goodwill or data, or for indirect losses.
- Otherwise, our total liability in any 12-month period is limited to the amount you paid us in that period.

## Ending these terms
You can stop using the service at any time. We may suspend or close your account if you seriously or repeatedly break these terms or don't pay, after giving you notice where reasonable.

## General
These terms are governed by the law of England and Wales, and the courts of England and Wales have exclusive jurisdiction. If any part is found invalid, the rest still applies.

## Contact
${contact}`,
  privacy: (def, company, contact) => `Last updated: [date]

This policy explains how ${company} ("we", "us") handles personal data in ${def.name}.

## Our two roles
- **Account data:** we are the controller of personal data about you and your team as users of the service, such as names, email addresses, sign-in records and billing details.
- **Data you add:** for information you add about your own customers, contacts or other people, you are the controller and we are your processor. We only process it on your instructions, to provide the service.

## What we collect and why
| Data | Why | Lawful basis |
| --- | --- | --- |
| Name, email, password (stored only as a one-way hash) | To create and secure your account | Contract |
| Sign-in times, IP address, browser | To keep accounts secure and investigate misuse | Legitimate interests |
| Billing details (handled by Stripe) | To take payment | Contract and legal obligation |
| Messages you send us | To reply and support you | Legitimate interests |
| Data you add to the service | To provide the service to you | Contract (as your processor) |

## Who we share it with
We use a small number of suppliers ("sub-processors") to run the service:
- Hosting: [provider and location], for servers and storage.
- Email delivery: [Resend or Postmark], to send the emails you ask the service to send.
- Payments: Stripe, to take subscription payments. We never see or store full card numbers.

We don't sell personal data, and we don't use your data for advertising or to train AI models.

## International transfers
If a supplier processes data outside the UK, we make sure appropriate safeguards are in place, such as the UK International Data Transfer Agreement or the UK Addendum to the EU Standard Contractual Clauses.

## How long we keep it
- Account data: while your account is open, then deleted within 30 days of closure.
- Data you add: until you delete it or close your workspace, then within 30 days.
- Billing records: 6 years, to meet UK tax rules.
- Security logs: up to 12 months.

## Cookies
We only use cookies the service needs to work: one keeps you signed in, one protects forms against forgery and one shows short messages after you save something. We don't use advertising or tracking cookies.

## Your rights
Under UK data protection law you can ask to access, correct, delete or export your personal data, and object to or restrict some processing. Email ${contact} and we'll reply within one month. For data a business has added about you as one of its customers, contact that business directly.

You can also complain to the Information Commissioner's Office (ico.org.uk, 0303 123 1113), though we'd appreciate the chance to put things right first.

## Security
Passwords are stored only as one-way hashes, connections are encrypted and each workspace can only be seen by its members. We'll tell you without undue delay if a breach affects your data.

## Contact
${company}, [registered address]. Email: ${contact}.`,
};

function legalPage(ctx, kind) {
  const def = ctx.definition;
  const title = kind === 'terms' ? 'Terms of service' : 'Privacy policy';
  const text = def.legal?.[kind] || LEGAL[kind](def, def.company || '[Company legal name]', def.contactEmail || '[contact email]');
  const draft = def.legal?.reviewed ? '' : alert('Draft for review. This is general information, not legal advice. A solicitor must review it before launch.', 'yellow');
  return publicPage(def, ctx, { title, narrow: true, body: html`<article class="prose legal"><h1>${title}</h1>${draft}${md(text, 0)}</article>` });
}

const SIGNUP_FIELDS = [
  { key: 'name', label: 'Your name', type: 'text', required: true, autocomplete: 'name' },
  { key: 'email', label: 'Work email', type: 'email', required: true, autocomplete: 'email' },
  { key: 'orgName', label: 'Business name', type: 'text', required: true, autocomplete: 'organization' },
  { key: 'password', label: 'Password', type: 'text', inputType: 'password', required: true, autocomplete: 'new-password', help: 'At least 8 characters.' },
];

function signupPage(ctx, { values = {}, errors = {}, status = 200 } = {}) {
  const def = ctx.definition;
  const body = recordForm(ctx, {
    action: '/signup',
    fields: SIGNUP_FIELDS,
    values: { name: values.name || '', email: values.email || '', orgName: values.orgName || '' },
    errors,
    submit: def.marketing?.cta || 'Start free trial',
    extra: html`<p class="small muted">By creating an account you agree to the <a href="/terms">Terms</a> and <a href="/privacy">Privacy Policy</a>.</p>`,
  });
  return withStatus(authPage(def, ctx, { title: 'Start your free trial', intro: `${trialDays(def)} days free. No card needed. Cancel any time.`, body, footer: html`Already have an account? <a href="/login">Log in</a>` }), status);
}

function welcomeText(def, user, config) {
  return `Hello ${user.name},\n\nWelcome to ${def.name}. Your ${trialDays(def)}-day free trial has started.\n\nSign in any time: ${config.BASE_URL}/login\n\nYour workspace includes some fictional SAMPLE records so you can see how everything works. You can remove them in Settings when you're ready.\n\nIf you have any questions, just reply to this email.\n\n${def.name}`;
}

function loginPage(ctx, { values = {}, errors = {}, status = 200 } = {}) {
  const def = ctx.definition;
  const next = safeNext(values.next || ctx.query.next);
  const body = recordForm(ctx, {
    action: '/login',
    fields: [
      { key: 'email', label: 'Email', type: 'email', required: true, autocomplete: 'email' },
      { key: 'password', label: 'Password', type: 'text', inputType: 'password', required: true, autocomplete: 'current-password' },
    ],
    values: { email: values.email || '' },
    errors,
    submit: 'Log in',
    extra: html`<input type="hidden" name="next" value="${next}"><p class="small"><a href="/forgot">Forgotten your password?</a></p>`,
  });
  return withStatus(authPage(def, ctx, { title: 'Log in', body, footer: html`New to ${def.name}? <a href="/signup">Start a free trial</a>` }), status);
}

function forgotPage(ctx, { values = {}, errors = {}, status = 200 } = {}) {
  const body = recordForm(ctx, { action: '/forgot', fields: [{ key: 'email', label: 'Email', type: 'email', required: true, autocomplete: 'email' }], values, errors, submit: 'Send reset link' });
  return withStatus(authPage(ctx.definition, ctx, { title: 'Reset your password', intro: "Enter your email and we'll send you a link to choose a new password.", body, footer: html`<a href="/login">Back to log in</a>` }), status);
}

function resetPage(ctx, { errors = {}, status = 200 } = {}) {
  const body = recordForm(ctx, {
    action: `/reset/${encodeURIComponent(ctx.params.token)}`,
    fields: [
      { key: 'password', label: 'New password', type: 'text', inputType: 'password', required: true, autocomplete: 'new-password', help: 'At least 8 characters.' },
      { key: 'confirm', label: 'Repeat new password', type: 'text', inputType: 'password', required: true, autocomplete: 'new-password' },
    ],
    values: {},
    errors,
    submit: 'Save new password',
  });
  return withStatus(authPage(ctx.definition, ctx, { title: 'Choose a new password', body }), status);
}

const gonePage = (ctx, title, message, action) => ({ status: 410, html: authPage(ctx.definition, ctx, { title, body: html`<p>${message}</p><p>${action}</p>` }) });
const resetGone = (ctx) => gonePage(ctx, 'Link expired', 'This reset link has expired or has already been used.', button('Request a new link', { href: '/forgot', variant: 'primary' }));
const inviteGone = (ctx) => gonePage(ctx, 'Invitation expired', 'This invitation has expired or has already been used. Ask the person who invited you to send a new one.', button('Go to log in', { href: '/login' }));

function invitePage(ctx, t, { errors = {}, values = {}, status = 200 } = {}) {
  const { auth, db } = ctx.services;
  const def = ctx.definition;
  const org = auth.getOrg(t.org_id);
  const inviter = t.user_id ? auth.getUser(t.user_id) : null;
  const existing = db.get('SELECT id FROM users WHERE email = ?', t.email);
  const fields = existing
    ? [{ key: 'password', label: 'Your password', type: 'text', inputType: 'password', required: true, autocomplete: 'current-password' }]
    : [
      { key: 'name', label: 'Your name', type: 'text', required: true, autocomplete: 'name' },
      { key: 'password', label: 'Choose a password', type: 'text', inputType: 'password', required: true, autocomplete: 'new-password', help: 'At least 8 characters.' },
    ];
  const intro = `${inviter?.name || 'A colleague'} invited you to join ${org?.name || 'a workspace'} on ${def.name} as ${ROLE_LABELS[t.role] || 'Member'}.`;
  const note = existing
    ? html`<p class="small muted">You already have an account as <strong>${t.email}</strong>. Enter its password to join. <a href="/forgot">Forgotten it?</a></p>`
    : html`<p class="small muted">You'll sign in with <strong>${t.email}</strong>. By joining you agree to the <a href="/terms">Terms</a> and <a href="/privacy">Privacy Policy</a>.</p>`;
  const body = recordForm(ctx, { action: `/invite/${encodeURIComponent(ctx.params.token)}`, fields, values: { name: values.name || '' }, errors, submit: 'Join workspace', intro: note });
  return withStatus(authPage(def, ctx, { title: 'Join your team', intro, body }), status);
}

const CONTACT_FIELDS = [
  { key: 'name', label: 'Your name', type: 'text', required: true, autocomplete: 'name' },
  { key: 'email', label: 'Email', type: 'email', required: true, autocomplete: 'email' },
  { key: 'company', label: 'Business name', type: 'text', autocomplete: 'organization' },
  { key: 'message', label: 'How can we help?', type: 'textarea', required: true, rows: 5 },
];

function contactPage(ctx, { values = {}, errors = {}, status = 200 } = {}) {
  const def = ctx.definition;
  const body = recordForm(ctx, {
    action: '/contact',
    fields: CONTACT_FIELDS,
    values,
    errors,
    submit: 'Send message',
    extra: html`<div class="hp" aria-hidden="true"><label for="website">Leave this empty</label><input id="website" name="website" tabindex="-1" autocomplete="off"></div>`,
  });
  const intro = def.marketing?.contactIntro || `Questions about ${def.name}, a walkthrough for your team or help getting set up? Send a message and we'll get back to you by email.`;
  return withStatus(publicPage(def, ctx, { title: 'Contact', narrow: true, body: html`<h1>Contact us</h1><p class="lead">${intro}</p>${body}` }), status);
}

const contactThanks = (ctx) => publicPage(ctx.definition, ctx, {
  title: 'Message sent',
  narrow: true,
  body: html`<h1>Thanks, your message is on its way</h1><p class="lead">We'll reply by email as soon as we can.</p><p>${button('Back to the home page', { href: '/' })}</p>`,
});

export function registerPages(router) {
  router.get('/', (ctx) => (ctx.definition.home ? ctx.definition.home(ctx) : landingPage(ctx)));
  router.get('/pricing', (ctx) => {
    const def = ctx.definition;
    const intro = def.marketing?.pricingIntro || (oneOffOnly(def) ? 'One payment, no subscription. Start with a free trial and choose a plan when you are ready.' : 'Simple monthly plans. Start with a free trial and choose a plan when you are ready.');
    return publicPage(def, ctx, { title: 'Pricing', body: html`<section class="section"><div class="container"><h1>Pricing</h1><p class="lead">${intro}</p>${pricingGrid(def)}</div></section>${faqSection(def)}` });
  });
  router.get('/terms', (ctx) => legalPage(ctx, 'terms'));
  router.get('/privacy', (ctx) => legalPage(ctx, 'privacy'));
  router.get('/healthz', (ctx) => {
    ctx.services.db.get('SELECT 1 AS ok');
    return { json: { ok: true, product: ctx.definition.slug, time: nowISO() } };
  }, { public: true, api: true });
  router.get('/robots.txt', (ctx) => ({
    body: ctx.services.config?.ALLOW_INDEXING ? 'User-agent: *\nDisallow: /app/\nDisallow: /api/\nDisallow: /invite/\nDisallow: /reset/\n' : 'User-agent: *\nDisallow: /\n',
    type: 'text/plain; charset=utf-8',
  }), { public: true });

  router.get('/signup', (ctx) => (ctx.user ? { redirect: '/app' } : signupPage(ctx)));
  router.post('/signup', async (ctx) => {
    limit(ctx, 'signup', 10, HOUR);
    const { auth, mailer, config } = ctx.services;
    const def = ctx.definition;
    let result;
    try {
      result = auth.signup({ name: ctx.body.name, email: ctx.body.email, password: String(ctx.body.password || ''), orgName: ctx.body.orgName });
    } catch (err) {
      if (err instanceof HttpError && err.status < 500) return signupPage(ctx, { values: ctx.body, errors: err.details?.fieldErrors || { _form: err.message }, status: err.status === 409 ? 409 : 422 });
      throw err;
    }
    const { user, org } = result;
    auth.startSession(ctx.req, ctx.res, user.id, org.id);
    const welcome = def.welcomeEmail ? def.welcomeEmail({ user, org, config }) : null;
    await mailer.send({
      orgId: org.id,
      to: user.email,
      replyTo: config.SUPPORT_EMAIL || def.contactEmail || null,
      subject: welcome?.subject || `Welcome to ${def.name}`,
      text: welcome?.text || welcomeText(def, user, config),
      related: 'welcome',
      dedupeKey: `welcome:${user.id}`,
    });
    return { redirect: '/app', flash: `Welcome to ${def.name}! Your ${trialDays(def)}-day free trial has started.` };
  });

  router.get('/login', (ctx) => (ctx.user ? { redirect: safeNext(ctx.query.next) } : loginPage(ctx)));
  router.post('/login', (ctx) => {
    const { auth, db } = ctx.services;
    const email = clip(ctx.body.email, 200).toLowerCase();
    limit(ctx, 'login', 30, QUARTER);
    limit(ctx, 'login-email', 10, QUARTER, email);
    const user = auth.login(email, String(ctx.body.password || ''));
    if (!user) return loginPage(ctx, { values: { email, next: ctx.body.next }, errors: { _form: "That email and password don't match an account." }, status: 401 });
    let orgId = auth.defaultOrgFor(user.id);
    if (!orgId) {
      orgId = db.tx(() => {
        const org = auth.createOrg(`${user.name}'s workspace`);
        db.run("INSERT INTO memberships (org_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)", org.id, user.id, nowISO());
        return org.id;
      });
    }
    auth.startSession(ctx.req, ctx.res, user.id, orgId);
    return { redirect: safeNext(ctx.body.next) };
  });
  router.post('/logout', (ctx) => {
    ctx.services.auth.endSession(ctx.cookies, ctx.res);
    return { redirect: '/', flash: 'You have been signed out.' };
  });

  router.get('/forgot', (ctx) => forgotPage(ctx));
  router.post('/forgot', (ctx) => {
    limit(ctx, 'forgot', 5, QUARTER);
    const { auth, mailer, config } = ctx.services;
    const def = ctx.definition;
    const email = clip(ctx.body.email, 200).toLowerCase();
    if (!isEmail(email)) return forgotPage(ctx, { values: { email }, errors: { email: 'Enter a valid email address.' }, status: 422 });
    const r = auth.requestReset(email);
    if (r) {
      const link = `${config.BASE_URL}/reset/${r.token}`;
      mailer.send({
        to: r.user.email,
        subject: `Reset your ${def.name} password`,
        text: `Hello ${r.user.name},\n\nUse this link to choose a new password:\n${link}\n\nThe link works for 1 hour and can only be used once. If you didn't ask for this, you can ignore this email and your password won't change.\n\n${def.name}`,
        related: 'reset',
      }).catch(() => {});
    }
    return authPage(def, ctx, {
      title: 'Check your email',
      body: html`<p>If there's an account for <strong>${email}</strong>, we've sent a link to reset your password. It works for 1 hour.</p><p class="muted small">Nothing arrived? Check your spam folder or <a href="/forgot">try again</a>.</p>`,
      footer: html`<a href="/login">Back to log in</a>`,
    });
  });
  router.get('/reset/:token', (ctx) => (ctx.services.auth.findToken('reset', ctx.params.token) ? resetPage(ctx) : resetGone(ctx)));
  router.post('/reset/:token', (ctx) => {
    limit(ctx, 'reset', 10, QUARTER);
    const { auth } = ctx.services;
    if (!auth.findToken('reset', ctx.params.token)) return resetGone(ctx);
    const password = String(ctx.body.password || '');
    if (password !== String(ctx.body.confirm || '')) return resetPage(ctx, { errors: { confirm: 'The passwords do not match.' }, status: 422 });
    let user;
    try {
      user = auth.resetPassword(ctx.params.token, password);
    } catch (err) {
      if (err instanceof HttpError && err.status === 410) return resetGone(ctx);
      if (err instanceof HttpError && err.status < 500) return resetPage(ctx, { errors: err.details?.fieldErrors || { _form: err.message }, status: 422 });
      throw err;
    }
    const orgId = auth.defaultOrgFor(user.id);
    if (!orgId) return { redirect: '/login', flash: 'Password updated. Log in with your new password.' };
    auth.startSession(ctx.req, ctx.res, user.id, orgId);
    return { redirect: '/app', flash: 'Password updated. You are now signed in.' };
  });

  router.get('/invite/:token', (ctx) => {
    const t = ctx.services.auth.findToken('invite', ctx.params.token);
    return t ? invitePage(ctx, t) : inviteGone(ctx);
  });
  router.post('/invite/:token', (ctx) => {
    limit(ctx, 'invite', 20, QUARTER);
    const { auth } = ctx.services;
    const t = auth.findToken('invite', ctx.params.token);
    if (!t) return inviteGone(ctx);
    let result;
    try {
      result = auth.acceptInvite(ctx.params.token, { name: ctx.body.name, password: String(ctx.body.password || '') });
    } catch (err) {
      if (err instanceof HttpError && err.status === 410) return inviteGone(ctx);
      if (err instanceof HttpError && err.status < 500) return invitePage(ctx, t, { errors: err.details?.fieldErrors || { _form: err.message }, values: ctx.body, status: err.status === 401 ? 401 : 422 });
      throw err;
    }
    auth.startSession(ctx.req, ctx.res, result.user.id, result.org.id);
    return { redirect: '/app', flash: `Welcome to ${result.org.name}.` };
  });

  router.get('/demo', (ctx) => {
    const def = ctx.definition;
    const intro = def.marketing?.demoIntro || 'Open a private demo workspace filled with fictional SAMPLE records. Click around, change things and try every feature.';
    return publicPage(def, ctx, {
      title: 'Demo',
      narrow: true,
      body: html`<h1>Try ${def.name} with sample data</h1><p class="lead">${intro}</p><ul class="ticks"><li>No sign-up or card needed</li><li>Emails are never actually sent from the demo</li><li>The demo workspace is deleted automatically after ${def.demoDays ?? 2} days</li></ul><form method="post" action="/demo">${csrfField(ctx)}${button('Open the demo', { variant: 'primary' })}</form>`,
    });
  });
  router.post('/demo', (ctx) => {
    limit(ctx, 'demo', 10, HOUR);
    const { auth } = ctx.services;
    const def = ctx.definition;
    const id = randomToken(9).toLowerCase().replace(/[^a-z0-9]/g, '') || String(Date.now());
    const { user, org } = auth.signup({ name: 'Demo visitor', email: `demo-${id}@demo.invalid`, password: randomToken(18), orgName: def.demoOrgName || `${def.name} demo` }, { isDemo: true });
    auth.startSession(ctx.req, ctx.res, user.id, org.id);
    return { redirect: '/app', flash: 'Welcome to the demo. Everything here is fictional sample data.' };
  });

  router.get('/contact', (ctx) => contactPage(ctx, { values: ctx.user ? { name: ctx.user.name, email: ctx.user.email, company: ctx.org?.name } : {} }));
  router.post('/contact', (ctx) => {
    limit(ctx, 'contact', 5, HOUR);
    if (ctx.body.website) return contactThanks(ctx);
    const { db, mailer, config } = ctx.services;
    const def = ctx.definition;
    const v = { name: clip(ctx.body.name, 120), email: clip(ctx.body.email, 200).toLowerCase(), company: clip(ctx.body.company, 160), message: clip(ctx.body.message, 4000) };
    const errors = {};
    if (!v.name) errors.name = 'Enter your name.';
    if (!isEmail(v.email)) errors.email = 'Enter a valid email address.';
    if (!v.message) errors.message = 'Enter a message.';
    if (Object.keys(errors).length) return contactPage(ctx, { values: v, errors, status: 422 });
    db.run(
      'INSERT INTO leads (org_id, kind, name, email, company, message, data, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ctx.org?.id ?? null, 'contact', v.name, v.email, v.company, v.message, JSON.stringify({ product: def.slug, page: 'contact' }), 'new', nowISO(),
    );
    const to = config.CONTACT_TO || def.contactEmail;
    if (to) {
      mailer.send({ to, replyTo: v.email, subject: `New ${def.name} enquiry from ${v.name}`, text: `${v.name} <${v.email}>${v.company ? `\n${v.company}` : ''}\n\n${v.message}`, related: 'lead' }).catch(() => {});
    }
    return contactThanks(ctx);
  });
}
