// Guides and documents from the v0.9 kit, filled in from the workspace's settings.
// General information based on official UK guidance, not legal advice.
import { ladderBands } from './ladder.js';

export const SOURCES = {
  govLate: 'https://www.gov.uk/late-commercial-payments-interest-debt-recovery',
  govInterest: 'https://www.gov.uk/late-commercial-payments-interest-debt-recovery/charging-interest-commercial-debt',
  govWhenLate: 'https://www.gov.uk/late-commercial-payments-interest-debt-recovery/when-a-payment-becomes-late',
  govCosts: 'https://www.gov.uk/late-commercial-payments-interest-debt-recovery/claim-debt-recovery-costs',
  order: 'https://www.legislation.gov.uk/uksi/2002/1675/article/4/made',
  act5A: 'https://www.legislation.gov.uk/ukpga/1998/20/section/5A',
  sbc: 'https://www.smallbusinesscommissioner.gov.uk/help-and-guidance/interest-calculator/',
  pap: 'https://www.justice.gov.uk/courts/procedure-rules/civil/protocol',
  boe: 'https://www.bankofengland.co.uk/boeapps/database/Bank-Rate.asp',
};

export const DISCLAIMER = 'General information based on official UK guidance, not legal advice. Check your own contracts and take advice before formal recovery.';

/** The Commercial Payments Bill, as introduced in May 2026. Update this once it has Royal Assent and commencement dates. */
export const BILL_NOTE = `## The law is changing: the Commercial Payments Bill

The Commercial Payments Bill was introduced to Parliament in May 2026 and is expected to become law in 2027 ([GOV.UK overview](https://www.gov.uk/government/publications/commercial-payments-bill-factsheets/commercial-payments-bill-overview)). As introduced, it would:

- make statutory interest at **8% above the Bank of England base rate mandatory**, so contracts could no longer exclude or reduce it;
- cap payment terms at **60 days** (30 days for public authorities), with limited exemptions;
- give suppliers a fixed sum when a buyer disputes an invoice **late** (less than eight days before it is due) or without enough information;
- let the Small Business Commissioner adjudicate payment disputes for suppliers with fewer than 50 staff, investigate persistent late payers and fine them.

None of it is law yet and nothing applies retrospectively. Keep claiming under the current rules; this app will be updated when the Bill commences.`;

export function startHere(L) {
  const b = ladderBands(L);
  return `## Set up (15 minutes)

1. **Add your business details** in [Settings](/app/settings): your name, phone, bank details and payment link go into every template.
2. **Add your customers** with their legal name, customer type, payment terms and credit limit.
3. **Add every unpaid invoice** with the amount, invoice date and agreed due date. Leave the due date blank to use the customer's payment terms.
4. **Leave "Claim statutory interest" ticked** on business-to-business invoices, unless your contract sets its own late-payment interest. The app looks up the right Bank of England reference rate for you.
5. **Work the [chase list](/app/chase)** every Monday, and log every contact. Emails you send from the app are logged for you.
6. Remove the SAMPLE records when you're ready (Settings → Sample data).

## Weekly 20-minute routine

- [ ] Monday: open the chase list and work every action that's due.
- [ ] Send pre-due reminders for anything due in the next ${L.pre_due_days} days.
- [ ] Call every customer at stage 2 or later. Log the outcome and any promised date.
- [ ] Check [customers](/app/customers?view=watch) over their credit limit and decide whether to pause work.
- [ ] Friday: chase any broken payment promises.

## How the stages work

| Days overdue | Next action | Template |
| --- | --- | --- |
| ${b[0]} | Pre-due reminder | 0 |
| ${b[1]} | Friendly reminder | 1 |
| ${b[2]} | Firm reminder and call | 2 + phone script |
| ${b[3]} | Final notice | 3 |
| ${b[4]} | Claim interest and compensation | 4 |
| ${b[5]} | Letter before action or escalate | 5 |

These are suggested timings, not legal deadlines. Change them in [Settings](/app/settings) to suit your customers, and apply them consistently.

## What the numbers mean

- **Statutory interest:** 8% a year plus the Bank of England reference rate, simple interest, for each day overdue.
- **Fixed compensation:** £40 for debts under £1,000, £70 for £1,000 to £9,999.99 and £100 for £10,000 or more, once per invoice.
- These apply to business-to-business debts, not consumer sales. If your contract sets its own late-payment interest, untick the claim and use that instead.

*${DISCLAIMER}*`;
}

export function sop(L, s = {}) {
  const b = ladderBands(L);
  const owner = s.policy_owner || '[credit controller]';
  const approver = s.policy_approver || '[director]';
  const stop = s.stop_days ?? 30;
  return `**Goal:** get paid on time without damaging good customer relationships. **Owner:** ${owner}. **Approver for account stops, payment plans and escalation:** ${approver}. **Time:** about 20 minutes a week.

## 1. Before work starts (new customer)

- [ ] Record the customer's **legal name** and registered address (check Companies House for companies and LLPs).
- [ ] Get the name and email of the person who **approves and pays invoices**, and ask about their PO or approval process.
- [ ] Agree payment terms **in writing** before work starts (use the payment terms and credit policy).
- [ ] Set a **credit limit** and **risk rating**. Consider a deposit for new or high-risk customers.
- [ ] Set **customer type**: statutory interest applies to business-to-business debts, and debts owed by sole traders follow the Pre-Action Protocol for Debt Claims if they ever go to court.

## 2. When you invoice

- [ ] Invoice within 24 hours of delivery or of the agreed milestone.
- [ ] Include the PO number, the due date in full, bank details and your late-payment terms.
- [ ] Send it to the accounts contact, not just your day-to-day contact.
- [ ] For large invoices, confirm receipt and approval within 3 working days.
- [ ] Add the invoice to the app and link the customer.

## 3. Weekly routine (every Monday)

1. Open the chase list. Actions are sorted by when they're due.
2. Work each action, using the matching template.
3. Send pre-due reminders for anything due in the next ${L.pre_due_days} days.
4. Call every customer at stage 2 or later. A call resolves more than a fourth email.
5. Log every contact, and record a promised payment date when you get one.
6. Check customers over their credit limit. Raise them with ${approver}.
7. On Friday, chase any promise that was missed.

## 4. Escalation ladder

| Days overdue | Action | Who |
| --- | --- | --- |
| ${b[0]} | Pre-due reminder (Template 0) | ${owner} |
| ${b[1]} | Friendly reminder (Template 1) | ${owner} |
| ${b[2]} | Firm reminder and call (Template 2) | ${owner} |
| ${b[3]} | Final notice (Template 3); consider pausing work | ${approver} decides on pausing |
| ${b[4]} | Interest and compensation claim (Template 4) | ${approver} signs off |
| ${b[5]} | Letter before action (Template 5), then formal recovery | ${approver}, with advice |

These timings are defaults, not legal deadlines. Adjust them to your terms and customers, and apply them consistently.

## 5. Disputes

- Set the invoice status to Disputed and stop chasing the disputed amount.
- Record exactly what is disputed and ask for the **undisputed part** to be paid now.
- Aim to resolve it within 5 working days: credit note, corrected invoice or evidence of delivery.
- Once resolved, set the status back to Open. The ladder restarts at the stage that matches the days overdue.

## 6. Payment plans

- Agree plans in writing, with dated instalments and the total (Complete plan: payment plan agreement).
- Decide (and record) whether you will waive interest if the plan is kept.
- Set the status to On payment plan and record each instalment as a payment.
- If an instalment is missed, go straight back to the stage that matches the days overdue.

## 7. Claiming interest and compensation

- Claiming is a legal right for qualifying business debts, not an obligation. Decide your policy in advance and apply it consistently.
- Weigh the relationship first: an unexpected claim for small, slightly late amounts can damage trust.
- Use the invoice figures: interest at 8% plus the reference rate, plus the fixed sum of £40, £70 or £100.
- Recovery costs above the fixed sum are only claimable if they are reasonable. Take advice before claiming them.

## 8. Account on stop

Pause new work or orders when an account is over its credit limit **or** has an invoice more than ${stop} days overdue, unless ${approver} agrees otherwise. Tell the customer in advance and in writing, and set the account status to On stop.

## 9. Formal recovery

Before court action, a debt recovery agency or a solicitor's letter, get advice. Check whether the [Pre-Action Protocol for Debt Claims](${SOURCES.pap}) applies (debtors who are individuals or sole traders). The [Small Business Commissioner](${SOURCES.sbc}) publishes free guidance.

## 10. Monthly review (first Monday of the month)

- Total overdue and the top 5 overdue customers
- Share of invoices paid by their due date
- Broken promises and open disputes
- Customers to move to deposits, shorter terms or a lower credit limit

*${DISCLAIMER}*`;
}

export function numbersGuide() {
  return `The app does these sums for you. This page explains them so you can check any figure before you send it.

## 1. When a payment becomes late

- If you agreed a payment date, the payment is late once that date has passed. Agreed terms must usually be within 30 days for public authorities or 60 days for business transactions. A longer period between businesses must be fair to both.
- If you didn't agree a date, the payment is late 30 days after the customer receives the invoice or the goods or services, whichever is later ([GOV.UK](${SOURCES.govWhenLate})). Leave an invoice's due date blank and the app uses the customer's payment terms.

## 2. Statutory interest

- Rate: **8% a year plus the Bank of England reference rate**, charged as simple interest ([GOV.UK](${SOURCES.govInterest})).
- Formula: balance × (8 + reference rate) ÷ 100 × days overdue ÷ 365.
- GOV.UK's worked example: on £1,000 with a 0.5% rate, a year's interest is £85 and the daily interest about 23p. The app reproduces this exactly in its automated tests.
- The app doesn't round the daily figure before multiplying, so long periods can differ by a few pence from a hand calculation that does.

## 3. Which reference rate applies

- The reference rate is the Bank of England base rate in force on **30 June** (for interest that starts to run between 1 July and 31 December) or **31 December** (for interest that starts between 1 January and 30 June), immediately before interest starts ([Order 2002, article 4](${SOURCES.order})).
- Interest starts the day after the due date, and the rate is then **fixed for that debt** for as long as it's unpaid.
- The app has the official [Bank Rate history](${SOURCES.boe}) built in. If a debt needs a rate that isn't published yet, it shows interest at 8% only and tells you which date to look up. Add it under [Reference rates](/app/rates) once the Bank of England has published it, or type a rate on the invoice.

## 4. Fixed compensation

| Amount of the debt | Fixed sum |
| --- | --- |
| Under £1,000 | £40 |
| £1,000 to £9,999.99 | £70 |
| £10,000 or more | £100 |

- You can charge it once for each invoice, on top of interest ([section 5A](${SOURCES.act5A})).
- You can also claim reasonable costs of recovering the debt beyond this ([GOV.UK](${SOURCES.govCosts})). Take advice before you do.

## 5. Part payments

- Interest runs on the unpaid balance. Each payment you record reduces the balance from the day it arrived, so the app splits the interest at each payment date.
- The fixed sum is based on the invoice amount and doesn't change with part payments.

## 6. When the app doesn't calculate

- **Claim statutory interest unticked:** consumer sales, contracts that set their own late-payment interest, or invoices where you've decided not to claim. Interest and the fixed sum show £0.
- **Disputed invoices** still show figures, but the next action tells you to resolve the dispute first.
- **Written-off invoices** stop accruing.
- Check unusual cases with the [Small Business Commissioner's interest calculator](${SOURCES.sbc}).

${BILL_NOTE}

*${DISCLAIMER}*`;
}

export const POLICY_FIELDS = [
  { key: 'policy_owner', label: 'Who runs credit control day to day', type: 'text', max: 120, placeholder: 'e.g. Office manager', group: 'People' },
  { key: 'policy_approver', label: 'Who approves stops, plans and escalation', type: 'text', max: 120, placeholder: 'e.g. Managing director', group: 'People' },
  { key: 'policy_checks', label: 'Checks before giving credit', type: 'text', max: 300, placeholder: 'Companies House, two trade references and a credit check', group: 'Credit' },
  { key: 'policy_deposit', label: 'Until checks are done we ask for', type: 'text', max: 200, placeholder: 'a 50% deposit', group: 'Credit' },
  { key: 'policy_limit', label: 'Standard credit limit (£)', type: 'money', min: 0, group: 'Credit' },
  { key: 'policy_limit_review', label: 'Review credit limits every (months)', type: 'int', min: 1, max: 60, group: 'Credit' },
  { key: 'policy_deposit_over', label: 'Ask for a deposit on orders over (£)', type: 'money', min: 0, group: 'Terms' },
  { key: 'policy_deposit_pct', label: 'Deposit (%)', type: 'int', min: 0, max: 100, group: 'Terms' },
  { key: 'policy_query_days', label: 'Customers must raise invoice queries within (days)', type: 'int', min: 1, max: 60, group: 'Terms' },
  { key: 'policy_claim', label: 'Interest and compensation', type: 'select', options: ['We will claim', 'We may claim'], group: 'Recovery' },
  { key: 'policy_writeoff', label: 'Who can write off a debt', type: 'text', max: 120, placeholder: 'e.g. Managing director', group: 'Recovery' },
  { key: 'policy_review', label: 'Review this policy every (months)', type: 'int', min: 1, max: 60, group: 'Recovery' },
  { key: 'policy_retention', label: 'Include the optional ownership-of-goods clause', type: 'bool', group: 'Recovery' },
];

export function policy(s = {}, orgName = '') {
  const v = (k, fallback) => (s[k] === undefined || s[k] === null || s[k] === '' ? fallback : s[k]);
  const company = v('company_name', orgName || '[Company]');
  const terms = v('default_terms', 30);
  const approver = v('policy_approver', '[role]');
  const gbp = (n) => (n === '[amount]' ? n : Number(n).toLocaleString('en-GB', { maximumFractionDigits: 2 }));
  return `## What the law sets ([GOV.UK](${SOURCES.govWhenLate}))

- If you agree a payment date, it must usually be within **30 days** for public authorities or **60 days** for business transactions. A longer period between businesses must be fair to both.
- If no payment date is agreed, the payment is late **30 days** after the customer receives the invoice or the goods or services.
- On late business-to-business payments you can claim **statutory interest** of 8% plus the Bank of England reference rate, and a **fixed sum** of £40, £70 or £100 depending on the size of the debt.
- Consumer sales follow different rules.

## Part A · Internal credit policy

**1. Purpose.** This policy sets how ${company} gives credit to business customers and recovers overdue amounts.

**2. Who gets credit.** New customers get credit after ${v('policy_checks', '[checks: Companies House, references, credit check]')}. Until then we ask for ${v('policy_deposit', '[a 50% deposit / payment in advance]')}.

**3. Credit limits.** Standard limit £${gbp(v('policy_limit', '[amount]'))}. Higher limits need approval from ${approver}. Limits are reviewed every ${v('policy_limit_review', 6)} months.

**4. Standard terms.** Payment due ${terms} days from the invoice date. Different terms need ${approver}'s approval and must be confirmed in writing.

**5. Chasing.** We follow the Credit Control SOP and its escalation ladder. ${v('policy_owner', '[Role]')} runs it every week.

**6. Interest and compensation.** ${v('policy_claim', 'We [will / may] claim')} statutory interest and fixed compensation on overdue business invoices. Exceptions need ${approver}'s approval and are recorded in the chase log.

**7. Account stops.** We pause new work when an account is over its limit or has an invoice more than ${v('stop_days', 30)} days overdue, unless ${approver} agrees otherwise.

**8. Write-offs.** Debts can only be written off by ${v('policy_writeoff', '[role]')}, after the escalation ladder has been followed, and are recorded with a reason.

**9. Review.** This policy is reviewed every ${v('policy_review', 12)} months by ${approver}.

## Part B · Customer-facing payment terms

1. **Payment.** Invoices are payable within ${terms} days of the invoice date by bank transfer to the account shown on the invoice.
2. **Deposits.** For new customers or orders over £${gbp(v('policy_deposit_over', '[amount]'))}, we may ask for a deposit of ${v('policy_deposit_pct', '[x]')}% before work starts.
3. **Queries.** Please raise any query about an invoice within ${v('policy_query_days', 7)} days of receiving it. Undisputed amounts remain payable on the due date.
4. **Late payment.** If payment is late, we may claim interest and fixed compensation under the Late Payment of Commercial Debts (Interest) Act 1998, plus reasonable recovery costs.
5. **Suspension.** We may pause work or deliveries while any invoice is overdue, after giving you notice in writing.
6. **Credit limit.** We may set a credit limit for your account and ask for payment before further work if it is exceeded.${s.policy_retention ? '\n7. **Ownership of goods.** Goods remain our property until they are paid for in full. *(Ask your solicitor to check this clause.)*' : ''}

## Part C · Wording for invoices

> Payment due by [due date] (${terms} days from the invoice date). Please quote the invoice number with your payment. Late payments may incur interest and compensation under the Late Payment of Commercial Debts (Interest) Act 1998.

*Have a solicitor review the customer-facing terms before you use them. ${DISCLAIMER}*`;
}
