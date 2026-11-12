# Launch guide: from this repository to a live product for under £10 a month

This is the cheapest sensible setup. Everything is a single small server with a SQLite database on a persistent disk.

## 1. Accounts you need (all free to open)

| Account | Why | Cost |
| --- | --- | --- |
| A domain registrar (e.g. Cloudflare Registrar) | `paidontime.co.uk` or similar | about £10 a year |
| [Fly.io](https://fly.io) | hosting with a persistent volume | about £3–£5 a month |
| [Stripe](https://stripe.com) | payments | per transaction only |
| [Resend](https://resend.com) | sending reminder emails and the Monday digest | free tier (3,000 emails a month) |
| GitHub | this repository; CI runs the tests on every push | free |

## 2. Deploy to Fly.io

```sh
# once
curl -L https://fly.io/install.sh | sh
fly auth signup
cd saas
fly launch --no-deploy --copy-config --name paidontime   # uses fly.toml and the Dockerfile
fly volumes create data --size 1 --region lhr
fly secrets set APP_SECRET="$(openssl rand -base64 48)" BASE_URL="https://paidontime.fly.dev" \
  NODE_ENV=production TRUST_PROXY=1 FOUNDER_EMAILS="you@yourdomain.co.uk" \
  CONTACT_TO="you@yourdomain.co.uk" SUPPORT_EMAIL="you@yourdomain.co.uk"
fly deploy

# every later release
fly deploy
```

Then add your domain (`fly certs add paidontime.co.uk`, point the DNS where it tells you, and change `BASE_URL`).

The daily job (Monday chase-list email, trial clean-up) runs inside the server every 15 minutes, so no cron is needed.

## 3. Email

In Resend: add and verify your domain, create an API key, then:

```sh
fly secrets set RESEND_API_KEY="re_..." MAIL_FROM="PaidOnTime <hello@paidontime.co.uk>"
```

Until this is set, emails are saved in Activity → Emails instead of being sent, so you can test safely.

## 4. Payments

In Stripe (live mode): create one product, "PaidOnTime", with two **one-off** prices, £49 (Core) and £99 (Complete). Then create a webhook endpoint for `https://your-domain/billing/webhook` with the events `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`, and:

```sh
fly secrets set STRIPE_SECRET_KEY="sk_live_..." STRIPE_WEBHOOK_SECRET="whsec_..." \
  STRIPE_PRICE_CORE="price_..." STRIPE_PRICE_COMPLETE="price_..."
```

Never set `ALLOW_FAKE_BILLING` in production.

## 5. Before you take money

- [ ] Solicitor review of Templates 3–5, the payment plan agreement, the policy's customer-facing terms, and the Terms and Privacy pages (replace the `[placeholders]`).
- [ ] Decide the refund policy and put it in the terms.
- [ ] Set `ALLOW_INDEXING=1` so Google can index the public pages (the app pages are always excluded).
- [ ] Open `/app/founder` as the founder email and work through the launch checklist.

## 6. Running it

- Backups: `fly ssh console -C "sqlite3 /data/latepay.db '.backup /data/backup.db'"` then `fly sftp get /data/backup.db`. Do it weekly until it is worth automating.
- Bank Rate changes: edit `products/latepay/lib/rates.js` after each Monetary Policy Committee decision (next: 17 December 2026) and deploy.
- Logs: `fly logs`.
- Tests: `npm test` (also run by GitHub Actions on every push).

## 7. If Fly.io doesn't suit you

Any host that runs a Docker container with a persistent disk works: Railway (volumes), Render (paid instance with a disk), a £4 VPS with Docker. The container needs `DATA_DIR=/data` on the disk and the environment variables above.
