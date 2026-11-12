// Free public pages: the templates and payment terms shown in full as lead magnets, each ending with the same offer.
import { mdToHtml } from '../../../core/util.js';
import { html, raw, card, button } from '../../../core/ui.js';
import { publicPage } from '../../../core/layout.js';
import { DEFAULT_TEMPLATES } from '../lib/templates.js';
import { policy, SOURCES, DISCLAIMER } from '../lib/docs.js';

const md = (text) => raw(`<div class="prose">${mdToHtml(text, { headingOffset: 1 })}</div>`);

export function offerBox(def, { title = 'Knowing the wording is the easy part', text = null } = {}) {
  return html`<div class="cta-box"><h2>${title}</h2><p>${text || `${def.name} fills these in with the right figures and dates for every invoice, tells you what to send next, sends and logs it, and works out the statutory interest and compensation you can add. One price, no subscription.`}</p><p>${button('Try the demo', { href: '/demo', variant: 'primary' })} ${button('Free interest calculator', { href: '/calculator' })} ${button('Join the waitlist', { href: '/waitlist', variant: 'ghost' })}</p></div>`;
}

const PAGES = {
  'payment-reminder-templates': {
    title: 'Free payment reminder email templates (UK)',
    description: 'Four free UK payment reminder emails, from a pre-due nudge to a final notice, plus a phone script. Copy, fill in the brackets and send.',
    intro: 'The reminders that get invoices paid are polite, specific and escalate on a schedule. These are the four we use, in the order to send them, plus the phone script for the call that resolves more than a fourth email.',
    codes: ['0', '1', '2', 'call', '3'],
  },
  'letter-before-action': {
    title: 'Free letter before action template (UK, unpaid invoice)',
    description: 'A free UK letter before action for an unpaid business invoice, with the statutory interest and fixed compensation table and the Pre-Action Protocol notes for sole traders.',
    intro: 'A letter before action is the last step before court. It sets out the debt, the interest and compensation claimed, a clear deadline, and what happens next. For limited companies and LLPs a reasonable deadline is usually 14 days; if the customer is an individual or sole trader the Pre-Action Protocol for Debt Claims applies and you must enclose its Information Sheet and Reply Form and allow 30 days.',
    codes: ['4', '5'],
    after: html`<div class="prose"><h2>Before you send it</h2><ul><li>Check the invoice is correct, was received, and is not in dispute. Chase the undisputed part of a disputed invoice separately.</li><li>Use the customer's registered legal name and address (Companies House for companies and LLPs).</li><li>Only mention a next step you genuinely intend to take.</li><li>Statutory interest and the fixed sum apply to business-to-business debts under the <a href="${SOURCES.act5A}" rel="noopener noreferrer" target="_blank">Late Payment of Commercial Debts (Interest) Act 1998</a>, unless your contract sets its own late-payment interest.</li><li>Sole traders and individuals: follow the <a href="${SOURCES.pap}" rel="noopener noreferrer" target="_blank">Pre-Action Protocol for Debt Claims</a>.</li></ul><p><em>${DISCLAIMER} Have a solicitor check the letter before you first use it.</em></p></div>`,
  },
};

function templateBlock(t) {
  const body = t.channel === 'Phone script' ? t.body : `**Subject:** ${t.subject}\n\n${t.body}`;
  return html`<section class="free-template"><h2>${t.code.length === 1 ? `Template ${t.code}: ` : ''}${t.name} <span class="badge badge-gray">${t.channel}</span></h2>${t.review ? html`<p class="small muted">Have a solicitor check this one before you first use it.</p>` : ''}${md(body)}</section>`;
}

export function freePage(ctx) {
  const def = ctx.definition;
  const page = Object.hasOwn(PAGES, ctx.params.page) ? PAGES[ctx.params.page] : null;
  if (!page) return null;
  const items = page.codes.map((c) => DEFAULT_TEMPLATES.find((t) => t.code === c)).filter(Boolean);
  const body = html`<section class="section"><div class="container narrow"><p class="eyebrow">Free templates</p><h1>${page.title}</h1><p class="lead">${page.intro}</p><p class="small muted">Fill in the [square brackets]. ${DISCLAIMER}</p>${items.map(templateBlock)}${page.after || ''}${offerBox(def)}</div></section>`;
  return publicPage(def, ctx, { title: page.title, description: page.description, body });
}

export function freeTermsPage(ctx) {
  const def = ctx.definition;
  const body = html`<section class="section"><div class="container narrow"><p class="eyebrow">Free template</p><h1>Payment terms and credit policy template (UK)</h1><p class="lead">What the law sets, an internal credit policy, customer-facing payment terms and the wording for your invoices. Fill in the brackets and have a solicitor check Part B before you use it.</p>${md(policy({}, '[Company]'))}${offerBox(def, { title: 'Want it filled in for you?', text: `${def.name}'s policy builder writes this policy, your customer terms and your invoice wording from a few answers, and keeps it in step with your chase ladder and settings.` })}</div></section>`;
  return publicPage(def, ctx, { title: 'Free payment terms and credit policy template', description: 'A free UK payment terms and credit policy template for small businesses selling to other businesses, with the statutory late payment rules explained.', body });
}

export const FREE_PAGES = Object.keys(PAGES);
export { card };
