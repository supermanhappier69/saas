# PaidOnTime: UK Late Payment & Credit Control Kit (working app)

PaidOnTime turns the v0.9 Notion kit into a working app on the shared core. It is for UK businesses with 1–50 staff that invoice other businesses on credit terms. It runs the whole chasing process, not just the interest maths:

- **Chase calendar**: every unpaid invoice gets a next action and a date, from a pre-due reminder to a letter before action. There is a chase list grouped by day, a board by stage, a private iCalendar feed for Google, Outlook or Apple, and a Monday email to admins.
- **Templates 0–5, a phone script and a payment plan agreement**, filled in from the invoice, customer and settings. Users review and send them as emails (logged automatically) or print them as letters. Fields that are still unfilled are flagged before sending.
- **What you can claim**: statutory interest at 8% plus the Bank of England reference rate, with the correct rate built in, part payments handled and the £40/£70/£100 fixed sum.
- **Credit control**: customers with credit limits, risk, credit check, account stops, customer statements, disputes, promises and payment plans.
- **Credit policy builder**: an internal credit policy, customer payment terms and invoice wording, written from a few answers.
- **Guides**: Start here, the Credit Control SOP (filled in with the workspace's names and timings), How the numbers work, and a monthly review report.
- **Public pages**: a landing page, pricing, a free interest calculator (lead magnet) and a **waitlist** for the demand test.

General information based on UK government guidance, not legal advice. Nothing goes live before Founder Launch Approval.

## Run it

```sh
cd saas
npm run latepay                       # http://localhost:3101
ALLOW_FAKE_BILLING=1 npm run latepay  # lets you switch plans without Stripe (development only)
node products/latepay/server.js --run-jobs   # daily jobs once (Monday chase-list email), for cron
node products/latepay/server.js --waitlist   # print the waitlist as CSV
```

Production needs `APP_SECRET`, `BASE_URL`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_CORE`, `STRIPE_PRICE_COMPLETE` (one-time Stripe prices), and `RESEND_API_KEY` or `POSTMARK_TOKEN` with `MAIL_FROM`. See `core/app.js` for the rest.

## Plans (price hypotheses, not validated)

| | Core £49 one-off | Complete £99 one-off |
| --- | --- | --- |
| Customers, invoices, payments, chase log, chase calendar, Monday email | ✓ | ✓ |
| Interest and compensation worked out | ✓ | ✓ |
| Templates 0–3 and the phone script, SOP and guides | ✓ | ✓ |
| Templates 4–5 (interest claim, letter before action), payment plan agreement | | ✓ |
| Customer statements, credit policy builder, monthly review | | ✓ |
| Team members | 2 | 5 |

New workspaces get a 14-day trial of Complete. One-off plans use Stripe Checkout in payment mode (a core change; monthly plans are unchanged).

## How the figures work

- **Days overdue**: from the due date to today, or to the day the invoice was paid in full. A blank due date defaults to the invoice date plus the customer's payment terms.
- **Reference rate**: the Bank of England Bank Rate in force on 30 June (interest starting 1 Jul–31 Dec) or 31 December (interest starting 1 Jan–30 Jun) immediately before interest starts. It is **fixed for the life of the debt** ([2002 Order, article 4](https://www.legislation.gov.uk/uksi/2002/1675/article/4/made)). This corrects the v0.9 kit's caveat about debts spanning several rate periods.
- **Built-in rates**: the official Bank Rate history is in `lib/rates.js`, checked 11 Nov 2026. If a rate isn't published yet, interest is shown at 8% only and the app names the date to look up. Users can add it under Reference rates or type a rate on the invoice. **When the Bank changes Bank Rate, add the change to `BANK_RATE_CHANGES` and move `RATES_CHECKED_THROUGH` forward.**
- **Interest**: balance × (8 + rate) ÷ 100 × days ÷ 365, simple interest. Each recorded payment reduces the balance from the day it arrived.
- **Fixed sum**: £40 under £1,000, £70 under £10,000, £100 otherwise, once per invoice, based on the invoice amount.
- **Not claimed**: invoices with "Claim statutory interest" unticked (required for consumer customers), and written-off invoices.

## Chase ladder (defaults, editable in Settings)

| Days overdue | Next action | Template |
| --- | --- | --- |
| Due within 3 days | Pre-due reminder | 0 |
| 1–7 | Friendly reminder | 1 |
| 8–14 | Firm reminder and call | 2 + phone script |
| 15–30 | Final notice | 3 |
| 31–45 | Claim interest and compensation | 4 |
| 46+ | Letter before action (Pre-Action Protocol flagged for sole traders) | 5 |

Disputes, broken promises, payment plans and follow-up dates from the chase log override the ladder. Once a stage is done, the next stage is scheduled for the day it starts.

## Files

- `definition.js`: plans, settings, navigation, routes, landing page copy, sample data and the Monday job.
- `resources.js`: customers, invoices, payments, chase log, templates and reference rates, with computed figures and hooks.
- `lib/`: `calc.js` (figures), `rates.js` (Bank Rate history), `ladder.js` (next actions), `templates.js`, `docs.js` (guides and policy), `sample.js`.
- `pages/`: `app.js` (dashboard, chase list and board, calendar feed, compose and send, letters, statements, reports) and `guides.js` (guides, policy, calculator, waitlist).
- `test/`: `calc.test.js` (the GOV.UK example, the v0.9 QA-TEST rows, band edges, rates, part payments, ladder) and `flow.test.js` (end to end over HTTP).

## Before launch (founder decisions and checks)

1. **Demand test**: send people to `/waitlist` (and `/calculator`), or hold 5–10 buyer conversations. The waitlist asks what they would pay.
2. **Solicitor review** of Templates 3–5, the payment plan agreement, the policy's Part B and the terms and privacy drafts.
3. Decide the refund policy (the terms show a placeholder), the company details, and how an upgrade from Core to Complete is priced. Stripe currently charges the full Complete price.
4. Create the two one-time Stripe prices and set the environment variables above. Turn off `ALLOW_FAKE_BILLING`.
5. Keep `lib/rates.js` up to date after each Monetary Policy Committee change. The next is due 17 Dec 2026, and the 31 Dec 2026 rate will be needed from 1 Jan 2027.
