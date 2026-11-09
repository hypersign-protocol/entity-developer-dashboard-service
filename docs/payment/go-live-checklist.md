# Billing and payments: go-live checklist

Everything that has to be true before billing and payments are switched on in production, in the order to do it. Tick each item and add the date and your initials (`- [x] … (2026-11-20, VA)`). An item that doesn't apply gets ~~struck through~~ with the reason.

The design is in [credits-top-up-payment.md](credits-top-up-payment.md), the API formats in [api-contract.md](api-contract.md), and the build progress in [epics.md](epics.md). This list only covers what's needed to **go live**: settings, accounts, data, sign-offs, tests and the switch-on itself.

**Keep it current.** When a feature adds a setting, a script, a Razorpay Dashboard step or a manual step, add it here in the same change.

> The `.env-prod` file in this repo is not the production configuration: it has none of the billing settings. Check each setting where production secrets actually live.

---

## 1. Business and Finance sign-offs

Open questions from [credits-top-up-payment.md §13](credits-top-up-payment.md#13-open-questions-for-business-and-finance). The ones marked **blocker** must be answered before the stage they block is switched on.

- [ ] **Q3, blocker for Global invoices:** Finance approves the zero-rated export wording on Global invoices, and confirms a LUT is filed. Its ARN goes in `BILLING_SUPPLIER_LUT_ARN` (§3).
- [ ] **Q14, blocker for India invoices:** is our turnover above the e-invoicing threshold? If yes, Indian B2B invoices need an IRN and QR code, which isn't built.
- [ ] **Q15, blocker for Free credits:** a ₹0 tax invoice is the right document for complimentary credits.
- [ ] **Q13:** controls on **Already paid** and **Free credits** invoices. Any super admin can create them in v1; confirm the audit trail is enough, or agree a limit.
- [ ] **Q5, blocker for refunds only:** refund policy. Until it's decided, refunds are done by hand in the Razorpay Dashboard and noted for Finance.
- [ ] **Q7:** KYB approval required before buying, or only for FOUNDING coupons (as built)?
- [ ] **Q9:** coupons apply after the plan discount (as built). Is there a maximum discount?
- [ ] **Q20:** only `Approved` KYB counts for coupons (as built).
- [ ] Prices in price book v1 ([scripts/1-seed-price-books-and-coupons.js](scripts/1-seed-price-books-and-coupons.js)) and the FOUNDING8 / FOUNDING15 coupon terms are signed off.

## 2. Razorpay account (Live mode)

- [ ] The Live account is activated (KYC done) and the settlement bank account is verified.
- [ ] **International payments** are enabled on the Live account. Global customers pay in USD.
- [ ] **Payment capture: automatic** (Account & Settings › Payment capture). The server also captures as a fallback, but an uncaptured payment is refunded after 3 days.
- [ ] The payment methods we want are enabled (cards, UPI, netbanking, wallets).
- [ ] Business name, logo and support email are set. Payment link emails and the checkout show them.
- [ ] **Live API keys** are generated (`rzp_live_…`) and stored only in the production secrets.
- [ ] The Razorpay webhook is set up and verified in Live mode (§2.1).

### 2.1 Razorpay webhook

Optional but recommended: payments are picked up within seconds instead of on the next check. Without the webhook, payments still work: the server checks Razorpay every 5 minutes (checkout) and every 15 minutes (payment links). Details are in [api-contract.md §6.5](api-contract.md#65-webhooks-post-apiv1billingwebhooksrazorpay).

Do this once per environment. Test mode and Live mode each have their own webhooks and secrets.

| Environment | Razorpay mode | URL | Status |
|---|---|---|---|
| Local | Test | `https://<ngrok url>/api/v1/billing/webhooks/razorpay` (changes on every ngrok restart) | Verified 2026-11-09: Razorpay showed 200 |
| Staging | Test | `https://<staging api host>/api/v1/billing/webhooks/razorpay` | [ ] |
| Production | Live | `https://<production api host>/api/v1/billing/webhooks/razorpay` | [ ] |

**Set up:**
- [ ] Make a new random secret, at least 32 characters (for example `openssl rand -hex 32`). Use a different secret in each environment, and never the API key secret.
- [ ] Put it in the environment's secrets as `RAZORPAY_WEBHOOK_SECRET`.
- [ ] **Restart the service.** Settings are read only at startup, and watch mode doesn't reload `.env`. A secret changed without a restart gives `400` on every delivery.
- [ ] Razorpay Dashboard, in the right mode (Test or Live) › Account & Settings › Webhooks › **Add New Webhook**:
  - **Webhook URL:** from the table above
  - **Secret:** exactly the same value as `RAZORPAY_WEBHOOK_SECRET`
  - **Alert email:** a team inbox someone reads. Razorpay writes to it when deliveries keep failing
  - **Active events:** `payment.authorized`, `payment.captured`, `payment.failed`, `order.paid`, `payment_link.paid`, `payment_link.partially_paid`, `payment_link.expired`, `payment_link.cancelled`. Other events are answered with 200 and dropped
- [ ] Nothing in front of the API blocks Razorpay (§4). The app itself needs no allowlist: the route has no JWT and no origin check, and the signature is what authenticates it. Don't add Razorpay to `ALLOWED_ORIGIN`.

**Verify:**
- [ ] Startup log: no `webhook secret isn't set` warning.
- [ ] Make a payment (a test payment, or a real small one in Live mode), or **Resend** an earlier event from Razorpay's webhook logs.
- [ ] Razorpay's webhook logs show **200** for the delivery. Razorpay doesn't show our response body, so a 200 is all you see there.
- [ ] `db.webhookEvents.find().sort({ receivedAt: -1 }).limit(5)`: the event's `status` is `PROCESSED`. `IGNORED` with `ORDER_NOT_FOUND` means the payment isn't one of our orders (for example a payment made directly in the Razorpay Dashboard). `FAILED` has the reason in `error`.
- [ ] Logs: `[OrderService] Order ORD-… fulfilled: …` within seconds of the payment, not minutes later.
- [ ] Resend the same event: still 200, `attempts` goes up, and nothing else happens.

**If deliveries fail:**

| Razorpay shows | Cause | Fix |
|---|---|---|
| `400` | The secret differs between Razorpay and the server, or the server wasn't restarted after the secret changed. Log: `[PaymentWebhook] Rejected a razorpay webhook with a bad signature` | Make the two secrets match, then restart |
| `503` | `RAZORPAY_WEBHOOK_SECRET` isn't set on the server | Set it, then restart |
| `404` | The build doesn't have the webhook endpoint, or the URL is wrong | Deploy the current build and check the path |
| `403`, or a timeout | Something in front of the API (WAF, ingress, allowlist) is blocking Razorpay | Let Razorpay through (§4) |
| An ngrok error page | The tunnel is down, or its URL changed | Restart ngrok and update the URL in Razorpay |

**Rotating the secret:** change it in Razorpay and in `RAZORPAY_WEBHOOK_SECRET` together, then restart. Deliveries in between get `400`, and Razorpay retries them. The 5-minute check covers anything that's lost.

## 3. Production settings

Billing reads these at startup or on each request. Missing invoice settings don't stop the service: invoice calls answer `503 BILLING_NOT_CONFIGURED`, and the missing ones are logged at startup.

| Setting | Value | When | Done |
|---|---|---|---|
| `BILLING_SUPPLIER_LEGAL_NAME`, `_EMAIL`, `_STREET`, `_CITY`, `_PROVINCE`, `_POSTAL_CODE`, `_COUNTRY`, `_GSTIN`, `_PAN` | Our legal entity as printed on invoices | Before stage A | [ ] Reported set on 2026-11-01 (§13 Q17); check it again |
| `BILLING_SUPPLIER_STATE_CODE` | `29` (Karnataka). Without it, Indian quotes show one "GST 18%" line instead of CGST + SGST or IGST | Before stage A | [ ] |
| `BILLING_SAC_CODE` | Agreed with Finance (likely `998314`) | Before stage A | [ ] |
| `BILLING_INVOICE_PREFIX` | The invoice number prefix (`HS`) | Before stage A | [ ] |
| `BILLING_SUPPLIER_CIN` | Optional | Before stage A | [ ] |
| `BILLING_SUPPLIER_LUT_ARN` | The LUT ARN for export invoices (Q3) | Before Global invoices | [ ] |
| `BILLING_ENABLED_REGIONS` | `IN`, then `IN,GLOBAL`. Empty: billing endpoints answer `503 BILLING_DISABLED` | The switch, §8 | [ ] |
| `BILLING_INVOICED_GRANTS` | `true` once the new recharge page is live: ID Service credits can then only be granted through invoices | Stage D | [ ] |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | **Live** keys (`rzp_live_…`). Never test keys in production, never live keys in staging | Before stage B | [ ] |
| `RAZORPAY_WEBHOOK_SECRET` | The Live webhook secret, the same as in the Razorpay Dashboard (§2.1). Optional: without it the webhook endpoint answers 503 and polling carries on. Restart after changing it | Before stage B | [ ] |
| `BILLING_CHECKOUT_NAME` | The name shown in the checkout popup. Default `Hypersign` | Before stage B | [ ] |
| `BILLING_PAY_ENABLED` | `true` switches on Pay, Collect payment and the reconciliation job | The switch, §8 | [ ] |
| `REDIS_URL`, or `REDIS_HOST` and `REDIS_PORT` | The production Redis (see §4) | Before stage B | [ ] |

## 4. Infrastructure

- [ ] **Redis** is reachable from every replica. The order sync lock and the BullMQ reconciliation job use it. Without Redis, payments are only checked when the customer is on the page.
- [ ] **MongoDB is a replica set.** Invoice numbering and coupon reservations use transactions. (It is today: `CreditRepository` already uses them.)
- [ ] After the first deploy of the billing build, the new indexes exist. They're created by Mongoose on start:
  - `orders`: unique `orgId + idempotencyKey`, unique `orderNumber`, unique `provider + providerOrderId`, and `provider + paymentLink.linkId`
  - `paymentAttempts`: unique `provider + providerPaymentId`
  - `webhookEvents`: unique `provider + eventId`
  - invoices, counters, coupons, quotes and price books, as declared in `src/billing/schemas/`
- [ ] The webhook URL `POST /api/v1/billing/webhooks/razorpay` is reachable from the internet. The ingress, WAF or IP allowlist must let Razorpay through. It is already excluded from the app's origin check and JWT.
- [ ] The service clock is correct (NTP). Order expiry, link expiry and invoice dates depend on it.
- [ ] Logs from the `OrderService`, `PaymentWebhook`, `PaymentReconciliation` and `InvoiceService` contexts reach the place we look at during the first week (§10).

## 5. Data scripts (production)

Run in mongosh after `use <db>`, with `DRY_RUN = true` first. Review the output before running for real.

- [ ] [1-seed-price-books-and-coupons.js](scripts/1-seed-price-books-and-coupons.js): price book v1 (India and Global) and the FOUNDING coupons. Safe to run again.
- [ ] [2-backfill-kyb-approved-at.js](scripts/2-backfill-kyb-approved-at.js): `companyVerificationApprovedAt` for organisations approved before the billing release. It uses an approximate date, so review the list before running it.
- [ ] **Never** run [3-staging-test-account.js](scripts/3-staging-test-account.js) on production. It's for staging only.
- [ ] After the scripts: `GET /api/v1/billing/catalog` for an Indian and a Global account returns the expected plans and prices.

## 6. Staging rehearsal

Run on staging with **Test** keys and the full production setup (settings, scripts, webhook in Test mode). Everything below passes before production.

**Checkout (India):**
- [ ] Card, UPI and netbanking test payments end `FULFILLED`, with an invoice and an active or queued credit plan.
- [ ] A failed payment, then a successful retry on the same order.
- [ ] Closing the tab right after paying: the order is fulfilled by the webhook within seconds, or by the job within 5 minutes with the webhook off.
- [ ] A double-clicked Pay creates one order.
- [ ] A coupon held by an abandoned order is usable again once the order expires or is cancelled.
- [ ] CGST + SGST for a Karnataka customer, IGST for another state, and a GSTIN on the invoice for B2B.

**Checkout (Global):**
- [ ] A USD test payment ends `FULFILLED`. The invoice has no tax, the export wording, and the INR value (`fx`).
- [ ] A Global customer without a phone is asked for one before paying.

**Collect payment (super admin):**
- [ ] An India link and a Global link, both emailed by Razorpay and both copied and sent by hand. Paying either issues the invoice and grants the credits.
- [ ] Resend, void, and an expired link (shortest expiry). None of them leaves an invoice behind.
- [ ] The customer sees the open link under "Awaiting payment" and can pay it.

**Webhooks** (set up as in §2.1, in Test mode):
- [ ] With `RAZORPAY_WEBHOOK_SECRET` set, a paid link is fulfilled within seconds, and its `webhookEvents` row reaches `PROCESSED`.
- [ ] Without `RAZORPAY_WEBHOOK_SECRET`, the same flows still finish, through polling and the job.
- [ ] A redelivery from the Razorpay Dashboard is answered as a duplicate and changes nothing.

**Invoicing without payments:**
- [ ] Super admin **Free credits** and **Already paid** issue numbered invoices and grant the credits once, even when retried.
- [ ] The free-credit promotion claim issues a ₹0 `PROMOTION` invoice for ID Service.
- [ ] Customers can download every kind of invoice from Credit Purchase History.

## 7. Dashboard readiness

- [ ] The dashboard build with the billing UI is deployed (top-up popup, Credit Purchase History, super-admin Recharge Service Credits, payment links table).
- [ ] **Collect payment is offered for Global customers.** `CreditRecharge.vue` still says "Available for Indian customers only for now" and clears the choice for non-`IN` customers. The backend has supported Global since 2026-11-05. Remove both checks, and ask for the phone first.
- [ ] Razorpay's `checkout.js` loads in production. Check the dashboard's Content Security Policy, if it has one.
- [ ] Pay stays hidden where `features.pay` is false.

## 8. Switch-on order

One stage at a time. Watch each for a few days (§10) before the next.

**Stage A: invoicing only**
- [ ] `BILLING_ENABLED_REGIONS=IN`. Customers see prices and quotes with Pay disabled. Super admins use Free credits and Already paid.
- [ ] Add `GLOBAL` once Q3 is signed off.

**Stage B: India pilot**
- [ ] `BILLING_PAY_ENABLED=true` with the Live keys.
- [ ] Pilot with internal organisations first. Make one real small payment and refund it from the Razorpay Dashboard.
- [ ] Open to all Indian customers.

**Stage C: Global and Collect payment**
- [ ] Global checkout: `BILLING_ENABLED_REGIONS=IN,GLOBAL` with Pay on. Make one real small USD payment.
- [ ] Collect payment for India and Global from the super-admin page. Make one real link per region.

**Stage D: invoices only**
- [ ] `BILLING_INVOICED_GRANTS=true` once super admins use the new recharge page. ID Service credits can then only be granted through invoices.

## 9. Production smoke test (after each stage)

- [ ] `GET /api/v1/billing/catalog` works for an Indian and a Global account.
- [ ] Stage A: one Free credits invoice to an internal app. The number, PDF, and credits are correct.
- [ ] Stage B and C: one real payment per region and one real payment link. Each ends `FULFILLED`, the invoice is right, and the credits arrived. Refund it afterwards if it was a test.
- [ ] If webhooks are on: those payments' `webhookEvents` rows are `PROCESSED`.
- [ ] The startup log has no "Payment reconciliation is off" line once Pay is on, and no missing `BILLING_SUPPLIER_*` warnings.

## 10. First week

Check daily:
- [ ] No orders stuck in `PAID` (paid but not fulfilled) or `NEEDS_REVIEW` (wrong amount). Each one needs a person.
- [ ] No orders in `CREATED` for more than 15 minutes. The job marks them `FAILED`; look for a pattern.
- [ ] `webhookEvents` with status `FAILED` (if webhooks are on). The job covers them, but repeated failures point to a bug.
- [ ] Razorpay Dashboard › Webhooks shows no failed deliveries.
- [ ] Captured payments in the Razorpay Dashboard match `FULFILLED` orders and `GATEWAY` invoices.
- [ ] Logs: "has N captured payments; refund all but", "Needs review", "paid but not fulfilled".

## 11. Rollback

Turning a flag off stops new activity. It doesn't undo issued invoices or granted credits.

- **Stop new payments:** `BILLING_PAY_ENABLED=false`. Pay and Collect payment are refused.
  - **Careful:** this also stops the reconciliation job. Orders and links that are still open won't be picked up if someone pays them. First void open payment links, and wait for checkout orders to expire (30 minutes). Or keep Pay on and remove the region from `BILLING_ENABLED_REGIONS` instead.
  - Webhooks keep syncing orders as long as the keys and webhook secret are set.
- **Stop billing in a region:** remove it from `BILLING_ENABLED_REGIONS`. Billing endpoints answer `503 BILLING_DISABLED` there.
- **Back to direct credit grants:** `BILLING_INVOICED_GRANTS=false`.
- **Bad build:** redeploy the previous image. The new collections and fields are additive and older builds ignore them. Leave the settings as they are.
- Wrong charges are refunded from the Razorpay Dashboard, and Finance is told so a credit note can be issued by hand (credit notes are epic 7).

---

## Changes to this list

| Date | Change |
|---|---|
| 2026-11-09 | §2.1 added: Razorpay webhook setup per environment, how to verify it, and a table of delivery errors. Local Test-mode webhook verified through ngrok (200). |
| 2026-11-09 | Created, collecting the settings, Razorpay setup, scripts, open questions and tests from the ADR, the epics and the API contract. Includes the optional webhook (`RAZORPAY_WEBHOOK_SECRET`) and the Collect payment for Global UI fix. |
