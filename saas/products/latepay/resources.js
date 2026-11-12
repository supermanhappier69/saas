// PaidOnTime records: customers, invoices, payments, the chase log, templates and reference rates.
// Invoices carry live figures (days overdue, interest, fixed sum, totals) and the next action from the chase ladder.
import { HttpError, addDays, round2, todayISO, fmtGBP } from '../../core/util.js';
import { html, badge } from '../../core/ui.js';
import { invoiceFigures, rateCheck, fmtShort } from './lib/calc.js';
import { nextAction, ladderFrom, LOG_STAGE_OPTIONS, STAGE_OPTIONS, stageForDays, stageLabel, whenLabel } from './lib/ladder.js';
import { DEFAULT_TEMPLATES, defaultTemplate } from './lib/templates.js';

export const CUSTOMER_TYPES = ['Limited company / LLP', 'Sole trader', 'Partnership', 'Public sector body', 'Charity or other organisation', 'Consumer (not a business)'];
export const CONSUMER = 'Consumer (not a business)';
export const INVOICE_STATUSES = ['Open', 'Disputed', 'On payment plan', 'Paid', 'Written off'];
const STATUS_TONES = { Open: 'blue', Disputed: 'orange', 'On payment plan': 'purple', Paid: 'green', 'Written off': 'gray' };
const CHANNELS = ['Email', 'Phone', 'Letter', 'In person', 'Text message', 'Other'];
const OUTCOMES = ['Sent', 'No response', 'Promise to pay', 'Paid', 'Dispute raised', 'Payment plan agreed', 'Wrong contact', 'Other'];
const today = (ctx) => todayISO(ctx.services.config?.TIMEZONE);
const isSettled = (row) => row.balance <= 0 || row.status === 'Paid';
const isLive = (row) => !isSettled(row) && row.status !== 'Written off';

/**
 * Everything the invoice figures need, loaded once per request. Keys start with "rel:" so the core clears
 * them whenever any record changes.
 */
export function base(ctx) {
  ctx.cache ||= {};
  if (ctx.cache['rel:latepay']) return ctx.cache['rel:latepay'];
  const { db } = ctx.services;
  const org = ctx.org.id;
  const group = (rows, key) => {
    const m = new Map();
    for (const r of rows) {
      if (!m.has(r[key])) m.set(r[key], []);
      m.get(r[key]).push(r);
    }
    return m;
  };
  const b = {
    today: today(ctx),
    L: ladderFrom(ctx.org.settings),
    payments: group(db.all('SELECT id, invoice, date, amount FROM r_payments WHERE org_id = ? ORDER BY date, id', org), 'invoice'),
    chases: group(db.all('SELECT id, invoice, date, channel, stage, outcome, next_follow_up, promised_date FROM r_chases WHERE org_id = ? ORDER BY date, id', org), 'invoice'),
    customers: new Map(db.all('SELECT * FROM r_customers WHERE org_id = ?', org).map((c) => [c.id, c])),
    rates: db.all('SELECT "from", rate FROM r_rates WHERE org_id = ?', org),
  };
  ctx.cache['rel:latepay'] = b;
  return b;
}

/** All invoices with their computed figures, cached per request. */
export function allInvoices(ctx) {
  ctx.cache ||= {};
  if (!ctx.cache['rel:invoices']) {
    const { resources } = ctx.services;
    ctx.cache['rel:invoices'] = resources.query(ctx, resources.get('invoices'), { all: true }).rows;
  }
  return ctx.cache['rel:invoices'];
}

function computeInvoice(row, ctx) {
  const b = base(ctx);
  const customer = b.customers.get(row.customer) || null;
  // Statutory interest never applies to consumers, even if the customer was switched to Consumer after the invoice was saved.
  const claim = Boolean(row.claim_interest) && customer?.customer_type !== CONSUMER;
  const fig = invoiceFigures({
    amount: row.amount, dueDate: row.due_date, today: b.today, payments: b.payments.get(row.id) || [], status: row.status,
    paidDate: row.paid_date, claim, rateOverride: row.rate_override, workspaceRates: b.rates,
  });
  const log = b.chases.get(row.id) || [];
  const next = nextAction({ ...row, customer_type: customer?.customer_type }, fig, log, { today: b.today, L: b.L });
  const rec = fig.settled ? null : stageForDays(fig.daysOverdue, fig.daysToDue, b.L);
  return {
    fig,
    next: { ...next, today: b.today },
    customer_type: customer?.customer_type || null,
    claim_on: claim,
    days_overdue: fig.daysOverdue,
    paid_total: fig.paid,
    balance: fig.balance,
    interest: fig.interest,
    daily_interest: fig.dailyInterest,
    fixed_sum: fig.fixedSum,
    total_due: fig.totalDue,
    ref_rate: fig.reference.rate,
    rate_check: rateCheck(fig.reference, { claim, daysOverdue: fig.daysOverdue }).text,
    stage_now: rec === null ? 'Not due yet' : stageLabel(rec),
    next_action: next.label,
    next_on: next.on,
    last_contact: log.length ? log[log.length - 1].date : null,
  };
}

export const nextBadge = (row) => {
  const n = row.next;
  if (!n) return '';
  const when = n.on && !['closed', 'paid-late'].includes(n.kind) ? html` <span class="muted small">${whenLabel(n.on, n.today)}</span>` : '';
  return html`${badge(n.label, n.now || ['closed', 'paid-late'].includes(n.kind) ? n.tone : 'gray')}${when}`;
};

function creditCheck(c, invoices, stopDays) {
  const live = invoices.filter(isLive);
  const outstanding = round2(live.reduce((s, i) => s + i.balance, 0));
  const overdueList = live.filter((i) => i.days_overdue > 0);
  const overdue = round2(overdueList.reduce((s, i) => s + i.balance, 0));
  const oldest = overdueList.reduce((m, i) => Math.max(m, i.days_overdue), 0);
  const paid = invoices.filter((i) => i.fig.settled && i.fig.settledOn);
  const avgLate = paid.length ? round2(paid.reduce((s, i) => s + i.days_overdue, 0) / paid.length) : null;
  let check = 'OK';
  let tone = 'green';
  if (c.credit_limit !== null && c.credit_limit !== undefined && outstanding > c.credit_limit) {
    check = 'Over credit limit';
    tone = 'red';
  } else if (oldest > stopDays) {
    check = `Over ${stopDays} days overdue`;
    tone = 'red';
  } else if (overdue > 0) {
    check = 'Overdue balance';
    tone = 'orange';
  }
  return {
    outstanding, overdue, overdue_count: overdueList.length, oldest_overdue: oldest || null, avg_days_late: avgLate, credit_check: check, credit_tone: tone,
    claimable: round2(live.reduce((s, i) => s + i.fig.claimable, 0)),
    stop_suggested: tone === 'red' && c.account_status !== 'On stop',
  };
}

const money = (key, label, extra = {}) => ({ key, label, type: 'money', ...extra });

export function buildResources() {
  const customers = {
    name: 'customers',
    label: 'Customers',
    singular: 'Customer',
    description: 'Who owes you money, their terms and their credit limit.',
    emptyText: 'Add the businesses you invoice, with their payment terms and credit limit.',
    titleField: 'name',
    defaultSort: { key: 'overdue', dir: 'desc' },
    columns: ['name', 'customer_type', 'outstanding', 'overdue', 'credit_limit', 'credit_check', 'account_status'],
    fields: [
      { key: 'name', label: 'Legal name', type: 'text', required: true, search: true, max: 160, help: 'As registered at Companies House, or the trader\'s own name.', example: 'Brightside Joinery Ltd' },
      { key: 'customer_type', label: 'Customer type', type: 'select', required: true, options: CUSTOMER_TYPES, default: CUSTOMER_TYPES[0], filter: true, help: 'Statutory interest only applies to business customers. Debts owed by sole traders follow the Pre-Action Protocol before court.' },
      { key: 'company_number', label: 'Company number', type: 'text', max: 20, search: true },
      { key: 'contact_name', label: 'Accounts contact', type: 'text', max: 120, help: 'The person who approves or pays invoices.', group: 'Contact' },
      { key: 'accounts_email', label: 'Accounts email', type: 'email', search: true, group: 'Contact', example: 'accounts@example.co.uk' },
      { key: 'phone', label: 'Phone', type: 'phone', group: 'Contact' },
      { key: 'address', label: 'Registered address', type: 'textarea', rows: 3, max: 600, group: 'Contact' },
      { key: 'terms_days', label: 'Payment terms (days)', type: 'int', min: 0, max: 365, default: (ctx) => Number(ctx.org?.settings?.default_terms ?? 30), group: 'Credit', example: '30' },
      { key: 'credit_limit', label: 'Credit limit', type: 'money', min: 0, group: 'Credit', example: '5000' },
      { key: 'risk', label: 'Risk rating', type: 'select', options: ['Low', 'Medium', 'High'], tones: { Low: 'green', Medium: 'orange', High: 'red' }, filter: true, group: 'Credit' },
      { key: 'account_status', label: 'Account status', type: 'select', options: ['Active', 'On stop', 'Closed'], default: 'Active', tones: { Active: 'green', 'On stop': 'red', Closed: 'gray' }, filter: true, group: 'Credit' },
      { key: 'notes', label: 'Notes', type: 'textarea', rows: 3, max: 4000 },
    ],
    computedFields: [
      money('outstanding', 'Outstanding'),
      money('overdue', 'Overdue'),
      { key: 'overdue_count', label: 'Overdue invoices', type: 'int' },
      { key: 'oldest_overdue', label: 'Oldest overdue (days)', type: 'int' },
      { key: 'avg_days_late', label: 'Average days late (paid invoices)', type: 'number', dp: 1 },
      money('claimable', 'Interest and compensation claimable'),
      { key: 'credit_check', label: 'Credit check', type: 'text', render: (row) => badge(row.credit_check, row.credit_tone) },
    ],
    views: [
      { id: 'overdue', label: 'Overdue', filter: (row) => row.overdue > 0 },
      { id: 'watch', label: 'Over limit or long overdue', filter: (row) => row.credit_tone === 'red' },
      { id: 'stop', label: 'On stop', filter: (row) => row.account_status === 'On stop' },
    ],
    prepare(list, ctx) {
      const byCustomer = new Map();
      for (const i of allInvoices(ctx)) {
        if (!byCustomer.has(i.customer)) byCustomer.set(i.customer, []);
        byCustomer.get(i.customer).push(i);
      }
      ctx.cache['rel:by-customer'] = byCustomer;
    },
    compute(row, ctx) {
      return creditCheck(row, ctx.cache['rel:by-customer']?.get(row.id) || [], Number(ctx.org.settings?.stop_days ?? 30));
    },
    rowClass: (row) => (row.credit_tone === 'red' ? 'row-danger' : null),
    actions: [
      { id: 'statement', label: 'Statement', href: (row) => `/app/customers/${row.id}/statement`, show: (row) => row.outstanding > 0 || row.claimable > 0 },
      {
        id: 'stop', label: 'Put on stop', confirm: 'Put this account on stop? Remember to tell the customer in writing.', show: (row) => row.account_status !== 'On stop',
        run: (ctx, row) => {
          ctx.services.resources.update(ctx, ctx.services.resources.get('customers'), row.id, { account_status: 'On stop' });
          return { flash: 'Account put on stop. Tell the customer in writing before pausing work.' };
        },
      },
      {
        id: 'unstop', label: 'Take off stop', show: (row) => row.account_status === 'On stop',
        run: (ctx, row) => {
          ctx.services.resources.update(ctx, ctx.services.resources.get('customers'), row.id, { account_status: 'Active' });
          return { flash: 'Account is active again.' };
        },
      },
    ],
  };

  const invoices = {
    name: 'invoices',
    label: 'Invoices',
    singular: 'Invoice',
    description: 'Every unpaid invoice with its figures and next action.',
    emptyText: 'Add your unpaid invoices, or import them from your accounting software as a CSV.',
    titleField: 'number',
    defaultView: 'unpaid',
    defaultSort: { key: 'days_overdue', dir: 'desc' },
    columns: ['number', 'customer', 'due_date', 'balance', 'days_overdue', 'status', 'next_action'],
    fields: [
      { key: 'number', label: 'Invoice number', type: 'text', required: true, search: true, max: 60, example: 'INV-1042' },
      { key: 'customer', label: 'Customer', type: 'ref', ref: 'customers', required: true, filter: true, relatedLabel: 'Invoices', example: 'Brightside Joinery Ltd' },
      { key: 'invoice_date', label: 'Invoice date', type: 'date', required: true, default: (ctx) => today(ctx), example: '01/09/2026' },
      { key: 'due_date', label: 'Due date', type: 'date', help: 'The agreed payment date. Leave blank to use the customer\'s payment terms.', example: '01/10/2026' },
      { key: 'amount', label: 'Amount (including VAT)', type: 'money', required: true, min: 0.01, example: '2400.00' },
      { key: 'status', label: 'Status', type: 'select', options: INVOICE_STATUSES, default: 'Open', required: true, tones: STATUS_TONES, filter: true },
      { key: 'claim_interest', label: 'Claim statutory interest', type: 'bool', default: true, help: 'Untick for consumer sales, or if your contract sets its own late-payment interest.', group: 'Late payment' },
      { key: 'rate_override', label: 'Reference rate override (%)', type: 'percent', min: 0, max: 25, help: 'Leave blank: the app uses the Bank of England rate that applies to this debt.', group: 'Late payment' },
      { key: 'promised_date', label: 'Promised payment date', type: 'date', group: 'Late payment' },
      { key: 'paid_date', label: 'Paid date', type: 'date', help: 'Filled in for you when payments cover the invoice.', group: 'Late payment' },
      { key: 'description', label: 'Goods or services', type: 'text', max: 200, search: true, group: 'Reference' },
      { key: 'po_ref', label: 'Order or contract reference', type: 'text', max: 100, search: true, group: 'Reference' },
      { key: 'notes', label: 'Notes', type: 'textarea', rows: 3, max: 4000, group: 'Reference' },
    ],
    computedFields: [
      { key: 'days_overdue', label: 'Days overdue', type: 'int' },
      money('paid_total', 'Paid so far'),
      money('balance', 'Balance'),
      { key: 'ref_rate', label: 'Reference rate', type: 'percent' },
      money('interest', 'Statutory interest to date'),
      money('daily_interest', 'Daily interest'),
      money('fixed_sum', 'Fixed compensation'),
      money('total_due', 'Total due (balance, interest and compensation)'),
      { key: 'rate_check', label: 'Rate check', type: 'text' },
      { key: 'stage_now', label: 'Chase stage', type: 'select', options: ['Not due yet', ...STAGE_OPTIONS], filter: true },
      { key: 'next_action', label: 'Next action', type: 'text', render: (row) => nextBadge(row) },
      { key: 'next_on', label: 'Next action date', type: 'date' },
      { key: 'last_contact', label: 'Last contact', type: 'date' },
    ],
    views: [
      { id: 'unpaid', label: 'Unpaid', filter: isLive },
      { id: 'now', label: 'To chase now', filter: (row) => isLive(row) && row.next.now },
      { id: 'overdue', label: 'Overdue', filter: (row) => isLive(row) && row.days_overdue > 0 },
      { id: 'week', label: 'Due this week', filter: (row) => isLive(row) && row.fig.daysToDue !== null && row.fig.daysToDue >= 0 && row.fig.daysToDue <= 7 },
      { id: 'promises', label: 'Promises', filter: (row) => isLive(row) && Boolean(row.promised_date) },
      { id: 'broken', label: 'Broken promises', filter: (row) => isLive(row) && row.next.kind === 'broken' },
      // Matches the dashboard's "You can claim" total: open invoices, plus settled ones that were paid late.
      { id: 'claim', label: 'Claimable', filter: (row) => row.fig.claim && row.fig.claimable > 0 && (isLive(row) || row.next.kind === 'paid-late') },
      { id: 'disputed', label: 'Disputed', filter: (row) => row.status === 'Disputed' && !isSettled(row) },
      { id: 'plans', label: 'Payment plans', filter: (row) => row.status === 'On payment plan' && !isSettled(row) },
      { id: 'paid', label: 'Paid', filter: isSettled },
    ],
    compute: (row, ctx) => computeInvoice(row, ctx),
    rowClass: (row) => (isSettled(row) || row.status === 'Written off' ? 'row-muted' : row.status === 'Disputed' ? 'row-warn' : row.next.now && row.next.tone === 'red' ? 'row-danger' : null),
    check(values, ctx, existing) {
      const errors = {};
      const { db } = ctx.services;
      if (values.number) {
        const dup = db.get('SELECT id FROM r_invoices WHERE org_id = ? AND lower(number) = lower(?) AND id != ?', ctx.org.id, values.number, existing?.id ?? 0);
        if (dup) errors.number = 'Another invoice already has this number.';
      }
      if (values.due_date && values.invoice_date && values.due_date < values.invoice_date) errors.due_date = 'The due date can\'t be before the invoice date.';
      const cust = values.customer ? db.get('SELECT customer_type FROM r_customers WHERE org_id = ? AND id = ?', ctx.org.id, values.customer) : null;
      if (values.claim_interest && cust?.customer_type === CONSUMER) errors.claim_interest = 'Statutory interest only applies to business customers. Untick this for consumer sales.';
      return errors;
    },
    beforeSave(values, { ctx, existing }) {
      const merged = { ...(existing || {}), ...values };
      if (!merged.due_date && merged.invoice_date && merged.customer) {
        const c = ctx.services.db.get('SELECT terms_days FROM r_customers WHERE org_id = ? AND id = ?', ctx.org.id, merged.customer);
        values.due_date = addDays(merged.invoice_date, Number(c?.terms_days ?? ctx.org.settings?.default_terms ?? 30));
      }
      if (values.status === 'Paid' && !merged.paid_date) values.paid_date = today(ctx);
      if (values.status && values.status !== 'Paid' && existing?.status === 'Paid' && !('paid_date' in values)) values.paid_date = null;
      return values;
    },
    // Changing the amount can leave an invoice paid when payments no longer cover it, or cover it when it was open.
    afterSave(row, { ctx, before }) {
      if (before && Number(before.amount) !== Number(row.amount)) syncInvoice(ctx, row.id);
    },
    actions: [
      { id: 'compose', label: 'Send reminder', variant: 'primary', href: (row) => `/app/invoices/${row.id}/compose`, show: isLive },
      { id: 'pay', label: 'Record payment', href: (row) => `/app/payments/new?invoice=${row.id}&amount=${row.balance.toFixed(2)}`, show: isLive },
      { id: 'log', label: 'Log a contact', href: (row) => `/app/chases/new?invoice=${row.id}&stage=${encodeURIComponent(row.next?.stage !== null && row.next?.stage !== undefined ? stageLabel(row.next.stage) : '')}`, show: isLive },
      {
        id: 'dispute', label: 'Mark disputed', show: (row) => isLive(row) && row.status !== 'Disputed',
        run: (ctx, row) => {
          ctx.services.resources.update(ctx, ctx.services.resources.get('invoices'), row.id, { status: 'Disputed' });
          return { flash: 'Marked as disputed. Ask for the undisputed part to be paid now.' };
        },
      },
      {
        id: 'resolve', label: 'Dispute resolved', show: (row) => row.status === 'Disputed',
        run: (ctx, row) => {
          ctx.services.resources.update(ctx, ctx.services.resources.get('invoices'), row.id, { status: 'Open' });
          return { flash: 'Back to Open. The ladder picks up at the stage that matches the days overdue.' };
        },
      },
      {
        id: 'writeoff', label: 'Write off', role: 'admin', variant: 'ghost', confirm: 'Write this invoice off? It stops appearing in the chase list.', show: isLive,
        run: (ctx, row) => {
          ctx.services.resources.update(ctx, ctx.services.resources.get('invoices'), row.id, { status: 'Written off' });
          return { flash: 'Invoice written off.' };
        },
      },
    ],
  };

  const payments = {
    name: 'payments',
    label: 'Payments',
    singular: 'Payment',
    description: 'Money received against invoices, including part payments and instalments.',
    emptyText: 'Record payments from an invoice. Part payments reduce the interest from the day they arrive.',
    titleField: 'date',
    defaultSort: { key: 'date', dir: 'desc' },
    columns: ['date', 'invoice', 'amount', 'method', 'reference'],
    rowLabel: (row) => `${fmtGBP(row.amount)} on ${fmtShort(row.date)}`,
    fields: [
      { key: 'invoice', label: 'Invoice', type: 'ref', ref: 'invoices', required: true, onDelete: 'cascade', filter: true, relatedLabel: 'Payments', example: 'INV-1042' },
      { key: 'date', label: 'Date received', type: 'date', required: true, default: (ctx) => today(ctx), example: '15/10/2026' },
      { key: 'amount', label: 'Amount', type: 'money', required: true, min: 0.01, example: '1200.00' },
      { key: 'method', label: 'Method', type: 'select', options: ['Bank transfer', 'Card', 'Direct debit', 'Cheque', 'Cash', 'Other'], default: 'Bank transfer' },
      { key: 'reference', label: 'Reference', type: 'text', max: 100, search: true },
      { key: 'notes', label: 'Notes', type: 'textarea', rows: 2, max: 2000 },
    ],
    check(values, ctx, existing) {
      const errors = {};
      // A future date would reduce the balance today while the interest still runs, so the two figures would disagree.
      if (values.date && values.date > today(ctx)) errors.date = 'The date received can\'t be in the future.';
      const inv = values.invoice ? ctx.services.db.get('SELECT amount, status FROM r_invoices WHERE org_id = ? AND id = ?', ctx.org.id, values.invoice) : null;
      if (!inv || !values.amount) return errors;
      const others = ctx.services.db.get('SELECT COALESCE(SUM(amount), 0) AS s FROM r_payments WHERE org_id = ? AND invoice = ? AND id != ?', ctx.org.id, values.invoice, existing?.id ?? 0).s;
      const left = round2(inv.amount - others);
      if (values.amount > left + 0.004) errors.amount = left > 0 ? `Only ${fmtGBP(left)} is still owed on this invoice.` : 'This invoice is already fully paid.';
      return errors;
    },
    afterSave(row, { ctx, before }) {
      syncInvoice(ctx, row.invoice);
      // A payment moved to another invoice must also update the invoice it left.
      if (before && before.invoice !== row.invoice) syncInvoice(ctx, before.invoice, { removed: before });
    },
    afterDelete: (row, { ctx }) => syncInvoice(ctx, row.invoice, { removed: row }),
    afterCreate: (row) => `/app/invoices/${row.invoice}`,
  };

  const chases = {
    name: 'chases',
    label: 'Chase log',
    singular: 'Chase log entry',
    description: 'Every reminder, call and letter, with outcomes and promised dates.',
    emptyText: 'Emails sent from the app are logged here automatically. Log calls and letters as you make them.',
    titleField: 'date',
    defaultSort: { key: 'date', dir: 'desc' },
    columns: ['date', 'invoice', 'channel', 'stage', 'outcome', 'next_follow_up'],
    rowLabel: (row) => `${row.invoice__label || 'Invoice'} · ${String(row.stage || row.channel || 'contact').replace(/^\d · /, '').toLowerCase()}`,
    fields: [
      { key: 'invoice', label: 'Invoice', type: 'ref', ref: 'invoices', required: true, onDelete: 'cascade', filter: true, relatedLabel: 'Chase log', example: 'INV-1042' },
      { key: 'date', label: 'Date', type: 'date', required: true, default: (ctx) => today(ctx) },
      { key: 'channel', label: 'Channel', type: 'select', options: CHANNELS, default: 'Phone', required: true, filter: true },
      { key: 'stage', label: 'Stage', type: 'select', options: LOG_STAGE_OPTIONS, filter: true, tones: Object.fromEntries(LOG_STAGE_OPTIONS.map((s, i) => [s, ['blue', 'blue', 'orange', 'orange', 'red', 'red', 'red', 'orange', 'purple', 'gray'][i]])) },
      { key: 'outcome', label: 'Outcome', type: 'select', options: OUTCOMES, filter: true, help: 'Promise to pay, Dispute raised and Payment plan agreed update the invoice for you.' },
      { key: 'contact', label: 'Spoke to or sent to', type: 'text', max: 160 },
      { key: 'promised_date', label: 'Promised payment date', type: 'date' },
      { key: 'next_follow_up', label: 'Next follow-up', type: 'date' },
      { key: 'notes', label: 'Notes', type: 'textarea', rows: 3, max: 4000 },
      { key: 'template', label: 'Template', type: 'text', form: false, max: 40 },
      { key: 'outbox_id', label: 'Email', type: 'int', form: false, hidden: true, noImport: true },
    ],
    check(values, ctx) {
      const errors = {};
      if (values.date && values.date > today(ctx)) errors.date = 'The date can\'t be in the future. Use "Next follow-up" to plan ahead.';
      if (values.outcome === 'Promise to pay' && !values.promised_date) errors.promised_date = 'Enter the date they promised to pay by, so the invoice can be checked then.';
      return errors;
    },
    afterSave(row, { ctx, created }) {
      if (!created) return;
      const { resources } = ctx.services;
      const inv = resources.get('invoices');
      const current = resources.one(ctx.org.id, inv, row.invoice);
      if (!current || current.status === 'Paid' || current.status === 'Written off') return;
      if (row.outcome === 'Promise to pay' && row.promised_date) resources.patch(ctx, inv, row.invoice, { promised_date: row.promised_date });
      if (row.outcome === 'Dispute raised') resources.patch(ctx, inv, row.invoice, { status: 'Disputed' });
      if (row.outcome === 'Payment plan agreed') resources.patch(ctx, inv, row.invoice, { status: 'On payment plan', ...(row.promised_date ? { promised_date: row.promised_date } : {}) });
    },
    afterCreate: (row) => `/app/invoices/${row.invoice}`,
  };

  const templates = {
    name: 'templates',
    label: 'Templates',
    singular: 'Template',
    description: 'Your chasing emails, letters and phone script. Edit the wording to sound like you.',
    titleField: 'name',
    defaultSort: { key: 'code', dir: 'asc' },
    columns: ['code', 'name', 'channel', 'stage', 'review'],
    import: false,
    check(values, ctx, existing) {
      const clash = values.code && ctx.services.db.get('SELECT id FROM r_templates WHERE org_id = ? AND lower(code) = lower(?) AND id != ?', ctx.org.id, values.code, existing?.id ?? 0);
      return clash ? { code: 'Another template already uses this number.' } : {};
    },
    fields: [
      { key: 'code', label: 'Number', type: 'text', required: true, max: 20, help: 'Templates 0 to 5 match the chase stages.' },
      { key: 'name', label: 'Name', type: 'text', required: true, max: 120 },
      { key: 'channel', label: 'Sent as', type: 'select', options: ['Email', 'Letter', 'Phone script'], default: 'Email', required: true },
      { key: 'stage', label: 'Chase stage', type: 'select', options: STAGE_OPTIONS },
      { key: 'subject', label: 'Subject', type: 'text', max: 300, wide: true },
      { key: 'body', label: 'Wording', type: 'textarea', rows: 18, max: 20000, wide: true, required: true, help: 'Merge fields in [square brackets] are filled in from the invoice, customer and Settings.' },
      { key: 'review', label: 'Needs solicitor review before first use', type: 'bool' },
      { key: 'complete_only', label: 'Complete plan', type: 'bool', form: false, detail: false, noImport: true },
    ],
    actions: [
      {
        id: 'restore', label: 'Restore original wording', confirm: 'Replace this wording with the original template?', show: (row) => Boolean(defaultTemplate(row.code)),
        run: (ctx, row) => {
          const d = defaultTemplate(row.code);
          ctx.services.resources.update(ctx, ctx.services.resources.get('templates'), row.id, { subject: d.subject, body: d.body });
          return { flash: 'Original wording restored.' };
        },
      },
    ],
  };

  const rates = {
    name: 'rates',
    label: 'Reference rates',
    singular: 'Reference rate',
    nav: false,
    navId: 'guides',
    description: 'Bank of England base rates you have looked up yourself. The app already knows every published rate; add one here only when it asks you to.',
    titleField: 'from',
    defaultSort: { key: 'from', dir: 'desc' },
    columns: ['from', 'rate', 'checked_by'],
    rowLabel: (row) => `From ${fmtShort(row.from)}: ${row.rate}%`,
    fields: [
      { key: 'from', label: 'For debts that become late from', type: 'date', required: true, help: '1 January (uses the rate on 31 December) or 1 July (uses the rate on 30 June).' },
      { key: 'rate', label: 'Bank of England base rate (%)', type: 'percent', required: true, min: 0, max: 25 },
      { key: 'checked_by', label: 'Checked on / by', type: 'text', max: 120 },
      { key: 'notes', label: 'Notes', type: 'text', max: 300 },
    ],
    check(values, ctx, existing) {
      if (values.from && !/-(01-01|07-01)$/.test(values.from)) return { from: 'Choose 1 January or 1 July.' };
      if (values.from && ctx.services.db.get('SELECT id FROM r_rates WHERE org_id = ? AND "from" = ? AND id != ?', ctx.org.id, values.from, existing?.id ?? 0)) return { from: 'You already have a rate for this period.' };
      return {};
    },
  };

  return [customers, invoices, payments, chases, templates, rates];
}

/** Keeps an invoice's status and paid date in step with its payments. */
export function syncInvoice(ctx, invoiceId, { removed = null } = {}) {
  const { resources, db } = ctx.services;
  const r = resources.get('invoices');
  const inv = resources.one(ctx.org.id, r, invoiceId);
  if (!inv) return;
  const pays = db.all('SELECT date, amount FROM r_payments WHERE org_id = ? AND invoice = ? ORDER BY date, id', ctx.org.id, inv.id);
  const total = round2(pays.reduce((s, p) => s + p.amount, 0));
  if (pays.length && total >= round2(inv.amount)) {
    if (inv.status !== 'Paid' || inv.paid_date !== pays[pays.length - 1].date) {
      resources.patch(ctx, r, inv.id, { status: 'Paid', paid_date: pays[pays.length - 1].date });
      ctx.audit?.('update', 'invoices', inv.id, `Invoice “${inv.number}” paid in full`);
    }
  } else if (inv.status === 'Paid' && (pays.length || (removed && removed.date === inv.paid_date))) {
    // Payments no longer cover the invoice. With none left, only reopen it when its Paid status came from the payment just removed.
    resources.patch(ctx, r, inv.id, { status: 'Open', paid_date: null });
  }
}

/** Templates every workspace starts with (not sample data, so they survive "Remove sample data"). */
export function seedTemplates(ctx) {
  const { resources } = ctx.services;
  const r = resources.get('templates');
  for (const t of DEFAULT_TEMPLATES) resources.create(ctx, r, t, { quiet: true });
}

/** The workspace's template for a code, falling back to the built-in wording. */
export function templateFor(ctx, code) {
  const { db } = ctx.services;
  const row = db.get('SELECT * FROM r_templates WHERE org_id = ? AND code = ? ORDER BY id LIMIT 1', ctx.org.id, String(code));
  const d = defaultTemplate(code);
  if (!row) return d ? { ...d, id: null } : null;
  return { ...row, complete_only: Boolean(row.complete_only ?? d?.complete_only), review: Boolean(row.review) };
}

export const requireFound = (v, what = 'Page') => {
  if (!v) throw new HttpError(404, `${what} not found`);
  return v;
};
