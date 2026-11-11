// Fictional SAMPLE data: the v0.9 kit's four customers and eight invoices, plus one payment plan,
// with dates relative to today so the chase ladder always shows every case.
import { addDays } from '../../../core/util.js';

export function seedSamples(ctx, today) {
  const { resources } = ctx.services;
  const R = (n) => resources.get(n);
  const d = (n) => addDays(today, n);
  const make = (name, values) => resources.create(ctx, R(name), values, { sample: true, quiet: true });
  const cust = (name, extra) => make('customers', {
    name, contact_name: 'Accounts team', notes: 'Fictional sample customer.', account_status: 'Active', ...extra,
  });

  const brightside = cust('SAMPLE · Brightside Joinery Ltd', { customer_type: 'Limited company / LLP', accounts_email: 'accounts@b-sample.example', terms_days: 30, credit_limit: 5000, risk: 'Low', address: '1 Sample Yard, Leeds LS1 0AA' });
  const northgate = cust('SAMPLE · Northgate Events Ltd', { customer_type: 'Limited company / LLP', accounts_email: 'accounts@n-sample.example', terms_days: 30, credit_limit: 3000, risk: 'High', address: '2 Sample Street, Manchester M1 0AA' });
  const patel = cust('SAMPLE · J. Patel (sole trader)', { customer_type: 'Sole trader', accounts_email: 'accounts@p-sample.example', terms_days: 14, credit_limit: 1500, risk: 'Medium', contact_name: 'Jay Patel', address: '3 Sample Road, Leicester LE1 0AA' });
  const harbour = cust('SAMPLE · Harbour Dental LLP', { customer_type: 'Limited company / LLP', accounts_email: 'accounts@h-sample.example', terms_days: 45, credit_limit: 8000, risk: 'Low', address: '4 Sample Quay, Bristol BS1 0AA' });
  const kestrel = cust('SAMPLE · Kestrel IT Services Ltd', { customer_type: 'Limited company / LLP', accounts_email: 'accounts@k-sample.example', terms_days: 30, credit_limit: 6000, risk: 'Medium', address: '5 Sample Park, Reading RG1 0AA' });

  const inv = (number, customer, invoiceDate, dueDate, amount, extra = {}) => make('invoices', {
    number, customer: customer.id, invoice_date: d(invoiceDate), due_date: d(dueDate), amount, claim_interest: true, status: 'Open', ...extra,
  });
  const i1001 = inv('INV-1001', brightside, -71, -41, 2400, { description: 'Kitchen fit-out, phase 1', promised_date: d(-23), notes: 'Promised payment by phone; promise broken.' });
  const i1002 = inv('INV-1002', northgate, -47, -17, 850, { description: 'Stage hire' });
  const i1003 = inv('INV-1003', northgate, -93, -63, 12500, { description: 'Summer event production', notes: 'Over credit limit.' });
  inv('INV-1004', patel, -22, -8, 640, { description: 'Shop signage', notes: 'Sole trader: the Pre-Action Protocol for Debt Claims applies before any court claim.' });
  inv('INV-1005', harbour, -44, 1, 3150, { description: 'Practice refurbishment' });
  const i1006 = inv('INV-1006', brightside, -88, -58, 1200, { description: 'Site survey' });
  const i1007 = inv('INV-1007', harbour, -62, -17, 980, { description: 'Emergency call-out', status: 'Disputed', notes: 'Customer disputes 2 hours of call-out time.' });
  const i1008 = inv('INV-1008', patel, -37, -23, 300, { description: 'Logo design' });
  const i1009 = inv('INV-1009', kestrel, -80, -50, 4800, { description: 'Network upgrade', notes: 'Payment plan: 3 monthly instalments of £1,600. Interest waived if the plan is kept.' });

  const pay = (invoice, date, amount, extra = {}) => make('payments', { invoice: invoice.id, date: d(date), amount, method: 'Bank transfer', ...extra });
  pay(i1006, -42, 1200, { reference: 'BRIGHTSIDE 1006' });
  pay(i1008, -24, 300, { reference: 'PATEL 1008' });
  pay(i1009, -20, 1600, { reference: 'KESTREL PLAN 1/3' });

  const log = (invoice, date, values) => make('chases', { invoice: invoice.id, date: d(date), ...values });
  log(i1001, -39, { channel: 'Email', stage: '1 · Friendly reminder', outcome: 'No response', next_follow_up: d(-32), template: '1' });
  log(i1001, -30, { channel: 'Phone', stage: '2 · Firm reminder and call', outcome: 'Promise to pay', promised_date: d(-23), next_follow_up: d(-23), notes: 'Promised payment in full by phone.' });
  log(i1002, -14, { channel: 'Email', stage: '1 · Friendly reminder', outcome: 'No response', next_follow_up: d(-7), template: '1' });
  log(i1003, -33, { channel: 'Letter', stage: '3 · Final notice', outcome: 'No response', next_follow_up: d(-19), template: '3' });
  log(i1007, -15, { channel: 'Email', stage: 'Dispute', outcome: 'Dispute raised', next_follow_up: d(-8), notes: 'Credit note under review.' });
  log(i1009, -21, { channel: 'Phone', stage: 'Payment plan', outcome: 'Payment plan agreed', promised_date: d(10), next_follow_up: d(11), notes: '3 × £1,600 monthly. First instalment received.' });
}
