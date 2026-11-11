# Build status

Updated: 11 Nov 2026, 22:30 (Europe/London)

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
- Demo workspaces never send email: the mailer logs them with provider "demo".
- Core end-to-end tests in `saas/test/core-flow.test.js`: 15 of 15 passing.

## Next
1. Core public assets: core.css, core.js, print.css, favicon.svg.
2. More core tests (CSV edge cases, file uploads, jobs, Stripe webhook signatures).
3. PaidOnTime (`products/latepay`): definition, chase ladder, statutory interest calculator, templates, dashboard, tests.
4. LetCheck (`products/landlord`).
5. SOPHub (`products/sops`).
6. Screenshots, system update pack, final top-20 file.
7. The Simple page.
8. Final test run and final zip.

## Checkpoints
- checkpoint-01-plan-and-top20.zip
- saas-checkpoint-2a-core-in-progress.zip
- saas-checkpoint-2b-ui-layer.zip
- saas-checkpoint-2c-app-pages.zip
- saas-checkpoint-2d-app-server-tested.zip

## House rules
- Nothing goes live before Founder Launch Approval.
- Sample data is fictional and marked SAMPLE. Test rows are marked QA-TEST.
- Legal wording is general information and needs a solicitor's review before launch.
- Demo workspaces never send real email. Test billing (ALLOW_FAKE_BILLING) must be off in production.

## Run the tests
```
cd saas
node --no-warnings --test test/core-flow.test.js
```
