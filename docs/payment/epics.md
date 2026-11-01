# Credit top-up and invoicing: epics

The work breakdown for [the credit top-up and payments ADR](credits-top-up-payment.md). The ADR says *what* we build and why. This document says *in what order*, and tracks progress. Section numbers (§) point to the ADR, and "Q" numbers to its open questions (§13).

The API request and response formats the dashboard builds against are in [api-contract.md](api-contract.md).

**Plan.** Invoicing is finished first, because it doesn't need a payment gateway. Payments follow once a gateway is chosen; talks with the gateway providers are still going on (Q1).

**Status values:** Not started · In progress · Done · Blocked.

| # | Epic | Stage | Status | Depends on | Blocking questions |
|---|---|---|---|---|---|
| 1 | Price and plans | Invoicing | In progress | — | Q2, Q10 |
| 2 | Coupons | Invoicing | In progress | 1 | Q9, Q20 |
| 3 | Quotes | Invoicing | In progress | 1, 2 | Q4 |
| 4 | Invoices | Invoicing | In progress | 3 | Q3 (invoice wording only), Q8, Q13, Q14, Q15, Q17 |
| 5 | Checkout (India) | Payments | Blocked | 4 | Q1 |
| 6 | Global payments | Payments | Blocked | 5 | Q1 |
| 7 | Refunds, credit notes and compliance | Payments | Not started | 5 | Q5 |

The organisation prerequisites are done (2026-10-31): one onboarding record per account, and `orgId` on apps, roles and team rows (§4.1).

Every epic ships behind the `billing.selfServe` flag per region: the `BILLING_ENABLED_REGIONS` setting (for example `IN,GLOBAL`). It is empty by default, so billing endpoints return `503 BILLING_DISABLED` until a region is listed. Pay stays off until `BILLING_PAY_ENABLED=true`. `BILLING_SUPPLIER_STATE_CODE` is our GST registration state: `29` (Karnataka); without it, Indian quotes show a single "GST 18%" line instead of CGST + SGST or IGST.

Staging data scripts (mongosh) are in [scripts/](scripts/).

---

## Stage 1: Invoicing (no gateway)

At the end of this stage:
- **customers** see real prices, coupons and the full quote in the top-up popup, with Pay disabled;
- **super admins** grant ID Service credits only through invoices (**Free credits** or **Already paid**);
- **customers** download those invoices from their purchase history.

### Epic 1. Price and plans

**Outcome:** the top-up popup shows real prices from the server, for the account's region.

Backend:
- [x] Billing module skeleton in this service (`src/billing`).
- [x] `READ_BILLING` and `WRITE_BILLING` added to `DASHBOARD.ACCESS_TYPES`, checked by the existing `DashboardAccessGuard` (§4.0).
- [x] `billing.region` and `billing.currency` on `CustomerOnboarding`, derived from the onboarding `country` the first time they are needed, and stored only when the country is known (§4.0). KYB `countryOfRegistration` isn't stored locally yet; it arrives with the billing profile in epic 3.
- [x] `PriceBook` schema: versions, `DRAFT` / `PUBLISHED` / `RETIRED`, one published book per region (§4.2).
- [x] A script that creates price book v1 for India and Global with the agreed plans, discounts and add-ons ([scripts/1-seed-price-books-and-coupons.js](scripts/1-seed-price-books-and-coupons.js)).
- [x] Pricing engine as a pure function: plan discounts, custom-amount ranges, rounding and credits. Unit tests use the shared fixtures, ₹2,499 → ₹1,874.25 before coupons and $299 → $159.96 (§4.4).
- [x] `GET /billing/catalog` (§5.1).

Dashboard:
- [ ] The popup reads the catalog instead of `creditTopUpPricing.js`.
- [ ] Remove the "Preview as" region switch.
- [ ] The Credit Calculator takes its flows from `calculatorFlowIds`.

**Done when:** an Indian and a Global account each see their own plans, discounts and add-ons from the server, and the prices match the agreed model.

### Epic 2. Coupons

**Outcome:** eligible customers see the FOUNDING offers in the coupon dialog.

Backend:
- [x] `Coupon`, `CouponAccount` and `CouponRedemption` schemas (§4.3).
- [x] A script that creates FOUNDING15 and FOUNDING8 (same seed script).
- [x] `companyVerificationApprovedAt` on `CustomerOnboarding`, set by the KYB webhook on the first move to `Approved`. Already-approved organisations get an approximate date from [scripts/2-backfill-kyb-approved-at.js](scripts/2-backfill-kyb-approved-at.js).
- [x] Eligibility engine: KYB approved within 180 days, tax ID (FOUNDING8), per-account use limit, first-500-accounts limit.
- [x] `GET /billing/coupons`, with `previewDiscountMinor` from the pricing engine (§5.1).
- [x] FOUNDING8 needs a GSTIN or PAN in `billing.taxIds`. Since epic 3 it is filled when KYB is submitted or the customer saves the billing form. Companies that finished KYB earlier qualify once they save the form (or after the ID Service backfill).

Dashboard:
- [ ] The coupon dialog lists the eligible offers.

**Not in this epic:**
- **Applying a code** comes with quotes (epic 3).
- **Reserving a code** happens at checkout (epic 5).
- **REFER, PARTNER and WINBACK**, and the referral bonus job, follow when Business switches them on.

**Done when:** an eligible account sees its offer with the right saving, and an ineligible one sees nothing.

### Epic 3. Quotes

**Outcome:** every amount in the popup comes from the server, including the coupon and the GST line.

Backend:
- [x] Billing profile (§4.1): `legalName`, structured `address`, `gstStateCode`, `taxIds`, `confirmedAt` and `lockedAt` on `CustomerOnboarding.billing`.
- [x] `GET` and `PUT /customer-onboarding/billing` on the existing onboarding controller (§5.1).
- [x] Copy the address and tax ID into an unconfirmed `billing` when KYB is submitted (`submitKybCompany`).
- [ ] One-time backfill from the ID Service for accounts that finished KYB earlier. Needs calls to the ID Service, so it can't be a mongosh script; until it exists, these customers confirm their details in the billing form.
- [x] Tax calculation for India: CGST + SGST or IGST from the place of supply (§7). Epic 4 reuses it for super-admin invoices.
- [x] `Quote` collection with a 15-minute TTL index (§4.4).
- [x] `POST /billing/quotes`, with coupon codes, returning the generic `COUPON_INVALID` (§5.1). Rejected codes are limited to 10 per account per 10 minutes; plain quotes aren't limited, because the popup re-quotes on every change.

Dashboard:
- [ ] Billing details form, shown when the profile is incomplete.
- [ ] The popup's totals, coupon line and GST line come from the quote.
- [ ] Applying or removing a coupon in the dialog requests a new quote.
- [ ] Pay stays disabled.

**Done when:** the popup's numbers match the shared fixtures, including ₹1,724.31 with FOUNDING8 and $135.97 with FOUNDING15, and an invalid code shows "This coupon code is not valid."

### Epic 4. Invoices

**Outcome:** super admins grant ID Service credits only through invoices, and customers download them.

Built from the super-admin side first: **Free credits** and **Already paid** need no gateway, and they exercise the same invoice and settlement code self-serve purchases will use. The backend stores invoice data only; the dashboard renders the PDF from it on each download (ADR §8.3). Invoice email is deferred.

**4a. Invoices and super-admin grants** (backend done)

Backend:
- [x] `Invoice` and `BillingCounter` schemas, with gap-free numbering per series and financial year (§4.7, §8.3).
- [x] `invoiceId` and `revokedCredits` on `CreditPlan` (§4.6).
- [x] Settlement: counter + invoice in one transaction, then `grantCredit` with `referenceId 'invoice:<id>'`, then `creditPlanId` written back (§4.7).
- [x] `GET /admin/billing/profiles?appId` for the **Billed to** card (§5.3).
- [x] `POST /admin/billing/invoices/preview` for the summary panel's live totals (§5.3).
- [x] `POST /admin/billing/invoices` with **Free credits** (amount 0) and **Already paid** (`isPaid = true`, with payment reference), and idempotency (§8.2).
- [x] `GET /admin/billing/invoices`, `GET /admin/billing/invoices/:id` (the `InvoiceDocument`), `PATCH /admin/billing/profiles/:orgId` (§5.3).
- [x] `POST /app/:appId/credits` returns `409 USE_INVOICES` for ID Service apps once `BILLING_INVOICED_GRANTS=true` (switch it on when the new recharge page is live). SSI Service is unchanged.
- [x] Ownership check on `activateCredit`: customers can only activate plans of their own apps (§14.2). The status guard is left out: it would change how the credit pipeline retries, and no unpaid plans exist.
- [ ] `grantCredit` option to grant straight to `Active`, if Q8 is agreed. Until then invoiced plans follow today's rule: a new plan waits while another is active (preview shows `AFTER_CURRENT_PLAN`).
- [x] Our legal entity details from `BILLING_SUPPLIER_*` settings, checked on every invoice call (`503 BILLING_NOT_CONFIGURED`) and logged at startup. Not a startup failure, so a missing setting can't take the dashboard down.

**4b. Customer invoices** (backend done)
- [x] `GET /billing/invoices` (purchase history) and `GET /billing/invoices/:id` (the `InvoiceDocument` for download) (§5.1).

**Deferred**
- [ ] Emailing invoices: render the PDF in this service with the dashboard's layout module, and attach it or send a link (Q19).

Dashboard:
- [ ] Render the invoice PDF from `InvoiceDocument` with `invoiceDocument.js`, choosing the template by `templateVersion`; keep every template version.
- [ ] Invoice column in Credit Purchase History, with **Download**; remove the mock invoices.
- [ ] Super admin › Recharge Service Credits: the three steps, the summary panel and the result card for ID Service (§8.2). **Collect payment** stays disabled until epic 5.

**Done when:** a super admin can issue a complimentary and an already-paid invoice, the credits are active, the numbers follow the series with no gaps, and the customer and the super admin download the same PDF, rendered from the same invoice data.

---

## Stage 2: Payments (after the gateway is chosen)

### Epic 5. Checkout (India)

**Outcome:** Indian customers pay online, and credits arrive only after a verified payment.

- [ ] `Order` with its state machine and idempotency key, `PaymentAttempt` and `WebhookEvent` (§4.5).
- [ ] `PaymentProvider` interface, `PaymentRouter` and the first adapter, with contract tests (§6).
- [ ] `POST /billing/orders` (re-checks the quote, reserves the coupon, creates the checkout), order status, cancel and history.
- [ ] `POST /billing/webhooks/:provider` with the raw body and signature check (§5.2).
- [ ] Fulfilment: invoice, then `grantCredit`, then email with the PDF.
- [ ] BullMQ jobs: webhook processor, fulfilment, reconciliation, grant watchdog, coupon release (§5.4).
- [ ] **Collect payment:** payment links, reminders, mark paid, void, new link (§8.2).
- [ ] Customers see **Pay now** and "Awaiting payment" rows.
- [ ] Dashboard: Pay redirects to the gateway, and `/credits/payment/return` polls the order.
- [ ] Pilot with internal or test orgs.
- [ ] Start the credit middleware's revoke command, for epic 7.

### Epic 6. Global payments

- [ ] The second adapter (§6).
- [x] Global tax: none is charged (decided 2026-10-31).
- [ ] The GL invoice series, and the INR value on USD invoices.

### Epic 7. Refunds, credit notes and compliance

- [ ] Refunds and credit notes (§4.7).
- [ ] The revoke command in `@hypersign-protocol/credit-middleware` (§4.6).
- [ ] Price book and coupon management screens.
- [ ] The daily settlement check and alerts.
- [ ] Invoice exports for GSTR-1 and accounting software.
- [ ] E-invoicing, if it applies (Q14).
