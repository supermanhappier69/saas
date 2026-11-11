// Default chasing templates (from the v0.9 kit, with unambiguous merge fields) and the merge values for an invoice.
import { addDays, fmtDateUK } from '../../../core/util.js';

const money = (n) => (Number(n) || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const MERGE_FIELDS = [
  'Contact name', 'Customer legal name', 'Customer address', 'Invoice number', 'Invoice date', 'Amount', 'Balance', 'Due date', 'Days overdue',
  'Interest', 'Daily interest', 'Fixed sum', 'Reference rate', 'Total', 'Pay by date', 'Deadline', 'Today', 'Reminder dates',
  'Promised date', 'Order reference', 'Goods or services', 'Bank details', 'Payment link', 'Your name', 'Company', 'Company address', 'Phone',
  'Instalment schedule',
];

export const DEFAULT_TEMPLATES = [
  {
    code: '0', name: 'Pre-due reminder', channel: 'Email', stage: '0 · Pre-due reminder', review: false, complete_only: false,
    subject: 'Invoice [Invoice number] due on [Due date]',
    body: `Hi [Contact name],

A quick heads-up that invoice [Invoice number] for £[Amount] is due on [Due date]. You can pay by bank transfer to [Bank details] or online at [Payment link].

If anything on the invoice needs correcting, just let me know now so it doesn't hold up payment.

Thanks,
[Your name]
[Company]`,
  },
  {
    code: '1', name: 'Friendly reminder', channel: 'Email', stage: '1 · Friendly reminder', review: false, complete_only: false,
    subject: 'Invoice [Invoice number] is now overdue',
    body: `Hi [Contact name],

Our records show that invoice [Invoice number] for £[Amount], due on [Due date], is still unpaid. It may simply have been missed, so I've attached a copy.

Could you let me know when payment will be made? Our bank details are [Bank details].

If you've already paid, please send me the remittance details and I'll update our records.

Thanks,
[Your name]
[Company]`,
  },
  {
    code: '2', name: 'Firm reminder and call', channel: 'Email', stage: '2 · Firm reminder and call', review: false, complete_only: false,
    subject: 'Second reminder: invoice [Invoice number], £[Balance], [Days overdue] days overdue',
    body: `Hi [Contact name],

I haven't yet received payment of invoice [Invoice number] for £[Amount]. It was due on [Due date] and is now [Days overdue] days overdue.

Please arrange payment within 7 days, by [Pay by date]. If there's a problem with the invoice or with timing, call me on [Phone] and we'll sort it out.

Thanks,
[Your name]
[Company]`,
  },
  {
    code: 'call', name: 'Phone script', channel: 'Phone script', stage: '2 · Firm reminder and call', review: false, complete_only: false,
    subject: 'Call about invoice [Invoice number]',
    body: `1. Confirm you're speaking to the person who approves or pays invoices.
2. "I'm calling about invoice [Invoice number] for £[Balance], which was due on [Due date]. Has it been approved for payment?"
3. If yes: "When will it be paid, and how?" Get a specific date and amount.
4. Confirm it back: "So that's £[Balance] by [date]. I'll email you to confirm."
5. If there's a problem: "Which part is in question? Can the rest be paid now?"
6. Log the call in the chase log and add any promised payment date.`,
  },
  {
    code: '3', name: 'Final notice', channel: 'Email', stage: '3 · Final notice', review: true, complete_only: false,
    subject: 'Final notice: invoice [Invoice number], £[Balance]',
    body: `Dear [Contact name],

Invoice [Invoice number] for £[Amount], due on [Due date], is still unpaid despite our reminders of [Reminder dates].

Please pay the full balance of £[Balance] by [Pay by date]. If we don't receive payment by then, we intend to claim statutory interest and fixed compensation under the Late Payment of Commercial Debts (Interest) Act 1998 [and to pause further work on your account].

If you believe the invoice is wrong, please tell me in writing by [Pay by date].

Yours sincerely,
[Your name], [Company]`,
  },
  {
    code: '4', name: 'Interest and compensation claim', channel: 'Email', stage: '4 · Claim interest and compensation', review: true, complete_only: true,
    subject: 'Claim for late payment interest and compensation: invoice [Invoice number]',
    body: `Dear [Contact name],

Invoice [Invoice number] for £[Amount] was due on [Due date] and is now [Days overdue] days overdue.

Under the Late Payment of Commercial Debts (Interest) Act 1998 we are entitled to claim:

- statutory interest at 8% a year above the Bank of England reference rate of [Reference rate]%. This is £[Interest] to date and is increasing by £[Daily interest] a day; and
- fixed compensation of £[Fixed sum] towards the cost of recovering the debt.

The total now due is £[Total]. Please pay it by [Pay by date].

If we don't receive payment, we will consider further steps to recover the debt, which may include a formal letter before action.

Yours sincerely,
[Your name], [Company]`,
  },
  {
    code: '5', name: 'Letter before action', channel: 'Letter', stage: '5 · Letter before action', review: true, complete_only: true,
    subject: 'Unpaid invoice [Invoice number]: £[Total]',
    body: `**[Company]**
[Company address]

[Today]

**To:** [Customer legal name], [Customer address]
**Re:** Unpaid invoice [Invoice number]: £[Total]

Dear [Contact name],

We supplied [Goods or services] to you under [Order reference] and invoiced you on [Invoice date]. Payment of £[Amount] was due on [Due date]. Despite our reminders of [Reminder dates], it remains unpaid.

The amount now due is:

| Item | Amount |
| --- | --- |
| Invoice [Invoice number] (balance) | £[Balance] |
| Statutory interest to [Today] (8% + [Reference rate]% reference rate) | £[Interest] |
| Fixed compensation | £[Fixed sum] |
| **Total** | **£[Total]** |

Interest continues to build up at £[Daily interest] a day.

Unless we receive payment in full, or an acceptable written proposal for payment, by [Deadline], we intend to start court proceedings to recover the debt, interest and costs without further notice.

If you dispute the debt, please tell us in writing by [Deadline], giving your reasons and copies of any documents you rely on.

Yours faithfully,
[Your name], [Company]`,
  },
  {
    code: 'plan', name: 'Payment plan agreement', channel: 'Letter', stage: '', review: true, complete_only: true,
    subject: 'Payment plan for invoice [Invoice number]',
    body: `**[Company]**
[Company address]

[Today]

**To:** [Customer legal name], [Customer address]
**Re:** Payment plan for invoice [Invoice number]

Dear [Contact name],

Thank you for agreeing a plan to pay the £[Balance] still owed on invoice [Invoice number], which was due on [Due date].

We have agreed that you will pay these instalments by bank transfer to [Bank details]:

[Instalment schedule]

If every instalment arrives on time, we will not claim statutory interest or compensation on this invoice. If an instalment is missed, the full balance becomes payable at once and we may claim statutory interest and fixed compensation under the Late Payment of Commercial Debts (Interest) Act 1998.

Please sign and return a copy of this letter to confirm.

Yours sincerely,
[Your name], [Company]

Signed for [Customer legal name]: ______________________  Date: __________`,
  },
];

export const defaultTemplate = (code) => DEFAULT_TEMPLATES.find((t) => t.code === String(code)) || null;

/** Monthly instalments that add up exactly to the balance. */
export function instalments(balance, count, firstDate) {
  const n = Math.max(1, Math.min(24, Math.floor(Number(count) || 1)));
  const pence = Math.round(Number(balance) * 100);
  const each = Math.floor(pence / n);
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = i === n - 1 ? pence - each * (n - 1) : each;
    const [y, m, d] = firstDate.split('-').map(Number);
    const total = y * 12 + (m - 1) + i;
    const ny = Math.floor(total / 12);
    const nm = total - ny * 12;
    const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
    out.push({ date: `${ny}-${String(nm + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`, amount: p / 100 });
  }
  return out;
}

/** Values for every merge field, from the invoice, its customer, its chase log and the workspace settings. */
export function mergeValues({ org, user, inv, customer, fig, log = [], today, plan = null }) {
  const s = org.settings || {};
  const reminders = log.filter((x) => ['Email', 'Letter', 'Phone'].includes(x.channel) && x.date).map((x) => x.date).sort();
  const soleTrader = customer?.customer_type === 'Sole trader';
  return {
    'Contact name': customer?.contact_name || '',
    'Customer legal name': customer?.name || '',
    'Customer address': (customer?.address || '').replace(/\n+/g, ', '),
    'Invoice number': inv.number,
    'Invoice date': fmtDateUK(inv.invoice_date, true),
    Amount: money(fig.amount),
    Balance: money(fig.balance),
    'Due date': fmtDateUK(inv.due_date, true),
    'Days overdue': String(fig.daysOverdue),
    Interest: money(fig.interest),
    'Daily interest': money(fig.dailyInterest),
    'Fixed sum': money(fig.fixedSum),
    'Reference rate': fig.reference.rate === null ? '' : String(fig.reference.rate),
    Total: money(fig.totalDue),
    'Pay by date': fmtDateUK(addDays(today, 7), true),
    // Sole traders are covered by the Pre-Action Protocol for Debt Claims, which allows 30 days to reply.
    Deadline: fmtDateUK(addDays(today, soleTrader ? 30 : 14), true),
    Today: fmtDateUK(today, true),
    'Reminder dates': reminders.length ? listDates(reminders) : '',
    'Promised date': inv.promised_date ? fmtDateUK(inv.promised_date, true) : '',
    'Order reference': inv.po_ref || '',
    'Goods or services': inv.description || '',
    'Bank details': s.bank_details ? s.bank_details.replace(/\n+/g, ', ') : '',
    'Payment link': s.payment_link || '',
    'Your name': s.sender_name || user?.name || '',
    Company: s.company_name || org.name,
    'Company address': s.address || '',
    Phone: s.phone || '',
    'Instalment schedule': plan ? plan.map((p, i) => `${i + 1}. £${money(p.amount)} by ${fmtDateUK(p.date, true)}`).join('\n') : '',
  };
}

function listDates(dates) {
  const f = dates.map((d) => fmtDateUK(d));
  return f.length === 1 ? f[0] : `${f.slice(0, -1).join(', ')} and ${f[f.length - 1]}`;
}

/** Merge fields left in [brackets] after merging, so the sender can see what still needs filling in. */
export const unfilled = (text) => [...new Set([...String(text).matchAll(/\[([^[\]\n]{1,60})\]/g)].map((m) => m[1]))];
