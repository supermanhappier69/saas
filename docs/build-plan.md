# Build plan: top 3 opportunities as working SaaS

Rebuilt 11 November 2026 from the recovered Sprint 1 record (morning-brief-recovered-work.zip).

## What was recovered

- The original brief: understand the Research & Commercial Intelligence system, write a simple
  top-20 file, build the top 3 ideas as full working SaaS, update the system, and make a page
  called **Simple** listing the finished SaaS products and the top 10 SaaS products.
- The founder's correction: rank by **overall score**, not by ease of launch.
- The ranking, the three product specifications (v1.0), templates, the numbers guide, QA results
  and research excerpts (Bank of England, Late Payment Order 2002, HSE gas safety, GOV.UK
  electrical safety, Renters' Rights Act roadmap).
- Fragments of the earlier shared SaaS core (util, db, http, mailer, pages). The full source was
  never exported, so everything is rebuilt here from scratch and re-tested.

## The three builds (by overall score)

| # | Opportunity | Score | SaaS name | Folder |
| --- | --- | --- | --- | --- |
| 1 | UK late payment & credit control kit | 76 | PaidOnTime | saas/products/latepay |
| 2 | UK landlord compliance & portfolio OS | 74 | LetCheck | saas/products/landlord |
| 3 | SOP library + done-for-you SOP writing | 72 | SOPHub | saas/products/sops |

## Architecture

- Node.js 22.13+ / 24 with **zero third-party dependencies**: built-in `node:sqlite`, `node:http`,
  `node:crypto`, `node:test`.
- One shared core (`saas/core`): auth, sessions, CSRF, roles, invites, password reset, API keys,
  audit log, rate limits, security headers, outbox email (log / Resend / Postmark), Stripe billing
  (Checkout + signed webhooks), file uploads, background jobs, CSV import/export, data export,
  landing page, legal pages, printable documents, demo workspace.
- A resource framework: each product declares its records and fields; the core creates tables,
  validation, API routes, CSV import/export and the list/form/detail screens.
- Each product adds its own domain logic, dashboards and documents.

## Checkpoints

1. Recovery analysis, build plan, top-20 file.
2. Shared core + PaidOnTime working with tests.
3. LetCheck working with tests.
4. SOPHub working with tests, screenshots, system update pack, final top-20 file.
