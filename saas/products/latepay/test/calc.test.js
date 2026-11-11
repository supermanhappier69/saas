// Calculation and chase-ladder tests. Expected figures come from the GOV.UK worked example, the v0.9 kit's
// QA-TEST rows and hand calculations (shown in the comments).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixedSum, invoiceFigures, referenceRate, rateCheck } from '../lib/calc.js';
import { bankRateOn, referenceDateFor, referenceRateTable } from '../lib/rates.js';
import { nextAction, ladderFrom, stageForDays, DEFAULT_LADDER } from '../lib/ladder.js';

test('fixed compensation bands, including every edge', () => {
  assert.equal(fixedSum(0), 0);
  assert.equal(fixedSum(0.01), 40);
  assert.equal(fixedSum(999.99), 40);
  assert.equal(fixedSum(1000), 70);
  assert.equal(fixedSum(9999.99), 70);
  assert.equal(fixedSum(10000), 100);
  assert.equal(fixedSum(250000), 100);
});

test('Bank Rate history and the 30 June / 31 December reference date rule', () => {
  assert.equal(bankRateOn('2022-06-30'), 1.25);
  assert.equal(bankRateOn('2023-06-30'), 5.0); // cut to 5% on 22 Jun 2023
  assert.equal(bankRateOn('2024-12-31'), 4.75);
  assert.equal(bankRateOn('2025-06-30'), 4.25);
  assert.equal(bankRateOn('2025-12-31'), 3.75);
  assert.equal(bankRateOn('2026-06-30'), 3.75);
  assert.equal(bankRateOn('2026-12-31'), null, 'future rates are never assumed');
  assert.equal(referenceDateFor('2026-01-01'), '2025-12-31');
  assert.equal(referenceDateFor('2026-06-30'), '2025-12-31');
  assert.equal(referenceDateFor('2026-07-01'), '2026-06-30');
  // Interest starts the day after the due date, so a 30 June due date uses the 30 June rate.
  assert.equal(referenceRate('2026-06-30').refDate, '2026-06-30');
  assert.equal(referenceRate('2026-06-29').refDate, '2025-12-31');
  const table = referenceRateTable();
  assert.deepEqual(table[0], { refDate: '2026-06-30', from: '2026-07-01', rate: 3.75 });
  assert.ok(table.some((r) => r.refDate === '2016-12-31' && r.rate === 0.25));
});

test('QA-TEST-01: GOV.UK worked example, £1,000 a year late at 0.5%', () => {
  const f = invoiceFigures({ amount: 1000, dueDate: '2025-11-10', today: '2026-11-11', status: 'Paid', paidDate: '2026-11-10', rateOverride: 0.5 });
  assert.equal(f.daysOverdue, 365);
  assert.equal(f.interest, 85);
  assert.equal(f.fixedSum, 70);
  assert.equal(f.claimable, 155);
  assert.equal(f.balance, 0);
  assert.equal(f.paidLate, true);
  // GOV.UK: about 23p a day; 50 days is £11.64 exactly (GOV.UK rounds the daily figure first and shows £11.50).
  const open = invoiceFigures({ amount: 1000, dueDate: '2026-01-01', today: '2026-02-20', rateOverride: 0.5 });
  assert.equal(open.daysOverdue, 50);
  assert.equal(open.dailyInterest, 0.23);
  assert.equal(open.interest, 11.64);
});

test('QA-TEST-02: £999.99, 30 days, no reference rate known yet', () => {
  const f = invoiceFigures({ amount: 999.99, dueDate: '2027-01-01', today: '2027-01-31' });
  assert.equal(f.reference.source, 'missing');
  assert.equal(f.reference.refDate, '2026-12-31');
  assert.equal(f.daysOverdue, 30);
  assert.equal(f.interest, 6.58); // 999.99 × 8% × 30 ÷ 365
  assert.equal(f.fixedSum, 40);
  assert.match(rateCheck(f.reference, { daysOverdue: 30 }).text, /8% only.*31 Dec 2026/);
  // The same debt in the second half of 2026 uses the 3.75% rate in force on 30 June 2026.
  const known = invoiceFigures({ amount: 999.99, dueDate: '2026-10-11', today: '2026-11-10' });
  assert.equal(known.reference.rate, 3.75);
  assert.equal(known.interest, 9.66); // 999.99 × 11.75% × 30 ÷ 365
});

test('QA-TEST-03 and QA-TEST-04: £10,000 band, and claims switched off', () => {
  const big = invoiceFigures({ amount: 10000, dueDate: '2026-03-31', today: '2026-11-11', status: 'Paid', paidDate: '2026-04-30', rateOverride: 1 });
  assert.equal(big.daysOverdue, 30);
  assert.equal(big.interest, 73.97);
  assert.equal(big.fixedSum, 100);
  const off = invoiceFigures({ amount: 5000, dueDate: '2026-10-01', today: '2026-11-10', claim: false });
  assert.equal(off.daysOverdue, 40);
  assert.equal(off.interest, 0);
  assert.equal(off.fixedSum, 0);
  assert.equal(off.totalDue, 5000);
});

test('part payments reduce interest from the day they arrive', () => {
  // £3,000 due 31 Jan 2026 (11.75%), £1,000 paid after 30 days, checked 30 days later.
  const part = invoiceFigures({ amount: 3000, dueDate: '2026-01-31', today: '2026-04-01', payments: [{ date: '2026-03-02', amount: 1000 }] });
  assert.equal(part.balance, 2000);
  assert.equal(part.interest, 48.29); // 3000 × 11.75% × 30/365 + 2000 × 11.75% × 30/365
  assert.equal(part.dailyInterest, 0.64);
  assert.equal(part.totalDue, 2118.29);
  const done = invoiceFigures({ amount: 3000, dueDate: '2026-01-31', today: '2026-05-01', payments: [{ date: '2026-03-02', amount: 1000 }, { date: '2026-04-01', amount: 2000 }] });
  assert.equal(done.settled, true);
  assert.equal(done.settledOn, '2026-04-01');
  assert.equal(done.daysOverdue, 60);
  assert.equal(done.interest, 48.29);
  assert.equal(done.dailyInterest, 0);
  assert.equal(done.totalDue, 118.29);
  // Paid before the due date: no interest at all.
  const early = invoiceFigures({ amount: 3000, dueDate: '2026-01-31', today: '2026-03-01', payments: [{ date: '2026-01-20', amount: 3000 }] });
  assert.equal(early.daysOverdue, 0);
  assert.equal(early.claimable, 0);
});

test('workspace and invoice rates override the built-in table', () => {
  const ws = invoiceFigures({ amount: 1000, dueDate: '2027-01-10', today: '2027-02-09', workspaceRates: [{ from: '2027-01-01', rate: 4 }] });
  assert.equal(ws.reference.source, 'workspace');
  assert.equal(ws.interest, 9.86); // 1000 × 12% × 30 ÷ 365
  const inv = invoiceFigures({ amount: 1000, dueDate: '2027-01-10', today: '2027-02-09', rateOverride: 2, workspaceRates: [{ from: '2027-01-01', rate: 4 }] });
  assert.equal(inv.reference.source, 'invoice');
});

// The v0.9 sample invoices, as of 11 Nov 2026 (the kit's QA test 5).
const TODAY = '2026-11-11';
const L = ladderFrom({});
function act(inv, log = []) {
  const fig = invoiceFigures({ amount: inv.amount || 1000, dueDate: inv.due_date, today: TODAY, status: inv.status || 'Open', paidDate: inv.paid_date });
  return nextAction({ status: 'Open', ...inv }, fig, log.map((x, i) => ({ id: i + 1, ...x })), { today: TODAY, L });
}

test('next action ladder for the sample invoices', () => {
  assert.deepEqual(DEFAULT_LADDER, { pre_due_days: 3, stage2_from: 8, stage3_from: 15, stage4_from: 31, stage5_from: 46 });
  const pre = act({ due_date: '2026-11-12' });
  assert.equal(pre.stage, 0);
  assert.equal(pre.now, true);
  const broken = act({ due_date: '2026-10-01', promised_date: '2026-10-19' }, [
    { date: '2026-10-03', stage: '1 · Friendly reminder' },
    { date: '2026-10-12', stage: '2 · Firm reminder and call', next_follow_up: '2026-10-19' },
  ]);
  assert.equal(broken.kind, 'broken');
  assert.equal(act({ due_date: '2026-10-25' }, [{ date: '2026-10-28', stage: '1 · Friendly reminder' }]).stage, 3);
  const lba = act({ due_date: '2026-09-09', customer_type: 'Limited company / LLP' }, [{ date: '2026-10-09', stage: '3 · Final notice' }]);
  assert.equal(lba.stage, 5);
  assert.doesNotMatch(lba.label, /Protocol/);
  assert.match(act({ due_date: '2026-09-09', customer_type: 'Sole trader' }).label, /Pre-Action Protocol/);
  assert.equal(act({ due_date: '2026-11-03' }).stage, 2);
  assert.equal(act({ due_date: '2026-09-14', status: 'Paid', paid_date: '2026-09-30' }).kind, 'paid-late');
  assert.equal(act({ due_date: '2026-10-25', status: 'Disputed' }).kind, 'dispute');
  assert.equal(act({ due_date: '2026-10-19', status: 'Paid', paid_date: '2026-10-18' }).label, 'Paid');
});

test('the ladder waits after a contact and schedules the next stage', () => {
  // Friendly reminder sent on day 2: the firm reminder is due on day 8.
  const wait = act({ due_date: '2026-11-09' }, [{ date: '2026-11-10', stage: '1 · Friendly reminder' }]);
  assert.equal(wait.stage, 2);
  assert.equal(wait.on, '2026-11-17');
  assert.equal(wait.now, false);
  // A follow-up date before the next stage wins.
  const fu = act({ due_date: '2026-11-09' }, [{ date: '2026-11-10', stage: '1 · Friendly reminder', next_follow_up: '2026-11-13' }]);
  assert.equal(fu.kind, 'follow-up');
  assert.equal(fu.on, '2026-11-13');
  // Not due for a while: the pre-due reminder is scheduled.
  const later = act({ due_date: '2026-12-11' });
  assert.equal(later.kind, 'scheduled');
  assert.equal(later.on, '2026-12-08');
  // A promise in the future: check it arrived the day after.
  assert.equal(act({ due_date: '2026-10-01', promised_date: '2026-11-20' }).on, '2026-11-21');
  assert.equal(stageForDays(0, 5, L), null);
  // Custom timings stay in order even if entered badly.
  const custom = ladderFrom({ pre_due_days: 5, stage2_from: 10, stage3_from: 9, stage4_from: 'x', stage5_from: 60 });
  assert.deepEqual(custom, { pre_due_days: 5, stage2_from: 10, stage3_from: 11, stage4_from: 31, stage5_from: 60 });
});
