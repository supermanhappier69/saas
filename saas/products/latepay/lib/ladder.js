// The chase ladder: which stage an invoice is at, and the next thing to do about it (and when).
import { addDays, daysBetween } from '../../../core/util.js';
import { fmtShort } from './calc.js';

export const STAGES = [
  { n: 0, label: 'Pre-due reminder', short: 'Pre-due', template: '0', tone: 'blue' },
  { n: 1, label: 'Friendly reminder', short: 'Friendly', template: '1', tone: 'blue' },
  { n: 2, label: 'Firm reminder and call', short: 'Firm + call', template: '2', tone: 'orange' },
  { n: 3, label: 'Final notice', short: 'Final notice', template: '3', tone: 'orange' },
  { n: 4, label: 'Claim interest and compensation', short: 'Claim', template: '4', tone: 'red' },
  { n: 5, label: 'Letter before action', short: 'Letter before action', template: '5', tone: 'red' },
];
export const stageLabel = (n) => (n === null || n === undefined ? '' : `${n} · ${STAGES[n].label}`);
export const STAGE_OPTIONS = STAGES.map((s) => stageLabel(s.n));
/** Chase log stages: the six ladder steps plus contacts that sit outside the ladder. */
export const LOG_STAGE_OPTIONS = [...STAGE_OPTIONS, 'Broken promise', 'Dispute', 'Payment plan', 'Other'];
export function stageNumber(label) {
  const m = /^([0-5]) ·/.exec(String(label || ''));
  return m ? Number(m[1]) : null;
}

/** Outcome of a chase log row made by "Skip this one": it defers the next action a day but is not a contact with the customer. */
export const SKIPPED = 'Skipped';
export const isContact = (row) => row.outcome !== SKIPPED;

export const DEFAULT_LADDER = { pre_due_days: 3, stage2_from: 8, stage3_from: 15, stage4_from: 31, stage5_from: 46 };

/** Ladder timings from workspace settings, falling back to the kit's defaults and keeping them in order. */
export function ladderFrom(settings = {}) {
  const pick = (k) => {
    const raw = settings[k];
    // Blank or missing means "not set": Number(null) and Number('') are 0, which would collapse the ladder.
    const v = raw === null || raw === undefined || String(raw).trim() === '' ? NaN : Number(raw);
    return Number.isInteger(v) && v >= 0 ? v : DEFAULT_LADDER[k];
  };
  const L = { pre_due_days: pick('pre_due_days'), stage2_from: pick('stage2_from'), stage3_from: pick('stage3_from'), stage4_from: pick('stage4_from'), stage5_from: pick('stage5_from') };
  L.stage2_from = Math.max(2, L.stage2_from);
  L.stage3_from = Math.max(L.stage2_from + 1, L.stage3_from);
  L.stage4_from = Math.max(L.stage3_from + 1, L.stage4_from);
  L.stage5_from = Math.max(L.stage4_from + 1, L.stage5_from);
  return L;
}

/** The days-overdue band for each stage, for guides and tables. */
export function ladderBands(L) {
  return [
    `Due within ${L.pre_due_days} days`,
    `1–${L.stage2_from - 1} days overdue`,
    `${L.stage2_from}–${L.stage3_from - 1} days`,
    `${L.stage3_from}–${L.stage4_from - 1} days`,
    `${L.stage4_from}–${L.stage5_from - 1} days`,
    `${L.stage5_from}+ days`,
  ];
}

/** Stage by days overdue, or 0 inside the pre-due window, or null when it isn't time to chase yet. */
export function stageForDays(daysOverdue, daysToDue, L) {
  if (daysOverdue >= L.stage5_from) return 5;
  if (daysOverdue >= L.stage4_from) return 4;
  if (daysOverdue >= L.stage3_from) return 3;
  if (daysOverdue >= L.stage2_from) return 2;
  if (daysOverdue >= 1) return 1;
  if (daysToDue !== null && daysToDue !== undefined && daysToDue >= 0 && daysToDue <= L.pre_due_days) return 0;
  return null;
}

/** The day an invoice reaches a stage. */
export function stageStart(n, dueDate, L) {
  return [addDays(dueDate, -L.pre_due_days), addDays(dueDate, 1), addDays(dueDate, L.stage2_from), addDays(dueDate, L.stage3_from), addDays(dueDate, L.stage4_from), addDays(dueDate, L.stage5_from)][n];
}

/**
 * The next action for an invoice.
 * inv: { status, due_date, promised_date, customer_type }, fig: invoiceFigures(), log: chase log rows for this invoice.
 * Returns { kind, stage, label, on, tone, template, now } where `on` is the day it should happen and `now` means it's due today or earlier.
 */
export function nextAction(inv, fig, log, { today, L }) {
  const out = (o) => ({ stage: null, template: null, tone: 'gray', on: null, ...o, now: Boolean(o.on && o.on <= today) });
  if (inv.status === 'Written off') return out({ kind: 'closed', label: 'Written off' });
  if (fig.settled) {
    if (fig.paidLate && fig.claim && fig.claimable > 0) return out({ kind: 'paid-late', label: `Paid ${daysLabel(fig.daysOverdue)} late: £${fig.claimable.toFixed(2)} still claimable`, tone: 'purple' });
    if (fig.credit > 0) return out({ kind: 'closed', label: `Paid, £${fig.credit.toFixed(2)} overpaid`, tone: 'purple' });
    return out({ kind: 'closed', label: 'Paid', tone: 'green' });
  }
  if (!inv.due_date) return out({ kind: 'setup', label: 'Add a due date', tone: 'orange', on: today });
  if (inv.status === 'Disputed') return out({ kind: 'dispute', label: 'Resolve the dispute before chasing', tone: 'orange', on: followUp(log) || today });

  // Skipped rows only matter for the follow-up date below; they are not contacts, so they never count as the last contact or a stage done.
  const sorted = log.filter(isContact).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id));
  const lastContact = sorted[sorted.length - 1] || null;
  const promise = inv.promised_date;
  if (promise && promise >= today) {
    return out({ kind: 'promise', label: `Check the payment promised for ${fmtShort(promise)} arrived`, tone: 'blue', on: addDays(promise, 1) });
  }
  if (promise && promise < today && !(lastContact && lastContact.date > promise)) {
    return out({ kind: 'broken', label: `Chase the broken promise to pay by ${fmtShort(promise)}`, tone: 'red', on: addDays(promise, 1), template: null });
  }
  if (inv.status === 'On payment plan') {
    return out({ kind: 'plan', label: 'Check the payment plan instalments are arriving', tone: 'blue', on: followUp(log) || today });
  }

  const rec = stageForDays(fig.daysOverdue, fig.daysToDue, L);
  const done = sorted.map((x) => stageNumber(x.stage)).filter((n) => n !== null);
  const last = done.length ? Math.max(...done) : null;
  const pap = inv.customer_type === 'Sole trader';
  const make = (n, on, extra = {}) => out({
    kind: 'stage',
    stage: n,
    label: STAGES[n].label + (n === 5 && pap ? ' (Pre-Action Protocol applies)' : ''),
    template: STAGES[n].template,
    tone: STAGES[n].tone,
    on,
    ...extra,
  });

  if (rec === null && last === null) return make(0, stageStart(0, inv.due_date, L), { kind: 'scheduled' });
  if (rec !== null && (last === null || rec > last)) {
    // A follow-up date set in the future ("remind me tomorrow") defers the stage until then.
    const on = stageStart(rec, inv.due_date, L);
    const fu = followUp(log);
    return make(rec, fu && fu > today && fu > on ? fu : on);
  }
  // This stage has been done: either follow up on the contact or move up the ladder when the next stage starts.
  const fu = followUp(log);
  if (last >= 5) {
    return out({ kind: 'escalate', stage: 5, label: 'Decide on formal recovery (take advice first)', tone: 'red', on: fu || addDays(lastContact?.date || today, 14) });
  }
  const nextOn = stageStart(last + 1, inv.due_date, L);
  if (fu && fu < nextOn) return make(last, fu, { kind: 'follow-up', label: `Follow up: ${STAGES[last].label.toLowerCase()}` });
  return make(last + 1, nextOn);
}

function followUp(log) {
  const dates = log.map((x) => x.next_follow_up).filter(Boolean).sort();
  const latestContact = log.map((x) => x.date).filter(Boolean).sort().pop();
  const fu = dates.pop();
  return fu && (!latestContact || fu >= latestContact) ? fu : null;
}

export const daysLabel = (n) => `${n} day${n === 1 ? '' : 's'}`;
export function whenLabel(on, today) {
  if (!on) return '';
  const d = daysBetween(today, on);
  if (d === 0) return 'Today';
  if (d === 1) return 'Tomorrow';
  if (d === -1) return 'Yesterday';
  if (d < 0) return `${daysLabel(-d)} ago`;
  if (d < 7) return `In ${daysLabel(d)}`;
  return fmtShort(on);
}
