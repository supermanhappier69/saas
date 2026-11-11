# Build status

Updated: 11 Nov 2026, 23:30 (Europe/London)

## Goal
Understand the Research & Commercial Intelligence system, write a simple top-20 file, build the top 3 ideas (ranked by overall score) as full working SaaS products, update the system, and make a page called **Simple** listing the finished SaaS products and the top 10.

## Done
- Plan and top-20 file (checkpoint 01).
- Shared core in `saas/core/` (no dependencies; Node 22.13+ with node:sqlite):
  - util, markdown, db, http, auth, mailer, billing, files, jobs
  - resources, resource-csv, ui, layout, crud, api
  - workspace: settings, API keys, JSON export, delete workspace, account, password, sessions
  - team: invitations, roles, leaving, removing people
  - billing-pages: plans, Stripe checkout and portal, test billing, webhook, activity log, email log
  - pages: landing page, pricing, sign up, log in, password reset, invitations, demo, contact, terms, privacy, robots.txt, health check
  - app: config, services, routing, sessions, API keys, CSRF, body parsing, read-only access, response protocol, scheduled jobs, CLI (`--run-jobs`)
  - public assets: core.css, core.js, print.css, favicon.svg
  - one-off plans (`oneOff: true`): Stripe Checkout in payment mode, "one-off" pricing and matching terms
- Demo workspaces never send email: the mailer logs them with provider "demo".
- **PaidOnTime (`saas/products/latepay`), the UK Late Payment & Credit Control Kit as a working app.** It has a chase calendar (list, board, iCalendar feed, Monday email), templates 0–5 with a phone script and a payment plan agreement, and send-and-log. It works out statutory interest with the Bank of England reference rate built in, handles part payments and the fixed sum, and has credit checks and account stops. It also has customer statements, a credit policy builder, guides, a monthly review, a free public calculator and a waitlist. See `saas/products/latepay/README.md`.
- Tests: 42 passing (`cd saas && npm test`). That is 17 core, 9 calculation (including the GOV.UK example and the v0.9 QA-TEST rows) and 16 PaidOnTime end-to-end.

## Next
1. PaidOnTime launch gates (founder): waitlist test or 5–10 buyer conversations, solicitor review of Templates 3–5 and the policy, refund policy, Stripe one-time prices.
2. LetCheck (`products/landlord`).
3. SOPHub (`products/sops`).
4. Screenshots, system update pack, final top-20 file.
5. The Simple page.
6. Final test run and final zip.

## Checkpoints
- checkpoint-01-plan-and-top20.zip
- saas-checkpoint-2a-core-in-progress.zip
- saas-checkpoint-2b-ui-layer.zip
- saas-checkpoint-2c-app-pages.zip
- saas-checkpoint-2d-app-server-tested.zip
- PaidOnTime (this repository)

## House rules
- Nothing goes live before Founder Launch Approval.
- Sample data is fictional and marked SAMPLE. QA-TEST rows from the Notion kit now live in automated tests instead.
- Legal wording is general information and needs a solicitor's review before launch.
- Demo workspaces never send real email. Test billing (ALLOW_FAKE_BILLING) must be off in production.

## Run the tests
```
cd saas
npm test
```
