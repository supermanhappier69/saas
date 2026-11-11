// Late payment arithmetic: days overdue, statutory interest (with part payments), the fixed sum and totals.
// Pure functions with no I/O, so every figure can be tested against GOV.UK examples and hand calculations.
import { addDays, daysBetween, round2 } from '../../../core/util.js';
import { bankRateOn, referenceDateFor, periodStartFor } from './rates.js';

export const STATUTORY_MARGIN = 8;

/** Late Payment of Commercial Debts (Interest) Act 1998, s.5A: £40 under £1,000, £70 under £10,000, otherwise £100. */
export function fixedSum(amount) {
  const a = Number(amount) || 0;
  if (a <= 0) return 0;
  return a < 1000 ? 40 : a < 10000 ? 70 : 100;
}

/**
 * Which reference rate applies to a debt and where it came from.
 * override: a rate typed on the invoice. workspaceRates: [{ from: 'YYYY-01-01' | 'YYYY-07-01', rate }] entered by the user.
 */
export function referenceRate(dueDate, { override = null, workspaceRates = [] } = {}) {
  if (!dueDate) return { refDate: null, from: null, rate: null, source: 'none' };
  const refDate = referenceDateFor(addDays(dueDate, 1));
  const from = periodStartFor(refDate);
  if (override !== null && override !== undefined && override !== '') return { refDate, from, rate: Number(override), source: 'invoice' };
  const own = workspaceRates.find((r) => r.from === from && r.rate !== null && r.rate !== undefined);
  if (own) return { refDate, from, rate: Number(own.rate), source: 'workspace' };
  const rate = bankRateOn(refDate);
  if (rate !== null) return { refDate, from, rate, source: 'bank' };
  return { refDate, from, rate: null, source: 'missing' };
}

/**
 * Figures for one invoice on a given day.
 * payments: [{ date, amount }]. If the invoice is marked paid without payment records, paidDate counts as one full payment.
 * Interest is simple interest on the unpaid balance for each day after the due date, so part payments reduce it from the day they arrive.
 */
export function invoiceFigures({
  amount, dueDate, today, payments = [], status = 'Open', paidDate = null, claim = true, rateOverride = null, workspaceRates = [],
}) {
  const total = round2(amount);
  let list = payments.filter((p) => p.date && Number(p.amount) > 0).map((p) => ({ date: p.date, amount: Number(p.amount) })).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (!list.length && status === 'Paid' && paidDate) list = [{ date: paidDate, amount: total }];
  // A manual "Paid" status wins over incomplete payment records.
  const paid = status === 'Paid' ? total : round2(list.reduce((s, p) => s + p.amount, 0));
  const balance = Math.max(0, round2(total - paid));
  const settled = balance <= 0 || status === 'Paid';
  let settledOn = null;
  if (settled) {
    let run = 0;
    for (const p of list) {
      run += p.amount;
      if (round2(run) >= total) {
        settledOn = p.date;
        break;
      }
    }
    settledOn ||= paidDate || list[list.length - 1]?.date || null;
  }
  const end = settled ? settledOn : today;
  const daysOverdue = dueDate && end ? Math.max(0, daysBetween(dueDate, end)) : 0;
  const daysToDue = dueDate && !settled ? daysBetween(today, dueDate) : null;
  const ref = referenceRate(dueDate, { override: rateOverride, workspaceRates });
  const applies = Boolean(claim) && daysOverdue > 0 && status !== 'Written off';
  const annualRate = STATUTORY_MARGIN + (ref.rate ?? 0);

  let interest = 0;
  if (applies) {
    // Walk from the due date to the end, charging the balance outstanding over each stretch of days.
    let owed = total;
    let from = dueDate;
    for (const p of list) {
      if (p.date <= dueDate) {
        owed -= p.amount;
        continue;
      }
      if (p.date > end) break;
      interest += Math.max(0, owed) * annualRate / 100 * daysBetween(from, p.date) / 365;
      owed -= p.amount;
      from = p.date;
    }
    if (end > from) interest += Math.max(0, owed) * annualRate / 100 * daysBetween(from, end) / 365;
  }
  interest = round2(interest);
  const fixed = applies ? fixedSum(total) : 0;
  const dailyInterest = applies && !settled ? round2(balance * annualRate / 100 / 365) : 0;
  return {
    amount: total,
    paid,
    balance,
    settled,
    settledOn,
    daysOverdue,
    daysToDue,
    paidLate: settled && daysOverdue > 0,
    reference: ref,
    annualRate: applies ? annualRate : 0,
    claim: applies,
    interest,
    dailyInterest,
    fixedSum: fixed,
    claimable: round2(interest + fixed),
    totalDue: round2(balance + interest + fixed),
  };
}

/** Plain-English rate check, mirroring the kit's Rate Check column. */
export function rateCheck(ref, { claim = true, daysOverdue = 0 } = {}) {
  if (!claim) return { tone: 'gray', text: 'Not claiming statutory interest' };
  if (ref.source === 'none') return { tone: 'gray', text: 'Add a due date' };
  const on = fmtShort(ref.refDate);
  if (ref.source === 'missing') {
    return {
      tone: 'orange',
      text: daysOverdue > 0
        ? `Interest shown at 8% only. Enter the Bank of England base rate on ${on} under Reference rates.`
        : `The base rate on ${on} isn't known yet. Add it under Reference rates when it is.`,
    };
  }
  if (ref.source === 'invoice') return { tone: 'blue', text: `Using ${ref.rate}% typed on this invoice (the rule uses the rate on ${on})` };
  if (ref.source === 'workspace') return { tone: 'green', text: `Bank of England base rate on ${on}: ${ref.rate}% (from your reference rates)` };
  return { tone: 'green', text: `Bank of England base rate on ${on}: ${ref.rate}%` };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function fmtShort(iso) {
  if (!iso) return '';
  return `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
}
