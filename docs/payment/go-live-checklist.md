# Billing and payments: go-live checklist

What has to be set up before billing goes live in an environment: settings, database scripts, and the Razorpay setup. Tick each item with the date and your initials (`- [x] … (2026-11-20, VA)`).

**Keep it current.** When a feature adds a setting, a script or a Razorpay step, add it here in the same change.

> `.env-prod` in this repo is not the production configuration. Check each setting where the production secrets live. Settings are read at startup, so **restart the service after changing any of them**.

---

## 1. Environment variables

### Invoices

If any of these is missing or wrong, the service still starts, but invoice calls answer `503 BILLING_NOT_CONFIGURED` and the startup log names the problem.

| Variable | Value | Done |
|---|---|---|
| `BILLING_SUPPLIER_LEGAL_NAME` | Our legal entity name as printed on invoices | [ ] |
| `BILLING_SUPPLIER_EMAIL` | Billing contact email | [ ] |
| `BILLING_SUPPLIER_STREET`, `_CITY`, `_PROVINCE`, `_POSTAL_CODE`, `_COUNTRY` | Registered address | [ ] |
| `BILLING_SUPPLIER_GSTIN` | Our GSTIN. Must start with the state code | [ ] |
| `BILLING_SUPPLIER_PAN` | Our PAN. Must match characters 3–12 of the GSTIN | [ ] |
| `BILLING_SUPPLIER_STATE_CODE` | `29` (Karnataka). Decides CGST + SGST or IGST | [ ] |
| `BILLING_SAC_CODE` | Agreed with Finance (likely `998314`) | [ ] |
| `BILLING_INVOICE_PREFIX` | `HS` (1–8 capital letters or digits) | [ ] |
| `BILLING_SUPPLIER_CIN` | Optional | [ ] |
| `BILLING_SUPPLIER_LUT_ARN` | LUT ARN, required on Global (export) invoices | [ ] |

### Razorpay

| Variable | Value | Done |
|---|---|---|
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | Production: Live keys (`rzp_live_…`). Staging and local: Test keys (`rzp_test_…`) | [ ] |
| `RAZORPAY_WEBHOOK_SECRET` | Optional. The same value as the webhook secret in the Razorpay Dashboard (§3.2). Without it, payments are still picked up by polling, just more slowly | [ ] |
| `BILLING_CHECKOUT_NAME` | Name shown in the checkout popup. Default `Hypersign` | [ ] |

### Redis

| Variable | Value | Done |
|---|---|---|
| `REDIS_URL`, or `REDIS_HOST` + `REDIS_PORT` | The environment's Redis. The payment reconciliation job uses these. **`CREDIT_REDIS_URL` alone is not enough**: the job ignores it and falls back to `localhost:6379` | [ ] |

### Switches

Turn these on in this order, one at a time.

| Variable | Value | Done |
|---|---|---|
| `BILLING_ENABLED_REGIONS` | `IN`, later `IN,GLOBAL`. Empty means billing is off (`503 BILLING_DISABLED`) | [ ] |
| `BILLING_PAY_ENABLED` | `true` turns on Pay, Collect payment and the reconciliation job | [ ] |
| `BILLING_INVOICED_GRANTS` | `true` once super admins use the new recharge page. ID Service credits can then only be granted through invoices | [ ] |

### Existing (check only)

| Variable | Why it matters for billing | Done |
|---|---|---|
| `SUPER_ADMIN_EMAILS_IDS` | Only these users can issue Free credits and Already paid invoices and create payment links | [ ] |

## 2. Database scripts

The scripts are in [scripts/](scripts/). Run them in mongosh after `use <db>`. **They are committed with `DRY_RUN = false`**: set it to `true` for the first run, review the output, then set it back to `false`. Start the service once, before or after the scripts, so Mongoose creates the indexes.

- [ ] [1-seed-price-books-and-coupons.js](scripts/1-seed-price-books-and-coupons.js): price book v1 (India and Global plans) and the FOUNDING8 and FOUNDING15 coupons. Every environment needs it, including a fresh database. Safe to run again.
- [ ] [2-backfill-kyb-approved-at.js](scripts/2-backfill-kyb-approved-at.js): sets `companyVerificationApprovedAt` for organisations approved before the billing release. Only needed on a database that already has organisations. The dates are approximate, so review the list first.
- [ ] [3-staging-test-account.js](scripts/3-staging-test-account.js): **staging only. Never run it on production.**
- [ ] Check: `GET /api/v1/billing/catalog` for an Indian account and for a Global account returns the expected plans and prices.

## 3. Razorpay setup

Do this in the right mode: **Live** for production, **Test** for staging and local.

### 3.1 Account (Live only)

- [ ] The account is activated (KYC done) and the settlement bank account is verified.
- [ ] **International payments** are enabled (Global customers pay in USD).
- [ ] **Payment capture: automatic** (Account & Settings › Payment capture).
- [ ] Payment methods enabled: cards, UPI, netbanking, wallets.
- [ ] Business name, logo and support email are set. The checkout and payment link emails show them.
- [ ] Live API keys generated and put in `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`.

### 3.2 Webhook (optional, recommended)

With the webhook, payments are picked up within seconds. Without it, the server polls Razorpay every 5 minutes (checkout) and every 15 minutes (payment links).

| Environment | Mode | URL | Done |
|---|---|---|---|
| Local | Test | `https://<ngrok url>/api/v1/billing/webhooks/razorpay` | Verified 2026-11-09 |
| Staging | Test | `https://<staging api host>/api/v1/billing/webhooks/razorpay` | [ ] |
| Production | Live | `https://<production api host>/api/v1/billing/webhooks/razorpay` | [ ] |

- [ ] Generate a secret with `openssl rand -hex 32`. Use a different one per environment, and never the API key secret.
- [ ] Put it in `RAZORPAY_WEBHOOK_SECRET` and restart the service.
- [ ] Razorpay Dashboard › Account & Settings › Webhooks › **Add New Webhook**:
  - **URL:** from the table above
  - **Secret:** the same value as `RAZORPAY_WEBHOOK_SECRET`
  - **Alert email:** a team inbox someone reads
  - **Events:** `payment.authorized`, `payment.captured`, `payment.failed`, `order.paid`, `payment_link.paid`, `payment_link.partially_paid`, `payment_link.expired`, `payment_link.cancelled`
- [ ] If a WAF or IP allowlist sits in front of the API, let Razorpay through. Don't add Razorpay to `ALLOWED_ORIGIN`: the endpoint is authenticated by the signature.
- [ ] Verify: make a payment, or **Resend** an event. Razorpay's webhook logs show **200**, and `db.webhookEvents.find().sort({ receivedAt: -1 }).limit(1)` shows `status: 'PROCESSED'`.

If deliveries fail:

| Razorpay shows | Fix |
|---|---|
| `400` | The two secrets don't match, or the service wasn't restarted after a change |
| `503` | `RAZORPAY_WEBHOOK_SECRET` isn't set on the server |
| `404` | Wrong URL, or the deployed build has no webhook endpoint |
| `403` or a timeout | Something in front of the API is blocking Razorpay |
