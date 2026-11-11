// Bank of England Bank Rate history and the statutory reference rate.
// Source: https://www.bankofengland.co.uk/boeapps/database/Bank-Rate.asp (checked 11 Nov 2026).
// When the Bank changes Bank Rate, add the change here and move RATES_CHECKED_THROUGH forward.

export const BANK_RATE_SOURCE = 'https://www.bankofengland.co.uk/boeapps/database/Bank-Rate.asp';
export const RATES_CHECKED_THROUGH = '2026-11-11';

/** [date the new rate took effect, Bank Rate %], newest first. */
export const BANK_RATE_CHANGES = [
  ['2026-11-05', 4.0],
  ['2025-12-18', 3.75],
  ['2025-08-07', 4.0],
  ['2025-05-08', 4.25],
  ['2025-02-06', 4.5],
  ['2024-11-07', 4.75],
  ['2024-08-01', 5.0],
  ['2023-08-03', 5.25],
  ['2023-06-22', 5.0],
  ['2023-05-11', 4.5],
  ['2023-03-23', 4.25],
  ['2023-02-02', 4.0],
  ['2022-12-15', 3.5],
  ['2022-11-03', 3.0],
  ['2022-09-22', 2.25],
  ['2022-08-04', 1.75],
  ['2022-06-16', 1.25],
  ['2022-05-05', 1.0],
  ['2022-03-17', 0.75],
  ['2022-02-03', 0.5],
  ['2021-12-16', 0.25],
  ['2020-03-19', 0.1],
  ['2020-03-11', 0.25],
  ['2018-08-02', 0.75],
  ['2017-11-02', 0.5],
  ['2016-08-04', 0.25],
  ['2009-03-05', 0.5],
];
const EARLIEST = BANK_RATE_CHANGES[BANK_RATE_CHANGES.length - 1][0];

/** Bank Rate in force at the end of a day, or null when the day is outside the checked history. */
export function bankRateOn(iso) {
  if (!iso || iso < EARLIEST || iso > RATES_CHECKED_THROUGH) return null;
  for (const [from, rate] of BANK_RATE_CHANGES) if (from <= iso) return rate;
  return null;
}

/**
 * Late Payment of Commercial Debts (Rate of Interest) (No. 3) Order 2002, article 4: the reference rate is the
 * rate in force on 30 June (interest starting 1 Jul–31 Dec) or 31 December (interest starting 1 Jan–30 Jun)
 * immediately before interest starts to run. It is fixed for the life of the debt.
 */
export function referenceDateFor(interestStart) {
  const y = Number(interestStart.slice(0, 4));
  const m = Number(interestStart.slice(5, 7));
  return m <= 6 ? `${y - 1}-12-31` : `${y}-06-30`;
}

/** The first day of the six-month period a reference date applies to (31 Dec 2025 → 1 Jan 2026). */
export const periodStartFor = (refDate) => (refDate.endsWith('-12-31') ? `${Number(refDate.slice(0, 4)) + 1}-01-01` : `${refDate.slice(0, 4)}-07-01`);

/** Every six-month period from 2017 to the latest one that has a known reference rate, newest first. */
export function referenceRateTable() {
  const out = [];
  for (let y = 2017; ; y++) {
    let added = false;
    for (const ref of [`${y - 1}-12-31`, `${y}-06-30`]) {
      const rate = bankRateOn(ref);
      if (rate === null) continue;
      out.push({ refDate: ref, from: periodStartFor(ref), rate });
      added = true;
    }
    if (!added && y > 2017) break;
  }
  return out.reverse();
}
