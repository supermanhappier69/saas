// Trial lifecycle emails: one short, specific message at each point where a trial is usually won or lost.
// Sent by the daily job to owners and admins, at most one per workspace per day, each only once.
import { addDays, daysBetween, fmtGBP, fmtDateUK, round2 } from '../../core/util.js';
import { allInvoices } from './resources.js';

const isLive = (i) => !i.fig.settled && i.status !== 'Written off';

/** Which trial email is due on `date`, or null. Windows are two or more days wide so a missed daily run still sends. */
export function trialStage(org, date, trialDays = 14) {
  if (!org.trial_ends) return null;
  const left = daysBetween(date, org.trial_ends);
  if (left < 0) return -left <= 7 ? 'ended' : null;
  if (left <= 3) return 'ending';
  const day = trialDays - left;
  if (day >= trialDays - 5) return 'recap';
  if (day >= 2) return 'activate';
  return null;
}

function figures(ctx) {
  const own = allInvoices(ctx).filter((i) => !i.is_sample);
  const live = own.filter(isLive);
  const overdue = live.filter((i) => i.days_overdue > 0);
  const claim = own.filter((i) => i.fig.claim && i.fig.claimable > 0 && (isLive(i) || i.next.kind === 'paid-late'));
  const sum = (list, f) => round2(list.reduce((s, i) => s + f(i), 0));
  return {
    own: own.length,
    live: live.length,
    outstanding: sum(live, (i) => i.balance),
    overdue: overdue.length,
    overdueTotal: sum(overdue, (i) => i.balance),
    claimable: sum(claim, (i) => i.fig.claimable),
    claimCount: claim.length,
    now: live.filter((i) => i.next.now && i.next.kind !== 'promise').length,
  };
}

function message(kind, { def, org, name, base, fig }) {
  const plans = (def.plans || []).filter((p) => p.price && !p.hidden);
  const priceLine = plans.map((p) => `- ${p.name}, £${p.price} one-off: ${p.description}`).join('\n');
  const ends = fmtDateUK(org.trial_ends, true);
  const hi = `Hi ${name},`;
  const footer = `\n\n${def.name}\n\n--\nYou're getting this because you started a free trial for ${org.name}. Turn trial emails off in Settings: ${base}/app/settings`;
  if (kind === 'activate') {
    return {
      subject: `Add your unpaid invoices to ${def.name}`,
      text: `${hi}\n\nOnce your unpaid invoices are in, ${def.name} tells you what to send to whom each day and works out the interest and compensation you can claim on the late ones.\n\nThe quickest ways in:\n- Import a CSV of unpaid invoices, for example an export from your accounting software: ${base}/app/invoices/import\n- Or add one by hand: ${base}/app/invoices/new\n\nMost people are set up in about ten minutes. If you get stuck, reply to this email.${footer}`,
    };
  }
  if (kind === 'recap') {
    const lines = [
      `- ${fig.live} unpaid invoice${fig.live === 1 ? '' : 's'}, ${fmtGBP(fig.outstanding)} outstanding`,
      fig.overdue ? `- ${fig.overdue} overdue, ${fmtGBP(fig.overdueTotal)} in total` : null,
      fig.claimable > 0 ? `- ${fmtGBP(fig.claimable)} of statutory interest and compensation you can claim on ${fig.claimCount} invoice${fig.claimCount === 1 ? '' : 's'}` : null,
      fig.now ? `- ${fig.now} chase action${fig.now === 1 ? '' : 's'} due today: ${base}/app/chase` : null,
    ].filter(Boolean).join('\n');
    return {
      subject: fig.claimable > 0 ? `${fmtGBP(fig.outstanding)} outstanding, ${fmtGBP(fig.claimable)} you can claim` : `${fmtGBP(fig.outstanding)} outstanding across ${fig.live} invoice${fig.live === 1 ? '' : 's'}`,
      text: `${hi}\n\nHere's where ${org.name} stands today:\n\n${lines}\n\nYour trial ends on ${ends}. Keeping ${def.name} is a single payment, not a subscription (prices exclude VAT):\n${priceLine}\n\nChoose a plan: ${base}/app/billing${footer}`,
    };
  }
  if (kind === 'ending') {
    return {
      subject: `Your ${def.name} trial ends on ${ends}`,
      text: `${hi}\n\nYour free trial ends on ${ends}. After that the workspace becomes read-only: nothing is deleted, and you can still export everything.\n\nTo keep chasing, choose a plan. It's a single payment, not a subscription (prices exclude VAT):\n${priceLine}\n\n${fig.claimable > 0 ? `Your workspace shows ${fmtGBP(fig.claimable)} you can claim. The interest claim and the letter before action are part of Complete.\n\n` : ''}Choose a plan: ${base}/app/billing${footer}`,
    };
  }
  return {
    subject: `Your ${def.name} trial has ended`,
    text: `${hi}\n\nYour free trial ended on ${ends}, so ${org.name} is now read-only. Your customers, invoices and chase log are safe, and you can still export them from Settings.\n\nTo start chasing again, choose a plan. It's a single payment, from £${Math.min(...plans.map((p) => p.price))} excluding VAT: ${base}/app/billing${footer}`,
  };
}

/** Sends the trial email due today, if any. Returns its kind, or null. */
export async function trialEmails(services, org, date) {
  if (org.is_demo || org.plan_status !== 'trialing' || org.settings?.trial_emails === false) return null;
  const def = services.definition;
  const kind = trialStage(org, date, def.trialDays ?? 14);
  if (!kind) return null;
  const ctx = { org, services, user: null, cache: {}, role: 'viewer' };
  const fig = figures(ctx);
  // Nudge only people with nothing of their own in yet; recap only people who have something to recap.
  if (kind === 'activate' && fig.own > 0) return null;
  if (kind === 'recap' && fig.live === 0) return null;
  const { db, mailer, config } = services;
  const people = db.all("SELECT u.id, u.email, u.name FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.org_id = ? AND m.role IN ('owner', 'admin')", org.id);
  let sent = 0;
  for (const p of people) {
    const name = String(p.name || '').trim().split(/\s+/)[0] || 'there';
    const { subject, text } = message(kind, { def, org, name, base: config.BASE_URL, fig });
    const r = await mailer.send({ orgId: org.id, to: p.email, subject, text, related: 'trial', dedupeKey: `trial:${kind}:${org.id}:${p.id}` });
    if (!r.duplicate) sent++;
  }
  return sent ? kind : null;
}

export { addDays };
