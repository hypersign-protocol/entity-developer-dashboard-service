# ADR: Self-serve credit top-up and payments

| | |
|---|---|
| **Status** | Proposed |
| **Date** | 2026-10-22 (updated 2026-10-28 to match the popup agreed with Business, again on 2026-10-28 after a backend review against the existing schemas, §4.0 and §14, and on 2026-10-31 after the organisation migration put `orgId` on apps, roles and team rows, §4.0 and §4.1) |
| **Author** | Vishwas Bhushan |
| **Deciders** | Engineering (dashboard service, credit middleware, dashboard UI), Business, Finance |
| **ADR number** | To be assigned (follows ADR-011) |

## 1. Context

Today, customers cannot buy credits themselves. A super admin grants them by hand from **Super Admin › Credit Recharge**, which calls this service (`entity-developer-dashboard-service`, `CreditsController`):

| Today | Endpoint |
|---|---|
| Grant credits to an app (super admin) | `POST /api/v1/app/:appId/credits` with `{ amount, amountDenom, validityPeriod, validityPeriodUnit }`. Creates a `CreditPlan` with `source: MANUAL_RECHARGE` |
| List an app's credit plans | `GET /api/v1/app/:appId/credits` (returns `apiCredit.total`, `apiCredit.used`, `expiresAt`, `status`). **This route is excluded from JWT auth today**, so it must not start returning invoice or billing data |
| Activate a queued plan (customer) | `POST /api/v1/app/:appId/credits/:creditId/activate` |

Customer onboarding also grants starter credits through the same code path (`source: CUSTOMER_ONBOARDING`).

The pricing team has agreed the commercial model, and the dashboard UI is built for sign-off (`src/components/credit/CreditTopUpPopup.vue`, with mock pricing in `creditTopUpPricing.js`):

- **Two billing regions, India and Global.** The region comes from where the customer is taxed, as given on the onboarding form. India pays in INR and Global pays in USD.
- **Plans with a fixed discount each.** India: ₹999 / ₹2,499 / ₹4,999 / ₹9,999 at 10 / 25 / 28 / 35% off (prices exclude GST). Global: $99 / $199 / $299 / $499 / $1,499 at 0 / 40 / 46.5 / 52 / 55% off. A customer can also click **Custom amount** and enter any amount between the smallest and largest plan (₹999–₹9,999 or $99–$1,499).
- **Add-ons that are free today but must be shown.** These are credit validity (1 month for India, 6 months for Global, with no carry-forward), 24×7 human support and email support.
- **Coupons tied to a region.** Only **FOUNDING15** (Global) and **FOUNDING8** (India) are active at launch. REFER, PARTNER and WINBACK are designed but switched off (see §4.3). Customers apply a coupon from a small **Apply a coupon** dialog, where they can type a code or pick from the offers listed for them.
- **1 credit = ₹1.** A discount lowers the price, not the number of credits. Global top-ups get 90 credits per $1 (still to be confirmed).
- **"Understand your credits"** opens the Credit Calculator, so the customer can see how many verifications the top-up covers. It only shows the verification flows for their region: Non-Doc ID Verification (India) for India, and Global Identity Verification and Business Verification for Global.
- **Tax is shown on the payment page,** based on the customer's jurisdiction.
- **Payment happens on a hosted gateway page.**

Business has also agreed how invoicing and manual grants work:

- **Invoicing is managed by our system, not by the payment gateway.** We expect to use more than one gateway, and some gateways don't offer invoicing at all. Gateways only run checkout pages and payment links.
- **A super admin can create an invoice for any ID Service app** with an **amount** and an **isPaid** flag. This replaces today's direct credit grant for ID Service. SSI Service recharges are unchanged.
  - **Amount 0:** free credits. The invoice is issued and the credits are active straight away.
  - **isPaid = true:** the payment was already taken in another system (for example a bank transfer). We only issue the invoice and recharge the credits.
  - **isPaid = false:** we generate a payment link for the amount. The credits only become active once the customer pays it.

This ADR decides how the backend supports both flows: self-serve top-ups and super-admin invoices.

## 2. Decision summary

1. **The server is the only source of truth for prices.** The dashboard sends *what* the customer picked (a plan id or a custom amount, plus a coupon code). The server returns a **quote** with every amount worked out. Amounts sent by the client are never trusted.
2. **Money is stored as integers in minor units** (paise, cents). Percentages are stored as integer **basis points** (46.5% = `4650`). There are no floating-point numbers anywhere.
3. **The region is fixed by the account's billing profile,** not chosen in the UI. The "Preview as" switch in the popup exists only for the sign-off build.
4. **Pricing is versioned.** Plans, discounts and add-ons belong to a **price book** that is published as a whole. Every quote, order and invoice records the version it used. It is called a price book, not a catalog, because the credit middleware's API price catalog already owns `catalogVersion`.
5. **Credits are granted only after a verified gateway webhook,** never after the browser redirect. The grant is idempotent per order.
6. **Payment gateways sit behind a `PaymentProvider` interface,** and a router picks the provider by region and currency. We start with hosted checkout pages, which keeps card data off our servers (PCI SAQ-A).
7. **Our system owns invoicing; gateways only take payments.** We issue every invoice ourselves, numbered in sequence, and render it as a PDF on request (we don't store PDF files, §8.3). Customers download it from the dashboard. Invoices don't depend on any gateway, so we can run several gateways, including ones without invoicing. Gateway receipts are extras and are not the invoice of record.
8. **Purchased credits reuse the existing `CreditPlan` model and `CreditService.grantCredit`.** The existing `source` (`PAYMENT`, `MANUAL_RECHARGE`) and `referenceId` (`'invoice:<invoiceId>'`, already unique per app) cover provenance and idempotency. Only `invoiceId` and `revokedCredits` are added (§4.6). Consumption, expiry, the ledger and the dashboard's balance view keep working unchanged.
9. **Every ID Service credit grant from the recharge page or a purchase is backed by an invoice.** Self-serve purchases get an invoice when they are paid. Super-admin grants get one when they are created, including ₹0 grants. `CreditService.grantCredit` becomes an internal step that runs once an invoice is settled, and `POST /api/v1/app/:appId/credits` is no longer called from the super-admin page for ID Service. **SSI Service recharges stay as they are, without invoices,** for now (open question 16). Onboarding starter credits are open question 18.
10. **Super-admin invoices settle in one of three ways** (§8.2): complimentary (amount 0), paid offline (`isPaid = true`), or paid through a gateway payment link (`isPaid = false`). For an unpaid invoice, no credit plan exists until a verified payment, or an admin marking it paid, settles it (§4.6).

### Invoice scenarios at a glance

A plain-language summary for leadership.

1. **Customer buys credits themselves.** They pick a plan and pay online. Once the payment goes through, credits are added and the invoice is issued as **Paid**. If they leave without paying, no invoice is created.
2. **We give free credits.** Our team creates a ₹0 invoice. Credits are added straight away, and the invoice is marked **Complimentary**.
3. **Customer paid us outside the dashboard** (for example, a bank transfer). Our team creates an invoice for the amount and marks it as already paid, with the payment reference. Credits are added straight away, and the invoice is marked **Paid**.
4. **Customer still needs to pay.** Our team creates an invoice for the amount, marked **Payment due**. The customer gets a payment link by email, and the invoice carries a QR code. The credits show as "Awaiting payment" and can't be used yet. Once the customer pays, the credits start working and the invoice changes to **Paid**. If they don't pay within 15 days, we send a new link or cancel the invoice, and cancelled invoices never give credits.

Every purchase in the customer's credit history shows its invoice and a **Download** button. Unpaid invoices also have **Pay now**.

## 3. Scope

**In scope:** pricing catalog, coupons, quotes, orders, gateway integration (checkout and payment links), webhooks, credit grant, tax handling, invoices and credit notes, super-admin invoices (complimentary, paid offline, or paid by link), refunds by admins, reconciliation, invoice exports, and the admin APIs to manage all of these.

**Out of scope for v1** (the data model leaves room for them): auto-recharge, subscriptions, saved payment methods, customer-initiated refunds, wallets or credit transfer between apps, paying in other currencies, and **invoicing for SSI Service recharges** (these keep today's direct recharge).

## 4. Data model

The billing module lives in **this service** (`entity-developer-dashboard-service`), next to the existing `credits` and `customer-onboarding` modules, and uses the same MongoDB database. Collections follow the existing conventions: Nest `@Schema({ timestamps: true })` classes, so every document has `createdAt`/`updatedAt`; explicit camelCase collection names, like `creditLedger` and `creditCommitOutbox`; and string enums. Money fields end in `Minor`, are whole numbers checked with `Number.isSafeInteger` (as `CreditService` already does for credits), and always sit next to a `currency`.

### 4.0 Existing schemas and what we reuse

The first draft of this ADR assumed an `Organisation` collection and a `CreditPackage` model. Neither exists under those names. This table maps the draft's concepts to what is in the code today.

| Draft concept | What exists today | Decision |
|---|---|---|
| `Organisation` / `orgId` | There is no organisation collection, but **`CustomerOnboarding` is the organisation record in practice**: one company per account owner, with `companyName`, `customerEmail`, `country`, `billingAddress`, KYB status, and the apps it created (`ssiServiceId`, `kycServiceId`). Each owner has at most one (unique index on `CustomerOnboarding.userId`). `App`, `Role` and `AdminPeople` store its `_id` as `orgId`: required on `App`, since an app can only be created after onboarding, and optional on `Role` and `AdminPeople`, which get it when the owner onboards. Access checks still key on the **account owner's `userId`** (`App.userId`, `CustomerOnboarding.userId`). Team members are `AdminPeople` rows with `adminId` = owner, and `JWTAccessAccountMiddleware` rewrites `req.user.userId` to the owner (`session.tenantId`) for team members. | **Reuse `CustomerOnboarding` as the organisation, and use its `_id` as the organisation id (`orgId`).** Every billing collection keys on `orgId`, not on the owner's `userId`. The owner is `CustomerOnboarding.userId`, which can change (ownership transfer, §4.1) while `orgId` never does. Requests resolve `userId` → `orgId` with one indexed lookup, and an app's organisation is read straight from `App.orgId`. The person who clicked is recorded separately in `createdBy`. Don't call it `tenantId`, because the credit middleware already uses `tenantId` for the app's subdomain (`creditLedger.metadata.tenantId`). |
| `App` | `App` (`apps`), unique `appId`, `services[0].id` = `CAVACH_API` (ID Service) or `SSI_API`. | **Reuse unchanged.** Billing only accepts apps whose service is `CAVACH_API`. |
| `CreditPackage` | **`CreditPlan`** (`creditplans`) in `src/credits/schemas/credit.schema.ts`. Keyed by `serviceId` (= `appId`), with `apiCredit.{total,used}`, `validityDays`, `expiresAt`, `status: Active \| Inactive`, `criticalBalance`, `creditedBy`, `source` and `referenceId`, which is unique per `serviceId`. | **Reuse, with two small additions** (§4.6). The existing `referenceId` already makes grants idempotent, so we don't need new unique `orderId`/`invoiceId` indexes. |
| `CreditPackage.source` (`ADMIN \| PURCHASE \| …`) | `CreditSourceEnum`: `MANUAL_RECHARGE`, `CUSTOMER_ONBOARDING`, `MIGRATION`, `PAYMENT`, `ADJUSTMENT`. | **Reuse.** Use `PAYMENT` for self-serve, `MANUAL_RECHARGE` for super-admin invoices and `ADJUSTMENT` for corrections. Add only `REFERRAL_BONUS` and `PROMO`. No backfill is needed. |
| Credit audit trail | `creditLedger` (time-series) + `creditCommitOutbox`. They already record every grant, reservation, commit and expiry per plan. | **Reuse.** Billing doesn't duplicate credit movements. The `invoiceId` on the plan links a ledger entry to its invoice. |
| `kybStatus` / `kybApprovedAt` | `CustomerOnboarding.companyVerificationStatus` (`KybVerificationEnum`: `Submitted`, `Approved`, `Rejected`, `Completed`) is updated by the KYB webhook (`updateCompanyVerificationStatus`). There's no approval timestamp. | **Don't copy it.** Read the status from `CustomerOnboarding`. **Add one field there:** `companyVerificationApprovedAt`, set by the webhook handler on the first move to `Approved`. FOUNDING coupons need it ("within 6 months of KYB approval"). |
| Billing address, tax IDs | `CustomerOnboarding.billingAddress` is a **free-text string**, and `country` is optional. The structured address (`street, city, province, postalCode, country`), `countryOfRegistration` and `taxIdType`/`taxIdNumber` are sent to the ID Service's company record (`companyId`) and **not stored here**. `TaxIdTypes` in `identifier-types.ts` already has the GSTIN and PAN validation regexes. | **Add a `billing` sub-document to `CustomerOnboarding`** (§4.1) instead of a separate collection. It's prefilled from the onboarding fields and the KYB company record. Its address uses the KYB address shape, and its tax IDs reuse the `TaxIdTypes` codes and regexes. The free-text `billingAddress` stays as an onboarding input. |
| Region | No field. The candidates are KYB `countryOfRegistration` and onboarding `country`. | Stored as `billing.region`, derived once when the billing details are first saved: `countryOfRegistration`, falling back to `country`. `IN` → `IN`, anything else (including `XX`) → `GLOBAL`. |
| Permissions `BILLING_READ` / `BILLING_WRITE` | Per-service access types in `SERVICES.CAVACH_API.ACCESS_TYPES` (`READ_CREDIT`, `WRITE_CREDIT`, …), stored in `User.accessList` and `Role.permissions`. | **Add `READ_BILLING` and `WRITE_BILLING`** to `CAVACH_API.ACCESS_TYPES`, following the existing `VERB_NOUN` naming. The owner gets them through `ALL`. |
| `BILLING_ADMIN` | Only `UserRole.SUPER_ADMIN` plus `SuperAdminMiddleware`. There are no finer-grained super-admin permissions. | **v1: reuse `SuperAdminMiddleware`.** A separate billing-admin role is deferred (open question 13). |
| Pricing `CatalogVersion` | The name is taken. The credit middleware's **API price catalog** (credits charged per route) already writes `catalogVersion` into every `creditLedger` row. | **Rename ours `PriceBook`** (`priceBooks`, `priceBookId`, `priceBookVersion`), so Finance never confuses "what a customer paid" with "what an API call costs". |
| Jobs and queues | BullMQ on Redis is already used for credit commands (`CreditBullMqProvider`) and email (`Entity-Dashboard-Mail-Queue`). | **Reuse BullMQ** for webhook processing, fulfilment, reconciliation and reminders. |
| Email | `MailNotificationService.addAJob({ to, subject, message, cc, bcc })`. It has **no attachments**. | Extend the job with `attachments` (base64 PDF) and update the mail worker, or send a download link instead (open question 19). |
| Mongo transactions | Already used by `CreditRepository` (`startSession` / `withTransaction`), so the deployment is a replica set. | **Reuse** for invoice numbering (counter + invoice insert). |

**Entity-relationship diagram.** The diagram shows every new collection with its fields, keys (`PK`, `FK`, `UK` for unique) and relationships. It also shows the existing **User** (account owner), **CustomerOnboarding** (the organisation: its `_id` is the `orgId`, and it also holds the billing profile), **App** and **CreditPlan** records, to show where the new data attaches. It renders on GitHub and GitLab, in VS Code's Markdown preview, and at [mermaid.live](https://mermaid.live). The same model is in [Appendix A](#appendix-a-er-diagram-in-dbml) as DBML for [dbdiagram.io](https://dbdiagram.io).

```mermaid
erDiagram
  User ||--o| CustomerOnboarding : "owns (transferable)"
  User ||--o{ App : owns
  CustomerOnboarding ||--o{ App : "orgId"
  App ||--o{ CreditPlan : holds

  PriceBook ||--o{ Quote : prices
  CustomerOnboarding ||--o{ Quote : requests
  App ||--o{ Quote : "is topped up by"
  Quote ||--o| Order : becomes
  CustomerOnboarding ||--o{ Order : places
  Order ||--o{ PaymentAttempt : "is paid by"
  Order ||--o| Invoice : "is billed by"

  CustomerOnboarding ||--o{ Invoice : receives
  Invoice ||--o| CreditPlan : "grants (once paid)"
  Invoice ||--o{ PaymentLink : "is paid through"
  PaymentLink ||--o{ PaymentAttempt : "is paid by"
  Invoice ||--o{ CreditNote : "is corrected by"
  BillingCounter ||--o{ Invoice : numbers

  Coupon ||--o{ CouponAccount : "is claimed by"
  CustomerOnboarding ||--o{ CouponAccount : claims
  Coupon ||--o{ CouponRedemption : "is redeemed by"
  Order ||--o| CouponRedemption : uses
  CustomerOnboarding ||--o{ Referral : refers
  Referral }o--o| Order : "qualifies with"

  PaymentAttempt ||--o{ WebhookEvent : "is updated by"

  User {
    string userId PK "existing; owner = tenant"
    string email
    string role "ADMIN or SUPER_ADMIN"
  }
  CustomerOnboarding {
    string _id PK "existing; = orgId"
    string userId FK,UK "owner; unique; transferable"
    string companyName
    string country
    string companyId "ID Service company"
    string billingAddress "free text, onboarding input"
    string companyVerificationStatus "KYB"
    date companyVerificationApprovedAt "NEW"
    object billing "NEW, billing profile (4.1)"
  }
  App {
    string appId PK "existing"
    string userId FK
    string orgId FK "existing; required"
    array services "CAVACH_API or SSI_API"
  }
  PriceBook {
    string _id PK
    string region
    string currency
    int version
    string status "DRAFT PUBLISHED RETIRED"
    int creditsPerMajorUnit "INR 1, USD 90"
    object custom "enabled, minMinor, maxMinor"
    array plans "embedded"
    array discountRules "embedded"
    array addOns "embedded"
    array calculatorFlowIds
    date publishedAt
    string publishedBy
  }
  Coupon {
    string _id PK
    string code UK
    string region
    int percentBps
    int maxDiscountMinor
    bool listed
    string title
    string description
    string campaign
    object eligibility
    object limits
    int accountCount
    int redemptionCount
    string status
  }
  CouponAccount {
    string _id PK
    string couponId FK
    string orgId FK
    int redemptions
  }
  CouponRedemption {
    string _id PK
    string couponId FK
    string orgId FK
    string orderId FK,UK
    string status "RESERVED REDEEMED RELEASED"
    int discountMinor
    date reservedUntil
  }
  Referral {
    string _id PK
    string referrerOrgId FK
    string refereeOrgId FK,UK
    string couponCode
    string status
    string qualifyingOrderId FK
    int bonusCredits
  }
  Quote {
    string _id PK
    string orgId FK
    string appId FK
    string priceBookId FK
    int priceBookVersion
    object selection
    object lines
    int credits
    int validityDays
    date expiresAt "TTL, 15 minutes"
  }
  Order {
    string _id PK
    string orderNumber UK
    string orgId FK
    string appId FK
    string quoteId FK
    string createdBy
    object quoteSnapshot
    int amountDueMinor
    int taxMinor
    int amountPaidMinor
    string status
    string provider
    object providerRefs
    string checkoutUrl
    date expiresAt
    string idempotencyKey "UK with orgId"
    string invoiceId FK
  }
  PaymentAttempt {
    string _id PK
    string orderId FK "self-serve"
    string invoiceId FK "admin link"
    string provider
    string providerPaymentId "UK with provider"
    string status
    int amountMinor
    string currency
    string method
  }
  WebhookEvent {
    string _id PK
    string provider
    string eventId "UK with provider"
    string paymentAttemptId FK "once matched"
    string type
    string status
    int attempts
    date receivedAt
    date processedAt
    object payload
  }
  PaymentLink {
    string _id PK
    string invoiceId FK
    string provider
    string providerLinkId "UK with provider"
    string url
    int amountMinor
    string status
    date expiresAt
    int remindersSent
  }
  Invoice {
    string _id PK
    string invoiceNumber UK
    string series "IN or GL"
    string financialYear
    string source "SELF_SERVE or ADMIN"
    string orderId FK,UK
    string orgId FK
    string appId FK
    string createdBy
    string idempotencyKey "ADMIN, UK with createdBy"
    string status "UNPAID PAID VOID"
    string settlement "GATEWAY OFFLINE COMPLIMENTARY"
    date issuedAt
    date dueAt
    string currency
    object supplier "snapshot"
    object customer "snapshot"
    string placeOfSupply
    array lines
    array tax
    object totals
    object fx
    object payment
    string activePaymentLinkId FK
    int credits
    int validityDays
    string creditPlanId FK
    object eInvoice
    string templateVersion
    string firstRenderSha256
  }
  CreditNote {
    string _id PK
    string creditNoteNumber UK
    string invoiceId FK
    string reason
    int amountMinor
    int taxMinor
    int creditsRevoked
    string templateVersion
  }
  CreditPlan {
    string _id PK "existing"
    string serviceId FK "existing; = appId"
    string referenceId "existing; UK with serviceId"
    object apiCredit "existing; total, used"
    int validityDays "existing"
    date expiresAt "existing"
    string status "existing; Active or Inactive"
    string source "existing; + REFERRAL_BONUS, PROMO"
    string creditedBy "existing"
    string invoiceId FK "NEW"
    int revokedCredits "NEW"
  }
  BillingCounter {
    string _id PK "e.g. INV/IN/2026-27"
    int seq
  }
```

### 4.1 Billing profile: `CustomerOnboarding.billing`

`CustomerOnboarding` is already the organisation record, and it already holds most of the billing information: `companyName`, `customerEmail`, `country`, a free-text `billingAddress`, and the KYB status. So the billing profile is **a sub-document on it**, not a separate collection. Then there is one record per company, and nothing to keep in sync.

```ts
// src/customer-onboarding/schemas/customer-onboarding.schema.ts (existing). Add:
export class BillingDetails {
  legalName: string;             // defaults to companyName; can differ ("… Private Limited")
  email: string;                 // defaults to customerEmail. Invoices and payment links go here
  address: {                     // same shape as KybCompanyAddressDto
    street: string; city: string; province: string; postalCode: string;
    country: string;             // ISO 3166-1 alpha-2, from CountryCode
  };
  gstStateCode?: string;         // India: 2-digit GST state code. From the GSTIN, or the address province for B2C
  taxIds: { type: string; number: string }[];  // type from TaxIdTypes ('GSTIN', 'PAN', 'VAT', …), checked with its regex
  region: 'IN' | 'GLOBAL';       // derived once (§4.0). Only a super admin can change it
  currency: 'INR' | 'USD';       // follows the region
  providerCustomers?: { [provider: string]: string };  // e.g. { stripe: 'cus_…' }
  lockedAt?: Date;               // set by the first paid invoice. Region and tax ID changes then need a super admin
}

@Schema({ timestamps: true })
export class CustomerOnboarding {
  // … existing fields unchanged …
  @Prop({ type: BillingDetails, required: false })
  billing?: BillingDetails;      // NEW: the billing profile
  @Prop({ type: Date, required: false })
  companyVerificationApprovedAt?: Date;  // NEW: set by the KYB webhook on the first move to Approved
}
// Existing since the organisation migration: one onboarding record per account
CustomerOnboardingSchema.index({ userId: 1 }, { unique: true });
```

**How it's filled.** `billing` is empty until the first time someone opens the top-up popup, or a super admin first invoices the account. It is then prefilled:

| Field | Comes from |
|---|---|
| `legalName` | `companyName`, or the KYB company name |
| `email` | `customerEmail` |
| `address` | the KYB company record in the ID Service (`companyId`). If there's no KYB record, the customer types it in, using the free-text `billingAddress` as a hint |
| `taxIds` | KYB `taxIdType` / `taxIdNumber` |
| `region` | KYB `countryOfRegistration`, falling back to `country` |

The customer confirms or completes the details before their first purchase. The onboarding fields `billingAddress` and `country` stay as they are, as what the customer typed during onboarding. `billing` is the confirmed, structured version that invoices use.

**Rules**

- **Billing has its own write path.** `PUT /billing/profile` updates only `billing.*` with `$set`, and onboarding code never writes `billing`. That way the onboarding workflow (steps, logs, KYB webhook) and billing edits can't overwrite each other. Once `billing.lockedAt` is set, the endpoint refuses region and tax ID changes (`409`).
- **Invoices take a copy.** Each invoice copies the customer details from `billing` when it's issued (§4.7), so later edits never change a past invoice.
- **KYB status isn't copied into `billing`.** Coupon checks read `companyVerificationStatus === 'Approved'` and `companyVerificationApprovedAt`, which are on the same document.
- **`Completed` doesn't count as approved.** `KybVerificationEnum.Completed` means "finished, passed or failed", so only `Approved` counts for coupons. Product to confirm (open question 20).
- **"Complete" means:** `legalName`, `email` and `address` are set, and for India `gstStateCode` is set. B2B India customers also need a `GSTIN` in `taxIds`. Otherwise invoices are refused with `422 BILLING_PROFILE_INCOMPLETE`.

**Organisation id and ownership transfer.** `CustomerOnboarding._id` is the organisation id (`orgId`). Every billing record (orders, invoices, quotes, coupon claims, referrals) stores `orgId`, and `CustomerOnboarding.userId` records who owns the organisation today. To transfer ownership to another user, a super-admin operation runs in one transaction:

| Record | Change |
|---|---|
| `CustomerOnboarding.userId` | Set to the new owner. The unique index refuses a new owner who already owns an organisation |
| `App.userId`, `AdminPeople.adminId`, `Role.userId` | Re-keyed from the old owner to the new one, because access checks in these modules still key on the owner's `userId`. Their `orgId` doesn't change. The old owner can be kept as a team member (`AdminPeople`) |
| Billing collections | **No change**: they key on `orgId` |
| `CreditPlan` | No change: it keys on `appId` |
| Sessions | The old and new owners' sessions are invalidated, so `tenantId` and the cached `orgId` are resolved again |

Invoices already issued keep their customer copy, so a transfer never changes a past invoice. Ownership transfer isn't in v1. Keying billing on `orgId` means it can be added later without migrating any billing data. `App`, `AdminPeople` and `Role` already carry `orgId`; once their access checks filter on it instead of the owner's `userId`, a transfer only needs to touch `CustomerOnboarding.userId`.

**Before this works, two things must be true.** Both hold in production since the organisation migration (2026-10-31).

1. **One onboarding record per owner.** `orgId` and the `userId` → `orgId` lookup depend on it. Duplicates were merged, the duplicate check in `createCustomerOnboardingDetail` now throws a proper `409`, and `CustomerOnboarding.userId` has a unique index.
2. **Every account that buys has an onboarding record.** Buying needs an app, and every app now has an organisation: existing apps were backfilled with `orgId`, and `POST /app` refuses an owner without an onboarding record (`403`). So the billing form doesn't need to create a minimal onboarding record.

### 4.2 PriceBook (plans, discount rules and add-ons embedded)

There is exactly one **published** price book per region at any time. Admins edit a **draft** and publish it, and publishing never changes past orders.

Plans, discount rules and add-ons are **embedded** in the price book rather than kept in three separate collections. The whole set is small (fewer than 20 entries per region), always read together, and must be published atomically. Embedding gives us that with a single document write and no joins. A published document is never edited; a change means a new version.

```ts
@Schema({ collection: 'priceBooks', timestamps: true })
class PriceBook {
  region: 'IN' | 'GLOBAL';
  currency: 'INR' | 'USD';
  version: number;                       // increases per region. Unique index (region, version)
  status: 'DRAFT' | 'PUBLISHED' | 'RETIRED';  // partial unique index: one PUBLISHED per region
  creditsPerMajorUnit: number;           // integer. INR: 1. USD: 90 (to be confirmed). Fixed per version, not live FX
  custom: { enabled: boolean; minMinor: number; maxMinor: number };  // ₹999–₹9,999, $99–$1,499
  calculatorFlowIds: string[];           // IN: ['india']. GLOBAL: ['global', 'business']
  plans: {
    code: string;                        // 'IN_2499', 'GL_199'. Stable across versions
    priceMinor: number;                  // 249900 paise, excluding tax
    displayOrder: number;
    active: boolean;
  }[];
  discountRules: {
    id: string;                          // stable within the version; quotes record it
    type: 'PLAN' | 'AMOUNT_RANGE';
    planCode?: string;                   // type PLAN
    minMinor?: number; maxMinor?: number;  // type AMOUNT_RANGE: custom amounts, or tiered pricing later
    percentBps: number;                  // 2000 = 20%
    priority: number;                    // highest matching rule wins. Plan discounts never stack
  }[];
  addOns: {
    code: 'VALIDITY' | 'HUMAN_SUPPORT_24X7' | 'EMAIL_SUPPORT' | string;
    title: string; shortTitle: string; description: string; icon?: string;
    priceMinor: number;                  // 0 today, shown as "Free"
    included: boolean;                   // true = always on, no checkbox
    config?: { validityDays?: number };  // VALIDITY: IN 30, GLOBAL 180
  }[];
  publishedAt?: Date;
  publishedBy?: string;                  // super admin userId
}
```

**Custom amounts** get a discount from an `AMOUNT_RANGE` rule. For the agreed model, the backend generates one rule per plan, covering amounts from that plan up to the next one. A custom ₹3,200 therefore gets the ₹2,499 plan's 25%, and a custom $350 gets the $299 plan's 46.5%. This matches the current UI.

**Add-ons have no backend support today,** but they are delivered anyway. The validity add-on is the only one that changes behaviour: its `validityDays` becomes the granted `CreditPlan.validityDays`. The support add-ons are display and entitlement records only. Carry-forward is not modelled, because nothing carries forward.

### 4.3 Coupon, CouponAccount and CouponRedemption

```ts
@Schema({ collection: 'coupons', timestamps: true })
class Coupon {
  code: string;                          // stored in upper case. Unique index
  region: 'IN' | 'GLOBAL';
  percentBps: number;                    // 1500 = 15% off checkout
  maxDiscountMinor?: number;             // optional cap
  listed: boolean;                       // true: offered in the coupon dialog to eligible accounts. false: typed only (e.g. emailed codes)
  title: string;                         // e.g. 'Founding customer offer'
  description: string;                   // customer-facing terms
  campaign: 'FOUNDING' | 'REFERRAL' | 'PARTNER' | 'WINBACK' | string;
  eligibility: {
    requiresKybApproved?: boolean;       // FOUNDING: companyVerificationStatus = Approved
    requiresTaxId?: string[];            // FOUNDING8: any of ['GSTIN', 'PAN']
    firstPurchaseOnly?: boolean;         // REFER*
    withinDaysOfKybApproval?: number;    // FOUNDING: 180, from companyVerificationApprovedAt
    minDaysSinceLastPurchase?: number;   // WINBACK: 60
    allowedOrgIds?: string[];            // WINBACK (emailed only), or partner cohorts
    partnerId?: string;                  // PARTNER
  };
  limits: {
    maxAccounts?: number;                // FOUNDING: first 500 entities
    maxRedemptions?: number;             // PARTNER: per-code cap on uses
    maxRedemptionsPerAccount?: number;   // FOUNDING: 3. WINBACK: 1
    startsAt?: Date; expiresAt?: Date;   // PARTNER: 90 days. WINBACK: 14 days from issue
  };
  accountCount: number;                  // distinct accounts holding a claim. Updated atomically
  redemptionCount: number;               // RESERVED + REDEEMED uses. Updated atomically
  status: 'ACTIVE' | 'PAUSED' | 'EXPIRED';
}

@Schema({ collection: 'couponAccounts', timestamps: true })
class CouponAccount {                    // one per (coupon, account). Unique index (couponId, orgId)
  couponId: string; orgId: string;   
  redemptions: number;                   // RESERVED + REDEEMED uses by this account
}

@Schema({ collection: 'couponRedemptions', timestamps: true })
class CouponRedemption {
  couponId: string; code: string; orgId: string;
  orderId: string;                       // unique index: one coupon per order
  status: 'RESERVED' | 'REDEEMED' | 'RELEASED';
  discountMinor: number;
  reservedUntil: Date;                   // the order's expiry
}
```

**Why `CouponAccount` exists.** "First 500 entities, 3 purchases each" is two limits: 500 *accounts* and 3 *uses per account*. A single `redemptionCount < 500` check would stop after 500 *uses*, which could be only 167 entities. At reservation time:

1. Upsert `CouponAccount (couponId, orgId)`. If it was inserted, increment `Coupon.accountCount` with `findOneAndUpdate({ _id, accountCount: { $lt: maxAccounts } }, { $inc: { accountCount: 1 } })`. If that fails, delete the claim and reject the coupon.
2. Increment `CouponAccount.redemptions` with a `$lt: maxRedemptionsPerAccount` guard, and `Coupon.redemptionCount` with a `$lt: maxRedemptions` guard when that limit is set.
3. Insert the `RESERVED` redemption.

Steps 1–3 run in one transaction. Releasing a reservation decrements the counters again. An account's claim is kept once it has a `REDEEMED` use, so it keeps its FOUNDING slot.

**Coupons at launch.** Only the two FOUNDING codes are active. Both are `listed`, so eligible customers see them in the coupon dialog.

| Code | Region | Off | Listed | Eligibility | Limits |
|---|---|---|---|---|---|
| FOUNDING15 | Global | 15% | Yes | First 500 KYB-approved accounts | 3 purchases each, within 180 days of KYB approval |
| FOUNDING8 | India | 8% | Yes | First 500 KYB-approved Indian accounts with a GSTIN or PAN | 3 purchases each, within 180 days of KYB approval |

**Designed but not active at launch.** The schema already supports these, so switching them on needs only data, apart from the referral job (§5.4).

| Code | Region | Off | Eligibility | Limits |
|---|---|---|---|---|
| REFER10 / REFER5 | Global / India | 10% / 5% | Referred by a paying customer | First purchase only. The referrer gets 5% of the order as bonus credits once the referee has used 50% |
| PARTNER10 / PARTNER5 | Global / India | 10% / 5% | Accelerator, chain or ecosystem cohorts | One code per partner, a maximum number of uses per code, expires in 90 days |
| WINBACK10 / WINBACK5 | Global / India | 10% / 5% | No purchase in 60+ days | One use, emailed only, expires in 14 days (unlisted) |

**Which coupons are listed.** The dialog lists only coupons that are `listed`, `ACTIVE`, for the account's region, **and that the account is eligible for right now** (for example, FOUNDING8 only after KYB approval and while the account has used it fewer than 3 times). A customer never picks a listed offer that is then rejected.

**Referrals** need one more collection:

```ts
@Schema({ collection: 'referrals', timestamps: true })
class Referral {
  referrerOrgId: string;
  refereeOrgId: string;                 // unique index: an account is referred at most once
  couponCode: string;
  status: 'PENDING' | 'QUALIFIED' | 'BONUS_GRANTED' | 'VOID';
  qualifyingOrderId?: string;
  bonusCredits?: number;
}
```

A job grants the referrer's bonus once the referee's qualifying plan reaches 50% used. The bonus is a `CreditPlan` with `source: 'REFERRAL_BONUS'` and `referenceId: 'referral:<referralId>'`.

### 4.4 Quote

A quote is a short-lived, server-priced snapshot. The popup asks for a new one every time the selection or coupon changes. Quotes are disposable: a TTL index on `expiresAt` deletes them, and an order copies everything it needs into `quoteSnapshot`.

```ts
@Schema({ collection: 'quotes', timestamps: true })
class Quote {
  orgId: string; appId: string; region; currency;
  priceBookId: string; priceBookVersion: number;
  selection: { planCode?: string; customAmountMinor?: number; couponCode?: string };
  lines: {
    subtotalMinor: number;               // the plan price or custom amount
    planDiscount: { percentBps: number; amountMinor: number; ruleId: string };
    coupon?: { code: string; percentBps: number; amountMinor: number };
    addOns: { code: string; title: string; priceMinor: 0 }[];
    totalBeforeTaxMinor: number;
    taxEstimate?: { amountMinor: number; breakdown: TaxLine[] };  // India only (§7)
  };
  credits: number;
  validityDays: number;
  expiresAt: Date;                       // 15 minutes. TTL index
}
```

**Rounding.** Each step rounds half-up to a whole minor unit, and coupons apply after the plan discount. Both examples match the popup:

- **₹2,499 with FOUNDING8:** the plan discount is 25% × 249900 = 62475, and the coupon is 8% × 187425 = 14994. The customer pays 172431 paise = **₹1,724.31**.
- **$299 with FOUNDING15:** the plan discount is 46.5% × 29900 = 13903.5, which rounds to 13904. The coupon is 15% × 15996 = 2399.4, which rounds to 2399. The customer pays 13597 cents = **$135.97**.

**Credits.** These are `floor(subtotalMinor × creditsPerMajorUnit / 100)`, based on the price before discount. All operands are integers, so there's no floating-point step.

### 4.5 Order, PaymentAttempt, WebhookEvent

```ts
@Schema({ collection: 'orders', timestamps: true })
class Order {
  orderNumber: string;                   // 'ORD-2026-000123', shown to the customer. From BillingCounter 'ORD/2026'
  orgId: string; appId: string;
  createdBy: string;                     // the dashboard user who clicked Pay (owner or team member)
  quoteId: string;
  quoteSnapshot: Quote['lines'] & { credits; validityDays; priceBookId; priceBookVersion };
  currency; region;
  amountDueMinor: number;                // before tax
  taxMinor?: number;                     // final, from the provider (Global) or our calculation (India)
  amountPaidMinor?: number;
  status: OrderStatus;                   // state machine below
  provider: 'stripe' | 'razorpay' | string;
  providerRefs: { checkoutId?: string; paymentId?: string; customerId?: string };
  checkoutUrl?: string;
  expiresAt: Date;                       // when the checkout session expires
  idempotencyKey: string;                // from the client. Unique index (orgId, idempotencyKey)
  invoiceId?: string;                    // set during fulfilment
  failureReason?: string;
}

@Schema({ collection: 'paymentAttempts', timestamps: true })
class PaymentAttempt {
  orderId?: string; invoiceId?: string;  // self-serve order, or super-admin invoice paid by link
  provider: string; providerPaymentId: string;  // unique index (provider, providerPaymentId)
  status: 'PENDING' | 'AUTHORIZED' | 'CAPTURED' | 'FAILED' | 'REFUNDED' | 'PARTIALLY_REFUNDED' | 'DISPUTED' | 'NEEDS_REVIEW';
  amountMinor: number; currency: string; method?: string;  // card / upi / netbanking / link …
  raw?: object;                          // trimmed provider payload, for support. No card or bank details
}

@Schema({ collection: 'webhookEvents', timestamps: true })
class WebhookEvent {
  provider: string;
  eventId: string;                       // unique index (provider, eventId): duplicates are skipped
  paymentAttemptId?: string;             // set once matched to a payment
  type: string;
  receivedAt: Date; processedAt?: Date;
  status: 'RECEIVED' | 'PROCESSED' | 'IGNORED' | 'FAILED';
  error?: string; attempts: number;
  payload?: object;                      // removed by a job after 90 days. The row stays for audit
}
```

Indexes: `orders (orgId, createdAt)` for purchase history, `orders (status, updatedAt)` for the reconciliation job, `paymentAttempts (orderId)` and `(invoiceId)`.

**Order state machine.** Transitions only move forward, and each one is a conditional update (`findOneAndUpdate({ _id, status: <from> }, …)`), the same pattern `CreditEventStore` uses for plan status. Late or duplicate events that would move an order backwards are recorded and ignored. The order is created as `PENDING_PAYMENT` only after the provider has returned a checkout. If that call fails, the order stays `CREATED` and the reconciliation job marks it `FAILED` after 15 minutes.

```mermaid
stateDiagram-v2
  [*] --> CREATED: POST /orders
  CREATED --> PENDING_PAYMENT: checkout session created
  CREATED --> FAILED: checkout creation failed
  PENDING_PAYMENT --> PAID: payment captured (webhook / reconciliation)
  PENDING_PAYMENT --> FAILED: payment failed
  PENDING_PAYMENT --> EXPIRED: session expired / abandoned
  CREATED --> CANCELLED: customer cancels
  PENDING_PAYMENT --> CANCELLED: customer cancels
  PENDING_PAYMENT --> NEEDS_REVIEW: amount / currency mismatch
  NEEDS_REVIEW --> PAID: admin approves
  NEEDS_REVIEW --> REFUNDED: admin refunds
  PAID --> FULFILLED: invoice issued + credits granted
  FULFILLED --> REFUNDED: full refund
  FULFILLED --> PARTIALLY_REFUNDED: partial refund
  FULFILLED --> DISPUTED: chargeback opened
  DISPUTED --> FULFILLED: dispute won
  DISPUTED --> REFUNDED: dispute lost
  FAILED --> [*]
  EXPIRED --> [*]
```

### 4.6 CreditPlan (existing, extended)

We keep the existing `CreditPlan` document and the whole credit pipeline unchanged: `CreditService.grantCredit` → `CreditCommandService.grantCreditPlan` → credit middleware → `CREDIT_GRANTED` → plan set to `Active`. Billing calls `grantCredit` with a `source` and a `referenceId`, exactly as onboarding does today. Only two fields are added:

```ts
{
  invoiceId?: string;        // NEW. The invoice that paid for this plan. Plain index, for joins in purchase history
  revokedCredits?: number;   // NEW. Set by a refund or a lost dispute. Remaining = total - used - revokedCredits
}
```

- **Idempotency is already there.** Every invoiced grant uses `referenceId = 'invoice:<invoiceId>'`. The existing unique `{ serviceId, referenceId }` index and `grantCredit`'s "same referenceId, same semantics" check mean a retried fulfilment can't grant twice. We don't need new unique `orderId`/`invoiceId` indexes.
- **Source values:** `PAYMENT` (self-serve), `MANUAL_RECHARGE` (super-admin invoice, any settlement), `REFERRAL_BONUS` and `PROMO` (new), and the existing `CUSTOMER_ONBOARDING`, `MIGRATION` and `ADJUSTMENT`. Existing documents keep their values.
- **Validity.** `validityDays` already exists, and `expiresAt` is set at activation from `validityDays`. Billing APIs take **days only**. `getCreditValidity` turns months into `ceil(n × 30.4375)` days but sets `expiresAt` with `setUTCMonth`, so the two can differ by a day. The invoice prints `validityDays`, and `expiresAt` is computed from it.
- **No `PENDING_PAYMENT` plan.** For an unpaid super-admin invoice, **no `CreditPlan` is created until the invoice is paid.** The credits and validity sit on the invoice (§4.7). The existing code makes a "pending" plan unsafe:
  - `POST /app/:appId/credits/:creditId/activate` is open to customers (it is excluded from `SuperAdminMiddleware`) and doesn't check the plan's status.
  - `CreditEventStore.processCriticalBalance` automatically activates any `Inactive` plan without `expiresAt` when the current plan reaches its critical balance.

  Either path would activate unpaid credits. Purchase history shows "Awaiting payment" rows from unpaid invoices instead (§10).
- **Activation of paid credits.** Today a new plan stays `Inactive` while another plan is `Active`. It then waits for the customer's **Activate** click, or for the automatic activation at critical balance (40% left). Purchased plans should instead be granted straight to the middleware as `Active`, which supports several active plans and draws from the oldest first. This needs a `grantCredit` option to skip the queue (open question 8).
- **Revocation needs a middleware change.** The credit middleware has a `REVOKED` plan status but **no command to set it** ("reserved for an explicit future command"), and plans are immutable. Refunds and lost disputes therefore need a new `credit.revoke.requested` command in `@hypersign-protocol/credit-middleware` before they can remove unused credits (§11, phase 6).

### 4.7 Invoice, PaymentLink, CreditNote and BillingCounter

```ts
@Schema({ collection: 'invoices', timestamps: true })
class Invoice {
  invoiceNumber: string;                 // sequential per series, no gaps (§8.3). Unique index
  series: 'IN' | 'GL';
  financialYear?: string;                // India: '2026-27'
  source: 'SELF_SERVE' | 'ADMIN';
  orderId?: string;                      // SELF_SERVE only. Unique sparse index
  orgId: string; appId: string;
  createdBy?: string;                    // ADMIN: the super admin who created it
  idempotencyKey?: string;               // ADMIN: unique sparse index (createdBy, idempotencyKey)
  issuedAt: Date;
  dueAt?: Date;                          // ADMIN unpaid: the payment link's expiry
  status: 'UNPAID' | 'PAID' | 'VOID';
  settlement?: 'GATEWAY' | 'OFFLINE' | 'COMPLIMENTARY';  // set when PAID
  note?: string;                         // ADMIN: internal reason, not printed
  supplier: { legalName; address; gstin?; pan?; email; sac?: string };  // snapshot of our own entity, from config
  customer: Pick<BillingDetails, 'legalName' | 'email' | 'address' | 'taxIds' | 'gstStateCode' | 'region'>;  // copied from CustomerOnboarding.billing, never live-linked
  placeOfSupply?: string;                // India: state code
  lines: { description; sac?; quantity: 1; unitPriceMinor; discountMinor; taxableMinor }[];
  addOnLines: { code; title }[];         // printed as "Included"
  tax: { type: 'CGST' | 'SGST' | 'IGST' | 'VAT' | 'SALES_TAX' | 'ZERO_RATED_EXPORT'; rateBps; amountMinor; jurisdiction? }[];
  totals: { subtotalMinor; discountMinor; taxableMinor; taxMinor; totalMinor; amountPaidMinor };
  currency;
  fx?: { inrPerUnit: number; rateDate: Date; totalInrMinor: number };  // USD invoices: INR value for GST and export reporting
  payment?: {
    provider?: string; paymentId?: string; method?: string;  // GATEWAY
    reference?: string;                  // OFFLINE: UTR, cheque number, other system's receipt id
    paidAt: Date;
  };
  activePaymentLinkId?: string;          // ADMIN unpaid: the current link (older ones are EXPIRED or CANCELLED)
  credits: number; validityDays: number; // what will be or was granted
  creditPlanId?: string;                 // set once the credits are granted (PAID only)
  eInvoice?: { irn: string; ackNo: string; ackDate: Date; signedQr: string };  // India B2B, if e-invoicing applies (§8.4)
  templateVersion: string;               // e.g. 'invoice-v1' (§8.3)
  firstRenderSha256?: string;            // hash of the PDF as first sent, for evidence
  voidedAt?: Date; voidReason?: string;
}

@Schema({ collection: 'paymentLinks', timestamps: true })
class PaymentLink {
  invoiceId: string;                     // an invoice can have several over time (expired, then a new one)
  provider: string;                      // chosen by region, like checkout
  providerLinkId: string;                // unique index (provider, providerLinkId)
  url: string;
  amountMinor: number; currency: string; // the invoice total including tax
  status: 'ACTIVE' | 'PAID' | 'EXPIRED' | 'CANCELLED';
  expiresAt: Date;                       // default 15 days
  sentTo: string[];                      // billing email + any extra recipients
  remindersSent: number;
}

@Schema({ collection: 'creditNotes', timestamps: true })
class CreditNote {
  creditNoteNumber: string;              // own series (§8.3). Unique index
  invoiceId: string;
  reason: 'REFUND' | 'DISPUTE_LOST' | 'CORRECTION';
  amountMinor: number; taxMinor: number;
  creditsRevoked: number;
  refundId?: string;                     // provider refund id, for GATEWAY invoices
  templateVersion: string; firstRenderSha256?: string;
}

@Schema({ collection: 'billingCounters', versionKey: false })
class BillingCounter {
  _id: string;                           // 'INV/IN/2026-27', 'INV/GL/2026', 'CN/IN/2026-27', 'ORD/2026'
  seq: number;
}
```

Indexes on `invoices`: `(orgId, issuedAt)` for the customer list, `(appId, issuedAt)` for purchase history, `(status, dueAt)` for the payment-link job, and `(issuedAt)` for exports.

**Fulfilment order.** For every invoice that settles (self-serve `PAID`, or an admin invoice when it is created paid or later becomes paid), one transaction does three things: it increments the `BillingCounter`, inserts or updates the invoice, and moves the order or invoice status forward. After the commit, `grantCredit(appId, …, source, 'invoice:<invoiceId>')` runs. The plan is then looked up by `{ serviceId, referenceId }` and its id is written back to `creditPlanId`, because `grantCredit` returns only a message today; alternatively, change it to return the plan. If the grant fails it is retried: the `referenceId` makes it idempotent, and a job alerts on `PAID` invoices still without a `creditPlanId` after 10 minutes. The grant is not inside the transaction because it publishes to BullMQ and Redis, which can't take part in a Mongo transaction.

## 5. APIs

All endpoints live in this service under the existing `/api/v1` prefix (so `GET /billing/profile` below is `GET /api/v1/billing/profile`). Customer endpoints use the same middleware chain as `CreditsController`: `JWTAuthorizeMiddleware`, then `JWTAccessAccountMiddleware` (which maps a team member to the owner's `userId`), then `RateLimitMiddleware`. The owner's `userId` is resolved once to the organisation id (`orgId = CustomerOnboarding._id`, §4.0) and cached in the session next to `tenantId`. Every billing query is scoped to that `orgId`, and `appId` is checked to belong to the organisation (`App.orgId`). Write calls need the new `WRITE_BILLING` access type and read calls need `READ_BILLING` (§4.0). The webhook route is excluded from all three middlewares.

### 5.1 Customer

| Method & path | Purpose | Notes |
|---|---|---|
| `GET /billing/profile` | Get the billing profile (`CustomerOnboarding.billing`) | Prefilled from onboarding/KYB if `billing` isn't set yet. |
| `PUT /billing/profile` | Complete or update billing details | Once `locked`, changing the region or tax ID returns `409` and needs a support review. |
| `GET /billing/catalog` | Get the published price book (plans, discounts, add-ons, custom limits and `calculatorFlowIds`) for the caller's region | Used to render the popup and to filter the Credit Calculator. Coupons are not included. |
| `GET /billing/coupons?appId&planCode\|customAmountMinor` | Listed coupons the account is eligible for right now, with `code`, `title`, `description`, `percentBps` and `previewDiscountMinor` for the current selection | Feeds the **Apply a coupon** dialog, including its "Saves ₹x on this top-up" line. Never returns unlisted codes or eligibility rules. |
| `POST /billing/quotes` | Price a selection: `{ appId, planCode \| customAmountMinor, couponCode? }` → `Quote` | Called again when the selection or coupon changes. Invalid coupon → `422 { code: 'COUPON_INVALID' }`. Rate-limited. |
| `POST /billing/orders` | `{ quoteId }` + `Idempotency-Key` header → `{ orderId, checkoutUrl, expiresAt }` | Re-checks the quote and coupon, reserves the coupon, and creates the provider checkout. |
| `GET /billing/orders/:orderId` | Order status | Polled by the payment return page. |
| `POST /billing/orders/:orderId/cancel` | Abandon an unpaid order | Releases the coupon reservation. |
| `GET /billing/orders?appId&status&page` | Purchase history | Feeds "Credit Purchase History". |
| `GET /billing/invoices?status&page` | List invoices and credit notes | Unpaid super-admin invoices are included, with a **Pay now** link to their payment link. |
| `GET /billing/invoices/:invoiceId/download` | Download a PDF | Renders the PDF on request from the stored invoice and streams it (`Content-Disposition: attachment`). Nothing is stored as a file. |
| `POST /billing/invoices/:invoiceId/email` | Resend an invoice to the billing email | Rate-limited. |

**Coupon error responses (agreed with Business).** Every rejected code returns the same `COUPON_INVALID` code: unknown, wrong region, expired, already used or not eligible. The UI always shows "This coupon code is not valid." This stops people discovering codes, and avoids region wording that Indian customers found confusing (for example "only valid for Global billing").

### 5.2 Payment provider webhooks (public)

| Method & path | Purpose |
|---|---|
| `POST /billing/webhooks/:provider` | Receives provider events. It uses the **raw body** for signature checks, stores a `WebhookEvent`, returns `200` quickly, and processes the event in a BullMQ job. `main.ts` registers `json()` globally, so the raw bytes must be kept with `json({ limit: '10mb', verify: (req, _res, buf) => (req.rawBody = buf) })`. Alternatively, use `NestFactory.create(AppModule, { rawBody: true })` and drop the extra global `json()`, so the two body parsers don't conflict. |

### 5.3 Super admin

All of these sit behind the existing `SuperAdminMiddleware` (`UserRole.SUPER_ADMIN`).

| Method & path | Purpose |
|---|---|
| `GET/POST/PATCH /admin/billing/price-books` | Manage draft price books. Plans, discount rules and add-ons are edited as part of the draft document. |
| `POST /admin/billing/price-books/:id/publish` | Publish a version (the previous one becomes `RETIRED`). |
| `GET/POST/PATCH /admin/billing/coupons`, `POST /admin/billing/coupons/:code/issue` | Manage coupons. `issue` creates per-account WINBACK codes or per-partner PARTNER codes. |
| `GET /admin/billing/coupons/:code/redemptions` | See who used a code. |
| `GET /admin/billing/orders?status&orgId&provider&from&to` | Search orders and payments. |
| `POST /admin/billing/orders/:id/refund` `{ amountMinor?, revokeCredits, reason }` | Full or partial refund. Issues a credit note. Revoking credits needs the middleware revoke command (§4.6). |
| `POST /admin/billing/orders/:id/reconcile` | Re-fetch the order's status from the provider. |
| `GET /admin/billing/profiles?appId` | Look up the billing profile of the organisation that owns the app (`App.orgId` → `CustomerOnboarding`): legal name, address, tax IDs, region and currency. Feeds the **Billed to** card on the recharge page, and the GST preview. |
| `PATCH /admin/billing/profiles/:orgId` | Unlock or correct a region or tax ID. |
| `POST /admin/billing/invoices` + `Idempotency-Key` | Create a super-admin invoice: `{ appId, credits, validityDays, amountMinor, isPaid, payment?: { method, reference, paidAt }, recipients?, note? }`. The account, region and currency come from the app's billing profile. `credits` and `validityDays` are whole numbers; the UI converts months to days. Returns the invoice and, when unpaid, its payment link. See §8.2. |
| `GET /admin/billing/invoices?orgId&appId&status&source&settlement&from&to` | Search all invoices. |
| `POST /admin/billing/invoices/:id/mark-paid` `{ paymentReference }` | Settle an unpaid invoice that was paid outside the link. Cancels the link and activates the credits. |
| `POST /admin/billing/invoices/:id/payment-link` | Create a new link after the old one expired. |
| `POST /admin/billing/invoices/:id/remind` | Email the payment link again. |
| `POST /admin/billing/invoices/:id/void` `{ reason }` | Void an unpaid invoice. Cancels the link. No credits exist yet, so there is nothing to remove. Paid invoices can't be voided; they need a refund and credit note. |
| `GET /admin/billing/exports/invoices?from&to&format=csv` | Export invoices and credit notes for GST returns (GSTR-1) and accounting software. |
| `POST /api/v1/app/:appId/credits` *(existing)* | Kept for SSI Service recharges. For ID Service apps it returns `409 USE_INVOICES` once phase 2 ships. Invoice settlement calls `CreditService.grantCredit` directly, not over HTTP. |

### 5.4 Background jobs

| Job | Schedule | Does |
|---|---|---|
| Webhook processor | queue | Applies `WebhookEvent`s to orders. Retries with backoff, then dead-letters and alerts. |
| Reconciliation | every 10 min | For `PENDING_PAYMENT` orders older than 15 minutes, asks the provider and applies the result. Then expires stale orders and releases their coupons. |
| Fulfilment | on `PAID` | Issues the invoice (counter + insert in one transaction), grants the `CreditPlan` with `referenceId 'invoice:<id>'`, emails the customer with the PDF, and sets the order to `FULFILLED`. |
| Grant watchdog | every 10 min | Retries `grantCredit` for `PAID` invoices without a `creditPlanId`, and alerts after 3 failures. |
| Referral bonus | hourly | Grants referrer bonuses for qualified referrals. |
| Webhook payload cleanup | daily | Removes `payload` from `WebhookEvent`s older than 90 days. |
| Daily settlement check | daily | Compares provider settlement reports with `PAID` orders and gateway-paid invoices, and reports any differences. |
| Payment link follow-up | daily | Sends reminders for unpaid super-admin invoices (for example at 3 and 7 days), marks expired links `EXPIRED`, and alerts the invoice's creator. |

## 6. Payment gateway abstraction

```ts
interface PaymentProvider {
  readonly id: string;                                   // 'stripe' | 'razorpay' | …
  supports(region: Region, currency: Currency): boolean;

  ensureCustomer(profile: BillingDetails): Promise<string>;           // provider customer id
  createCheckout(input: {
    order: Order; profile: BillingDetails;
    successUrl: string; cancelUrl: string; expiresAt: Date;
    collectTax: boolean;                                              // Global: let the provider calculate tax
  }): Promise<{ checkoutId: string; checkoutUrl: string; expiresAt: Date }>;

  createPaymentLink(input: {
    invoice: Invoice; profile: BillingDetails; expiresAt: Date; notify: { email: string[] };
  }): Promise<{ providerLinkId: string; url: string; expiresAt: Date }>;   // Razorpay Payment Links, Stripe Payment Links
  cancelPaymentLink(providerLinkId: string): Promise<void>;

  verifyWebhook(headers: Record<string, string>, rawBody: Buffer): ProviderEvent;  // throws if the signature is bad
  normalize(event: ProviderEvent): NormalizedEvent | null;           // null = event type we don't use
  getPayment(ref: { checkoutId?: string; paymentId?: string }): Promise<NormalizedPayment>;  // reconciliation
  refund(paymentId: string, amountMinor: number, reason: string): Promise<{ refundId: string }>;
}

type NormalizedEvent = {
  kind: 'PAYMENT_SUCCEEDED' | 'PAYMENT_FAILED' | 'CHECKOUT_EXPIRED' | 'PAYMENT_LINK_EXPIRED'
      | 'REFUND_SUCCEEDED' | 'DISPUTE_OPENED' | 'DISPUTE_WON' | 'DISPUTE_LOST';
  eventId: string;
  orderId?: string; invoiceId?: string;      // one of them travels in provider metadata / notes
  paymentId?: string; amountMinor: number; taxMinor?: number; currency: string;
  occurredAt: Date;
};
```

- **`PaymentRouter`** picks the provider from config (`{ IN: 'razorpay', GLOBAL: 'stripe' }`) behind a feature flag, so we can switch or add a provider without code changes. Each order keeps its provider for its whole life, so refunds and reconciliation always go to the gateway that took the payment.
- **Gateways do two jobs only: checkout sessions (self-serve) and payment links (super-admin invoices).** They never issue invoices, and no gateway feature is needed beyond those two, so any gateway that supports them can be added.
- **Domain code only ever sees `NormalizedEvent`.** Provider-specific fields stay inside the adapter and in `providerRefs` / `raw`.
- **Hosted pages only in v1:** Stripe Checkout Session, and Razorpay Payment Link or hosted checkout. The Pay button redirects to `checkoutUrl`, as the UI expects, and card data never touches our servers.
- **Recommended providers:** **Stripe** for Global (USD, cards, Apple/Google Pay, Link, and Stripe Tax for tax by jurisdiction) and **Razorpay** for India (INR, UPI, netbanking, cards and RBI-compliant flows). Final choice: open question 1.
- **Adding a provider** means writing one adapter, its webhook route, its config entry and a contract test suite. Every adapter must pass the same suite: create, succeed, fail, expire, duplicate webhook, refund.

### 6.1 Purchase flow

```mermaid
sequenceDiagram
  actor U as Customer
  participant D as Dashboard
  participant A as Entity API
  participant P as Provider (hosted)
  participant J as Jobs

  U->>D: Open Top up, pick plan / coupon
  D->>A: POST /billing/quotes
  A-->>D: Quote (amounts, credits, expiresAt)
  U->>D: Pay
  D->>A: POST /billing/orders {quoteId} + Idempotency-Key
  A->>A: re-validate quote + coupon, reserve coupon
  A->>P: createCheckout(order, metadata.orderId)
  A-->>D: checkoutUrl
  D->>P: redirect
  U->>P: Pay (tax shown here for Global)
  P-->>A: webhook payment.succeeded
  A->>A: verify signature, store event, 200
  A->>J: process event
  J->>J: Order → PAID → Invoice → grantCredit (CreditPlan) → email + PDF → FULFILLED
  P->>D: redirect to /credits/payment/return?orderId=…
  D->>A: GET /billing/orders/:id (poll until FULFILLED / FAILED)
  D-->>U: "2,499 credits added" + Download invoice
```

## 7. Tax

- **Global (Stripe).** The provider calculates tax (Stripe Tax) from the address collected at checkout. The popup's text "Final tax is calculated on the secure payment page" is accurate for this region. The final `taxMinor` comes from the success event and is written onto the invoice. For customers outside India this is an export of services, which may be zero-rated GST under a LUT; Finance needs to confirm (open question 3).
- **India.** GST at 18% applies to the amount after discounts. The tax type depends on where the customer is:
  - **Same state as our registered entity:** CGST 9% + SGST 9%.
  - **Any other state:** IGST 18%.

  The place of supply comes from the GSTIN's state code, or from the billing address state for B2C customers. Razorpay does not calculate GST, so **we calculate it in the quote**. We should then show "GST (18%) ₹x" in the popup instead of the "calculated on the payment page" text, so the amount on the Razorpay page matches what the customer saw. This is a small UI change (open question 4).
- **Super-admin invoices.** The amount the admin enters excludes tax, and we add tax with the same calculation as the quote. For India this means GST. For Global, offline and link payments don't go through Stripe Checkout, so Stripe Tax's calculation API (or a Finance decision to zero-rate exports) is needed. Open question 12.
- **Complimentary (₹0) invoices** carry no tax.
- **Invoice SAC code.** Business needs to confirm it (likely 998314 or 998319).

## 8. Invoices

Our system owns invoicing. Gateways never issue invoices and we never rely on theirs, so every invoice looks the same and follows the same rules whichever gateway took the money, or whether money was taken at all.

### 8.1 When an invoice is created

| Source | Created when | Starts as | Credits |
|---|---|---|---|
| Self-serve top-up | The order reaches `PAID` (during fulfilment) | `PAID`, settlement `GATEWAY` | Granted `Active` |
| Super admin, amount 0 | The admin creates it | `PAID`, settlement `COMPLIMENTARY` | Granted `Active` straight away |
| Super admin, `isPaid = true` | The admin creates it | `PAID`, settlement `OFFLINE` | Granted `Active` straight away |
| Super admin, `isPaid = false` | The admin creates it | `UNPAID`, with a payment link | None until paid. Shown as "Awaiting payment" from the invoice. Granted `Active` when paid |

Abandoned self-serve checkouts never create an invoice, so they don't use up invoice numbers.

### 8.2 Super-admin invoices

Super-admin invoices are created from the existing **Super Admin › Recharge Service Credits** page, when **ID Service** is selected. The page is a sequence of three steps with a summary panel on the right:

1. **Application.** The admin enters the App ID. A **Billed to** card then shows the account's legal name, address, GSTIN, region and currency (`GET /admin/billing/profiles?appId`).
2. **Credits and validity.** The number of credits, and validity in months and days. Validity is prefilled from the region's validity add-on (1 month for India, 6 months for Global) and can be changed. **Understand Credit?** opens the Credit Calculator.
3. **Invoice.** The admin picks one of three choices, which set `amount` and `isPaid` for the backend:

| Choice | Sends | Admin also fills in | Result |
|---|---|---|---|
| **Free credits** | `amount = 0` | Nothing | Invoice `PAID · COMPLIMENTARY`. Credits active now |
| **Already paid** | `amount > 0`, `isPaid = true` | Amount excluding tax, payment method, payment reference, paid-on date | Invoice `PAID · OFFLINE`. Credits active now |
| **Collect payment** | `amount > 0`, `isPaid = false` | Amount excluding tax, who receives the payment link | Invoice `UNPAID` with a payment link. Credits granted once paid |

| Field | Rules |
|---|---|
| App | Required. The billing profile must be complete (edge case 36). |
| Credits | Required, whole number above 0. Separate from the amount, because a ₹0 invoice still grants credits. |
| Validity | Required, above 0 days. |
| Amount | Required for **Already paid** and **Collect payment**, **excluding tax**. The GST line and total are previewed as the admin types (for example "+ IGST 18% ₹7,200.00 = ₹47,200.00"). |
| Payment method | **Already paid** only: Bank transfer, UPI, Cheque, Card (outside dashboard) or Other system. |
| Payment reference | **Already paid** only, required: the UTR, cheque number or other system's receipt ID, printed on the invoice for audit and reconciliation. |
| Paid on | **Already paid** only, required, not in the future. |
| Send payment link to | **Collect payment** only. Comma-separated emails, defaulting to the billing email. |
| Internal note | Optional. Not printed on the invoice. |

**Summary panel.** It shows credits, validity, amount, each tax line, the invoice total, the status the invoice will be issued with, and when the credits become active. It also lists any missing fields. The button label follows the choice: "Add free credits", "Recharge and issue paid invoice" or "Create invoice and send link". A confirmation popup repeats everything before anything is created.

**After creating,** a result card shows the invoice number, customer, credits and total, with **Download invoice** (the same PDF the customer gets). For **Collect payment** it also shows the payment link with **Copy**, who it was sent to, and when it expires.

**SSI Service** uses the same step layout for consistency (Application, Credits and validity, Summary), but issues no invoice. It keeps today's **Execute Recharge**, and its credits are active immediately (open question 16).

```mermaid
flowchart TD
  A[Super admin creates invoice] --> B{Amount}
  B -->|0| C[Invoice PAID · COMPLIMENTARY]
  B -->|above 0| D{isPaid}
  D -->|true| E[Invoice PAID · OFFLINE<br/>with payment reference]
  D -->|false| F[Invoice UNPAID<br/>no credits yet]
  F --> G[Gateway payment link<br/>emailed to billing contact]
  G -->|webhook: paid in full| H[Invoice PAID · GATEWAY]
  G -->|link expires| I[Reminder / new link<br/>or admin voids]
  F -->|paid another way| J[Admin marks paid<br/>with reference]
  J --> E
  I -->|void| K[Invoice VOID<br/>no credits granted]
  C --> L[Credits Active · PDF · email]
  E --> L
  H --> L
```

- **Credits wait for money.** For an unpaid invoice no `CreditPlan` exists. The invoice holds `credits` and `validityDays`, and the dashboard shows them as "Awaiting payment". Only a verified payment webhook, or an admin marking the invoice paid, settles the invoice and grants the plan. Validity starts at that moment. See §4.6 for why we don't create a pending plan.
- **Payment links** use the region's gateway through `createPaymentLink` (§6). The link is for the invoice total including tax, expires after 15 days by default, and carries the `invoiceId` in its metadata. The customer can also open it from **Pay now** in Billing & Invoices.
- **Who can do what.** Creating invoices needs `UserRole.SUPER_ADMIN` (the existing `SuperAdminMiddleware`); a narrower billing-admin role is open question 13. Marking an invoice paid (`isPaid = true` or **mark paid**) and creating complimentary invoices are recorded in the audit log with the admin, reference and reason. Optionally, they can need a second approver above a set amount (open question 13).
- **Voiding.** Only unpaid invoices can be voided. Voiding cancels the link and keeps the invoice number, marked `VOID`. No credits were granted, so none are removed. A paid invoice is corrected with a refund and a credit note.
- **Idempotency.** Create calls take an `Idempotency-Key`, so a double click can't issue two invoices.

**Unpaid invoices get their number when issued.** Customers' finance teams pay against an invoice number, so an unpaid super-admin invoice is a real tax invoice from the start. If it is never paid, it is voided and keeps its number. This is allowed before the GST return for that period is filed; after that, a credit note is needed. The alternative is to send a numbered *proforma invoice* and issue the tax invoice only on payment (open question 11).

### 8.3 Numbering, content, PDF and download

- **Numbering:** a gap-free sequence per series, allocated with an atomic counter (`findOneAndUpdate({ _id }, { $inc: { seq: 1 } }, { upsert: true })` on a `billingCounters` document) in the same Mongo transaction as the invoice insert. A rolled-back transaction rolls back the increment too, so no number is lost. Self-serve and super-admin invoices share the series.
  - **India:** `HS/IN/2026-27/000123`. The number resets every 1 April, as GST requires.
  - **Global:** `HS/GL/2026/000123`.
  - **Credit notes** have their own series: `HS/IN-CN/…`.
- **Design (template `invoice-v1`, agreed for sign-off):** A4, Roboto, the theme's navy and blue, and the black Hypersign wordmark (`src/assets/Entity_full.png`).
  - **Header:** the Hypersign logo on the left. On the right are **TAX INVOICE**, the invoice number and a status badge: **PAID** (blue), **PAYMENT DUE** (amber), **COMPLIMENTARY** or **VOID** (grey).
  - **Three columns:**
    - **Billed by:** our legal name, address, GSTIN, PAN and billing email.
    - **Billed to:** the customer's legal name, address, GSTIN and email.
    - **Invoice details:** number, issue date, paid-on or due date, place of supply, order number (self-serve) and app.
  - **Line items:** "Prepaid verification credits", with the credits, validity and app underneath, the SAC code, quantity and amount. Below that, the add-ons as lighter **Included** rows, with no SAC or quantity.
  - **Totals:** subtotal, plan discount, coupon, taxable value, GST (IGST 18%, or CGST 9% + SGST 9% within our state), total, amount paid and balance due. Balance due turns amber when it isn't zero.
  - **Amount in words:** Indian numbering (lakh, crore) for INR, and international numbering for USD.
  - **Payment panel:** "Paid on … · UPI via Razorpay · Payment ID …", "Paid on … · Bank transfer · Reference …", "Complimentary credits · No payment is due", or for unpaid invoices "Payment due by …", the payment link and a **QR code** for it.
  - **Notes:** the validity terms, "activated once the payment is confirmed" for unpaid invoices, and "Tax is payable on reverse charge: No." for India.
  - **Footer:** "This is a computer-generated invoice and does not need a signature", the billing email and page numbers.
- **PDF, rendered on request, not stored.** An invoice's data is copied in when it's issued and never edited, so rendering it again with the same template always produces the same document. We therefore don't keep PDF files in a bucket. The server renders the PDF whenever it is downloaded or emailed. This works under three conditions:
  - **Versioned templates.** Each invoice records its `templateVersion`, and old template versions stay in the code. A redesign creates a new version, used only for new invoices, so past invoices never change.
  - **Fixed assets.** Fonts and the Hypersign logo are bundled with the renderer, never fetched from a URL.
  - **Data is the record.** The invoice data is kept for 8 years (the legal retention). We store a SHA-256 hash of the PDF as first sent to the customer, as evidence of what they received.

  **Library:** `pdfmake`, which the dashboard already uses. It isn't a dependency of this service yet, so it needs adding. The layout lives in one module with no browser code (`src/components/credit/invoice/invoiceDocument.js`, built for UI sign-off). The same module runs in Node on the server, so the dashboard prototype and the backend produce the same PDF. Rendering one invoice takes milliseconds, so storage isn't needed for performance either.

  **Paid status:** an unpaid invoice shows "Payment due" and a QR code for its payment link. Once paid, it renders as "Paid" automatically, because the status is part of its data. Its amounts never change.
- **Download:** in the dashboard, in each row of **Credits Management › Credit Purchase History** (invoice number, status, total, **Download**, and **Pay now** when unpaid), and later under **Billing & Invoices**. `GET /billing/invoices/:id/download` checks that the invoice's `orgId` is the caller's organisation, and `READ_BILLING`, then streams the PDF. The PDF is attached to an email to the billing contact on issue, and again when an unpaid invoice is paid. It can be resent. `MailNotificationService.addAJob` has no attachments today (open question 19).
- **Immutability:** invoice amounts and details are never edited. Refunds and corrections produce a **credit note** that links to the original invoice. If billing details were wrong, we void the invoice and reissue it, only before the GST filing period closes, and that needs admin action.
- **Retention:** at least 8 years (Indian GST and Income Tax rules).
- **Provider receipts:** a gateway's receipt URL, if it has one, is stored and may be linked as "Payment receipt", but our invoice is the legal document.

### 8.4 Compliance and exports

- **GST e-invoicing.** If our annual turnover is above the e-invoicing threshold (currently ₹5 crore), every Indian B2B invoice must be registered with the government's Invoice Registration Portal before it is sent. The invoice then carries an IRN and a signed QR code (`eInvoice` in §4.7). This adds an IRP call to issuing, which retries on failure and holds the PDF until it succeeds. Finance confirms whether this applies (open question 14).
- **USD invoices** also record the INR value at the exchange rate on the invoice date (`fx` in §4.7), for GST and export reporting.
- **Exports.** `GET /admin/billing/exports/invoices` produces a CSV of invoices and credit notes in a format that GSTR-1 filing and accounting software (Tally or Zoho Books) can import.

## 9. Edge cases

| # | Situation | Handling |
|---|---|---|
| 1 | Price book changes between quote and payment | The quote records its price book version. The order honours the quote until `quote.expiresAt` (15 min). If the quote has expired, `POST /orders` returns `409 QUOTE_EXPIRED` and the UI quietly gets a new one. |
| 2 | Customer double-clicks Pay, or opens two tabs | The `Idempotency-Key` returns the same order and `checkoutUrl`. Only one open order is allowed per quote. |
| 3 | Customer closes the gateway page or never pays | The provider session expires (Stripe minimum 30 min). An `EXPIRED` webhook or the reconciliation job expires the order and releases the coupon. |
| 4 | Payment succeeds but the redirect back fails or the browser closes | Only the webhook drives fulfilment. The next time the customer opens the dashboard the credits are already there, and the confirmation email is sent anyway. |
| 5 | Webhook duplicated, out of order, or arriving before the redirect | A unique `(provider, eventId)` index skips duplicates. The forward-only state machine ignores late or backwards events. The return page polls the order. |
| 6 | Webhook never arrives (provider or network issue) | The reconciliation job polls the provider for stuck `PENDING_PAYMENT` orders. We alert if any order stays pending for more than 1 hour. |
| 7 | Paid amount or currency differs from the order | Do not grant credits. Mark the order `NEEDS_REVIEW`, alert, and let an admin resolve it. |
| 8 | Delayed payment methods (UPI pending, netbanking, 3DS) | The order stays `PENDING_PAYMENT` until capture. The UI shows "Payment processing; credits will appear once confirmed". Razorpay is set to auto-capture. |
| 9 | Two accounts race for the last FOUNDING slots (first 500 accounts) | Claim atomically at order creation: a unique `CouponAccount (couponId, orgId)` plus `findOneAndUpdate({ _id, accountCount: { $lt: maxAccounts } }, { $inc: { accountCount: 1 } })`, in one transaction (§4.3). Release on failure or expiry, unless the account already has a `REDEEMED` use. Reservations count toward the 500 while they're held. |
| 10 | A coupon becomes invalid between quote and order (expired, limit reached) | `POST /orders` re-validates and returns `422 COUPON_INVALID`. The UI removes the coupon, shows the new total and asks the customer to confirm. |
| 11 | Coupon limits like "first 3 purchases" or "first purchase only" | `CouponAccount.redemptions` counts the account's uses of that coupon. "First purchase only" checks that the account has no `FULFILLED` order and no paid invoice. Whether a refunded order still counts is open question 5. |
| 12 | Brute-forcing coupon codes | Rate-limit quote calls that include a coupon (for example 10 per account per 10 min). Use generic error messages. Partner and winback codes get random suffixes. |
| 13 | Self-referral, or the same company with several accounts | Reject when referrer and referee share a GSTIN/PAN, domain or KYB identity. The referral moves to `VOID`. |
| 14 | Customer changes billing country or region | The profile is `locked` after the first paid order. Changes go through an admin, and any open orders are cancelled. Existing credits are not converted. |
| 15 | Onboarding or KYB not complete | Purchases are allowed, but invoices need a complete billing profile, so the UI asks for it before checkout. FOUNDING coupons need `CustomerOnboarding.companyVerificationStatus = Approved` and `companyVerificationApprovedAt` within 180 days. Whether KYB should be required to buy at all is open question 7. |
| 16 | Custom amount out of range, with decimals, or not a number | The server checks it is a whole number of major units between `custom.minMinor` and `custom.maxMinor`, otherwise it returns `422 AMOUNT_OUT_OF_RANGE`. Larger amounts go to "Talk to sales". |
| 17 | Rounding drift between UI and server | The UI only displays amounts from the server quote. Shared fixtures (₹2,499 + FOUNDING8 = ₹1,724.31; $299 + FOUNDING15 = $135.97) are tested on both sides. |
| 18 | Existing unexpired credits when a new top-up lands | Each top-up is its own `CreditPlan` with its own `expiresAt`, and there is no carry-forward. Today a new plan waits as `Inactive` until the customer clicks **Activate** or the current plan reaches its critical balance (40% left). Proposed: purchased plans become `Active` immediately, and the middleware draws from the oldest active plan first (open question 8). |
| 19 | Refund after some credits are used | Admin only. Default: refund the unused credits pro rata, revoke those credits (`revokedCredits`, through the new middleware revoke command, §4.6) and issue a credit note. The balance never goes below zero. Refund policy: open question 5. |
| 20 | Chargeback or dispute | `DISPUTE_OPENED` marks the order `DISPUTED` and alerts. The credit middleware can't suspend a plan, and `REVOKED` is terminal, so credits stay usable while the dispute is open. If we lose, the unused credits are revoked and a credit note is issued. If we win, nothing changes. |
| 21 | Gateway outage when creating checkout | Return `503 PAYMENTS_UNAVAILABLE` and the UI offers a retry. We don't fall back to another provider automatically, because the currency and tax handling would differ. |
| 22 | The account has several apps, or the customer switches app mid-flow | The quote and order record `appId`, and credits always go to that app. The return page shows the app's name. |
| 23 | Account disabled or team member removed after paying | We still fulfil and invoice, because the money was taken, and flag the order for support. |
| 24 | Invoice PDF rendering fails | Fulfilment still grants the credits, and the invoice record exists. Because PDFs are rendered on request, a failed render only affects that one download or email, which returns an error and can be retried. Template tests render every template version against sample invoices in CI. |
| 25 | Clock and expiry times | Everything is stored in UTC. `expiresAt` = payment time + `validityDays` (India 30, Global 180). The UI shows local time. |
| 26 | USD credits rate | Fixed per price book version, not live FX. Changing it means publishing a new version. |
| 27 | Partial refund or overpayment reported by the provider | Applied exactly as the provider reports it, through credit notes. Any mismatch goes to `NEEDS_REVIEW`. |
| 28 | A listed coupon stops being eligible while the dialog is open (for example the 500th FOUNDING slot is taken) | Applying it returns `COUPON_INVALID` like any other code. The dialog re-fetches `GET /billing/coupons` and the offer disappears. |
| 29 | Customer edits the credits in the Credit Calculator | It is only a what-if. It doesn't change the selected plan, the amount or the quote. |
| 30 | Customer pays a payment link for less than the invoice total | The invoice stays `UNPAID` and the credits stay pending. We alert the admin, who refunds the difference or marks the invoice paid with a reference. Links are created as fixed-amount, with partial payments turned off where the gateway allows it. |
| 31 | Customer pays after the link expired, or pays a link the admin has just voided | The gateway normally blocks this. If a payment still arrives for a voided invoice, we don't revive the invoice. The payment attempt is flagged `NEEDS_REVIEW` and the admin refunds it or issues a new invoice. |
| 32 | The admin marks an invoice paid while a link payment is in flight | Both paths settle through the same forward-only transition, so the first one wins and the credits are granted once (`referenceId 'invoice:<id>'` is unique per app). A second real payment is flagged for refund. |
| 33 | `isPaid = true` used by mistake, or misused | It needs `SUPER_ADMIN`, a payment reference and an audit entry (`createdBy`, `payment.reference`, `note` on the invoice). The daily settlement check cannot match offline payments, so Finance reconciles them from the export. A second approver above a threshold is open question 13. |
| 34 | Amount 0 sent with `isPaid = false` | Treated as complimentary. No payment link is created. |
| 35 | Credits granted to the wrong app | Paid invoice: refund or credit note, then a new invoice for the right app. Unpaid invoice: void it and issue a new one. |
| 36 | Billing profile incomplete when the admin creates an invoice | Creation is refused (`422 BILLING_PROFILE_INCOMPLETE`) until the admin or the customer completes it, because the invoice needs legal name, address and tax IDs. |
| 37 | Customer never pays an unpaid invoice | Reminders at 3 and 7 days, then the link expires. The admin creates a new link or voids the invoice, and no credits are ever granted. |
| 38 | E-invoice registration (IRP) is down | The invoice is created and numbered, but downloads and the email wait until the IRN is issued. Retries with backoff, and an alert after 1 hour. |

## 10. Dashboard changes this implies

- **Popup data:** the popup loads `GET /billing/catalog` (the published price book) and `POST /billing/quotes` instead of reading `creditTopUpPricing.js`. The region comes from the billing profile, and the "Preview as" switch is removed. Pay calls `POST /billing/orders` and then redirects.
- **Coupon dialog:** "Apply coupon · N available" opens the dialog, which loads `GET /billing/coupons` for the list and uses `POST /billing/quotes` to apply a code. An applied coupon appears in the summary after Add-ons, with a ✕ to remove it.
- **Credit Calculator:** "Understand your credits" opens it in top-up mode, with its flows taken from the catalog's `calculatorFlowIds`. The credits field is editable as a what-if, and a "Back to Top up credits" button returns to the popup. The calculator needs no backend changes.
- **India tax line:** for India, show the GST line from the quote (open question 4).
- **New route `/credits/payment/return`:** polls the order and shows success, processing or failure, with a "Download invoice" button.
- **Credits Management › Credit Purchase History** gets an **Invoice** column, shown before Action:
  - the invoice number, a status tag (**Paid**, **Due** or **Complimentary**), and the total with how it was settled ("Paid via UPI", "Paid offline", "No payment due" or "Due 11 Nov 2026")
  - **Download**, plus **Pay now** (which opens the payment link) on unpaid invoices
  - on unpaid invoices, Action shows **Awaiting payment** instead of **Activate**, and the expiry column shows "Starts once paid". These rows come from `GET /billing/invoices?appId&status=UNPAID`, not from `GET /app/:appId/credits`, because no credit plan exists yet (§4.6). The page merges the two lists by date

  Later, a separate **Billing & Invoices** section also lists credit notes.
- **Billing details form:** shown before the first checkout if the profile is incomplete (address, GSTIN/PAN for India).
- **Customer Billing & Invoices:** unpaid super-admin invoices show as **Due** with a **Pay now** button. Pending credits show in purchase history as "Awaiting payment".
- **Super admin › Recharge Service Credits:** for ID Service, three steps (Application with Billed to, Credits and validity, Invoice with the three choices) and a summary panel, then a result card with Download and the payment link (§8.2). SSI Service uses the same step layout without the invoice step. A new **Invoices** list (not built yet) will support search, mark paid, new link, remind, void, download and export.
- **Super admin:** price book and coupon management, order search and refunds.

### 10.1 UI sign-off build: what is built and what is mocked

The dashboard UI described here is built so Business can sign it off. Pricing, invoices and billing details are mocked until the APIs exist.

| Area | Built in | Mocked until |
|---|---|---|
| Top-up popup, coupon dialog, region pricing | `src/components/credit/CreditTopUpPopup.vue`, `creditTopUpPricing.js` | `GET /billing/catalog`, `GET /billing/coupons`, `POST /billing/quotes` |
| Credit Calculator (region flows, editable what-if credits, Back button) | `src/components/credit/KycCreditCalculator.vue`, `VerificationFlowConfigurator.vue` | Nothing; the calculator is front-end only |
| Invoice PDF, rendered on the fly | `src/components/credit/invoice/invoiceDocument.js` (layout, also runs in Node), `downloadInvoice.js` (browser) | Moves to the server as-is for `GET /billing/invoices/:id/download` |
| Invoice column in Credit Purchase History | `src/views/playground/KYCDashboardCredit.vue` | `GET /billing/invoices`. Until then, each credit plan gets a sample invoice (`invoice/mockInvoices.js`, `USE_MOCK_INVOICES`) |
| Super-admin recharge with invoices | `src/views/sa/components/CreditRecharge.vue` | **Free credits** and **Already paid** still grant real credits through today's `POST /app/:appId/credits`; only the invoice is mocked. **Collect payment** is preview-only (no credits created) until `POST /admin/billing/invoices` and pending credits exist. **Billed to** is sample data until `GET /admin/billing/profiles?appId` exists. |

Our legal entity details on the invoice (name, address, GSTIN, PAN, billing email) and the SAC code are placeholders, marked `PLACEHOLDER` in `mockInvoices.js` (open question 17).

## 11. Rollout

1. **Foundation.** ~~One onboarding record per account (duplicate check, fix the guard, unique `userId` index)~~ (done 2026-10-31, with `orgId` on apps, roles and team rows), `billing` and `companyVerificationApprovedAt` on `CustomerOnboarding`, `READ_BILLING`/`WRITE_BILLING`, the price book with versioning, the quote API, and wiring the popup to quotes. Pay stays disabled.
2. **Invoices first.** The invoice model, numbering, PDFs, download, the Invoice column in Credit Purchase History, and super-admin recharge with **Free credits** and **Already paid** invoices. This replaces today's direct credit grant and works before any gateway is connected.
3. **India (Razorpay).** Orders, checkout, payment links for unpaid super-admin invoices, webhooks and reconciliation. Pilot with internal or test orgs behind a feature flag.
4. **Global (Stripe).** Second adapter, tax for Global, and the global invoice series.
5. **Coupons.** FOUNDING15 and FOUNDING8 with the coupon dialog and `GET /billing/coupons`. PARTNER, WINBACK and REFER (with the referral bonus job) follow when Business switches them on.
6. **Admin tooling and compliance.** Refunds, credit notes, settlement reports, alerts, exports, and e-invoicing if it applies. Refunds that remove credits depend on the new revoke command in `@hypersign-protocol/credit-middleware`, which should be started in phase 3.

Each phase ships behind the `billing.selfServe` flag per region.

## 12. Alternatives considered

| Option | Why not |
|---|---|
| Price on the client and send the total | It can be tampered with, rounding would drift, and there is no audit trail. |
| Use the gateway's catalog and coupons (Stripe Prices/Coupons) | It ties us to one gateway, Razorpay has nothing equivalent, and our eligibility rules (KYB, purchase count, referrals) don't fit. |
| Use gateway invoices only | We plan to use more than one gateway, and some don't offer invoicing at all. Gateway invoices would also look different per gateway, don't meet the Indian GST rules (series, place of supply), can't cover offline or complimentary grants, and would put the invoice archive in a third party. |
| Keep super-admin grants outside invoicing (today's direct `POST /app/:appId/credits`) | Credits would exist with no financial record, and offline payments and free credits couldn't be reconciled or audited. |
| Embedded card forms (Stripe Elements / Razorpay inline) | Bigger PCI scope and more UI work for v1. We can revisit this for saved cards or auto-recharge. |
| Grant credits on the success redirect | The redirect can be faked or lost. Only signed webhooks and reconciliation are trusted. |

## 13. Open questions for Business and Finance

1. **Gateways:** Razorpay for India and Stripe for Global? Which merchant accounts and entities?
2. **USD → credits rate:** please confirm it. The popup uses 90 credits per $1. With the Global discounts, $1,499 buys 134,910 credits for $674.55 before coupons, so this needs explicit sign-off.
3. **Global tax:** do we charge local tax through Stripe Tax, or treat global sales as zero-rated exports under a LUT? Which jurisdictions are we registered in?
4. **India GST display:** may the popup show GST (18%) before checkout? With Razorpay it is the only way the amounts match.
5. **Refunds:** policy (none, unused credits pro rata, or within N days)? Does a refunded order still count toward coupon limits (FOUNDING's 3 purchases, REFER's first purchase)?
6. ~~**Coupon errors:** generic or distinct messages?~~ **Decided:** always "This coupon code is not valid." (§5.1).
7. **KYB:** must KYB be approved before buying, or only for FOUNDING coupons?
8. **Activation:** should purchased credits become active immediately (proposed), or be queued like admin grants?
9. **Coupon stacking:** do coupons apply after the plan discount (proposed and built), or on the full price? Is there a cap, such as a maximum discount amount?
10. **Credit validity wording:** India says 1 month and Global 6 months, with no carry-forward. The original wireframe said "Credits never expire". Please confirm the add-on validity is final.
11. **Unpaid super-admin invoices:** issue a tax invoice with its number straight away (proposed), or a proforma invoice and the tax invoice only once paid? Prepaid credits may count as an advance under GST, which can require a receipt voucher at payment. Finance to confirm which document we issue.
12. **Tax on super-admin invoices for Global customers:** charge local tax using Stripe Tax's calculation API, or zero-rate as an export under a LUT?
13. **Controls on `isPaid = true` and complimentary invoices:** every super admin can create invoices in v1. Is the audit trail on the invoice enough, or do we need a separate billing-admin role, or a second approver above an amount? What amount?
14. **E-invoicing:** is our turnover above the e-invoicing threshold, so that Indian B2B invoices need an IRN and QR code?
15. **Complimentary invoices:** is a ₹0 tax invoice the right document for free credits, or should Finance treat them differently, for example as promotional with no tax invoice?
16. **SSI Service recharges:** should they be invoiced too? The proposal keeps them as today's direct recharge, with no invoice, and only ID Service credits go through invoicing.
17. **Our details on the invoice:** the legal entity name, registered address, GSTIN, PAN, billing email and SAC code (likely 998314). The sign-off build uses placeholders.
18. **Onboarding starter credits:** onboarding grants ID Service credits directly (`source: CUSTOMER_ONBOARDING`). Should they also get a ₹0 complimentary invoice, or stay outside invoicing like SSI recharges? The proposal keeps them outside, so decision 9 covers only the recharge page and purchases.
19. **Invoice email:** the mail queue has no attachments today. Should we add PDF attachments to the mail worker (proposed, because Finance teams expect the attachment), or email a signed download link?
20. **KYB "approved" for coupons:** `KybVerificationEnum` has both `Approved` and `Completed` ("finished, passed or failed"). Proposed: only `Approved` counts.

## 14. Backend review notes (2026-10-28)

This review checked the draft against the code in this service and in `@hypersign-protocol/credit-middleware` 5.0.3. Its corrections are already applied above, mainly in §4.0 and §4.6. This section lists what was changed and why, and the recommendations still open.

### 14.1 Corrections applied

| # | Draft said | Code reality | Change |
|---|---|---|---|
| 1 | `Organisation` / `orgId` | No such collection. The tenant is the owner's `userId`, and `CustomerOnboarding` holds the company | `orgId = CustomerOnboarding._id` on all billing collections, so billing survives an ownership transfer. The actor goes in `createdBy` |
| 2 | `CreditPackage` with new `source`, `orderId`, `invoiceId` | `CreditPlan` already has `source` (incl. `PAYMENT`, `MANUAL_RECHARGE`), `validityDays`, `creditedBy`, and a unique `(serviceId, referenceId)` index | Reuse `source` and `referenceId`. Add only `invoiceId` and `revokedCredits`. No backfill |
| 3 | `PENDING_PAYMENT` credit plans | `activateCredit` (open to customers) doesn't check status, and `processCriticalBalance` automatically activates `Inactive` plans | No plan exists until an invoice is paid |
| 4 | Refunds and disputes revoke or suspend credits | The middleware has no revoke or suspend command. `REVOKED` is reserved and terminal | Revoke is a new middleware command (phase 6 dependency). Disputes don't suspend |
| 5 | `CatalogVersion` | `catalogVersion` already means the API price catalog in `creditLedger` | Renamed to `PriceBook` |
| 6 | Plans, discount rules and add-ons in three collections | Small, read together, published atomically | Embedded in `PriceBook` |
| 7 | `kybStatus` and `kybApprovedAt` copied into a separate billing profile | Status lives on `CustomerOnboarding`, and there's no approval date | Read the status from onboarding. Add `companyVerificationApprovedAt` there |
| 8 | Structured address and tax IDs "from onboarding" | Onboarding only has a free-text `billingAddress`. Structured data is in the ID Service company record | Prefill from the KYB company record, reusing the `KybCompanyAddressDto` shape and the `TaxIdTypes` regexes |
| 9 | FOUNDING "first 500" with `redemptionCount < 500` | That counts uses, not accounts (3 uses each) | `CouponAccount` + `accountCount` |
| 10 | `BILLING_READ` / `BILLING_WRITE` / `BILLING_ADMIN` | Access types are `VERB_NOUN` per service, and super admin is a role | `READ_BILLING` / `WRITE_BILLING` on `CAVACH_API`. Super-admin routes use `SuperAdminMiddleware` |
| 11 | `idempotencyKey` globally unique | Two accounts could send the same key | Unique per `(orgId, idempotencyKey)` |
| 12 | `creditsPerMajorUnit` float | Contradicts decision 2 | Integer |
| 13 | Endpoints on "the entity API" | Credits live in this service under `/api/v1` | Paths and middleware stated in §5 |
| 14 | Raw body "just works" for webhooks | `main.ts` applies its own global `json()` parser, which drops the raw bytes | `json({ verify })` keeps `rawBody` (or Nest's `rawBody: true` without the extra parser) |
| 15 | A separate `BillingProfile` collection | `CustomerOnboarding` already is the organisation record and holds the company and billing inputs | Billing profile is `CustomerOnboarding.billing`. One onboarding record per account is enforced with a unique index |

### 14.2 Recommendations still to decide

1. **Make the super-admin invoice an `Order` too (recommended).** Today `PaymentAttempt`, `NormalizedEvent` and webhook routing all carry "either `orderId` or `invoiceId`". If every sale were an `Order` (`source: SELF_SERVE | ADMIN`) and every invoice pointed to one, then:
   - payments, payment links, refunds and reconciliation would have a single parent;
   - `PaymentLink` would become one more checkout kind on the order;
   - the fulfilment code path would be the same for both flows.

   The cost is a second, shorter state machine for admin orders. This is internal and doesn't change any agreed UI.
2. **Fix `activateCredit` regardless of billing.** It doesn't check the plan's status, or that the app belongs to the caller. A status guard (`Inactive`, no `expiresAt`) and an ownership check should ship with phase 2, before purchased plans exist.
3. **Keep `GET /api/v1/app/:appId/credits` free of billing data.** It is excluded from JWT auth. Purchase history should get invoice details only from the authenticated `/billing/invoices` route.
4. **Our legal entity details belong in config, not a collection.** The invoice `supplier` block is copied from `BILLING_SUPPLIER_*` environment settings at issue time, so it is a snapshot anyway. Add them to `validateEnv`.
5. **Monitoring.** Alert on: `PAID` invoices without `creditPlanId` after 10 minutes; orders in `PENDING_PAYMENT` for more than 1 hour; `WebhookEvent`s that are `FAILED`; and any `NEEDS_REVIEW`.

## Appendix A: ER diagram in DBML

This is the same model as the Mermaid diagram in §4, for [dbdiagram.io](https://dbdiagram.io): open a new diagram and paste the block below. The collections are MongoDB, so the types are indicative. Embedded arrays (price book plans, invoice lines) are shown as `array`. Table groups match the areas of this ADR: existing records, pricing, coupons and referrals, checkout, and invoicing.

```dbml
// Credit top-up and invoicing: paste into https://dbdiagram.io
// Same model as the Mermaid diagram in §4. Collections are MongoDB; types are indicative.

Table users [note: 'Existing. Owners are linked to their organisation through customeronboardings.userId'] {
  userId string [pk]
  email string [unique]
  role string [note: 'ADMIN or SUPER_ADMIN']
}

Table customeronboardings [note: 'Existing: the organisation record; _id is the orgId. Adds billing (the billing profile) and companyVerificationApprovedAt'] {
  _id string [pk]
  userId string [unique, ref: - users.userId, note: 'owner; unique index; changed by ownership transfer']
  companyName string [unique]
  country string
  companyId string [note: 'ID Service company record (structured address, tax ID)']
  companyVerificationStatus string [note: 'Submitted, Approved, Rejected, Completed']
  companyVerificationApprovedAt date [note: 'NEW']
  billingAddress string [note: 'existing free text, onboarding input only']
  billing object [note: 'NEW: legalName, email, address, gstStateCode, taxIds, region, currency, providerCustomers, lockedAt']
}

Table apps [note: 'Existing'] {
  appId string [pk]
  userId string [ref: > users.userId]
  orgId string [ref: > customeronboardings._id, note: 'required; the owner\'s organisation']
  services array [note: 'services[0].id = CAVACH_API or SSI_API']
}

Table creditplans [note: 'Existing CreditPlan, plus invoiceId and revokedCredits'] {
  _id string [pk]
  serviceId string [ref: > apps.appId]
  referenceId string [note: "'invoice:<invoiceId>' for invoiced grants"]
  apiCredit object [note: 'total, used']
  validityDays int
  expiresAt date
  status string [note: 'Active or Inactive']
  source string [note: 'PAYMENT, MANUAL_RECHARGE, CUSTOMER_ONBOARDING, MIGRATION, ADJUSTMENT, REFERRAL_BONUS, PROMO']
  creditedBy string
  invoiceId string [ref: - invoices._id, note: 'NEW']
  revokedCredits int [note: 'NEW']

  indexes {
    (serviceId, referenceId) [unique]
    invoiceId
  }
}

Table priceBooks {
  _id string [pk]
  region string
  currency string
  version int
  status string [note: 'DRAFT, PUBLISHED, RETIRED']
  creditsPerMajorUnit int [note: 'INR 1, USD 90 (to confirm)']
  custom object [note: 'enabled, minMinor, maxMinor']
  calculatorFlowIds array
  plans array [note: 'embedded: code, priceMinor, displayOrder, active']
  discountRules array [note: 'embedded: id, type, planCode, minMinor, maxMinor, percentBps, priority']
  addOns array [note: 'embedded: code, title, priceMinor, included, config']
  publishedAt date
  publishedBy string

  indexes {
    (region, version) [unique]
  }
}

Table coupons {
  _id string [pk]
  code string [unique]
  region string
  percentBps int
  maxDiscountMinor int
  listed bool
  title string
  description string
  campaign string
  eligibility object
  limits object [note: 'maxAccounts, maxRedemptions, maxRedemptionsPerAccount, startsAt, expiresAt']
  accountCount int
  redemptionCount int
  status string
}

Table couponAccounts {
  _id string [pk]
  couponId string [ref: > coupons._id]
  orgId string [ref: > customeronboardings._id]
  redemptions int

  indexes {
    (couponId, orgId) [unique]
  }
}

Table couponRedemptions {
  _id string [pk]
  couponId string [ref: > coupons._id]
  orgId string [ref: > customeronboardings._id]
  orderId string [unique, ref: - orders._id]
  status string [note: 'RESERVED, REDEEMED, RELEASED']
  discountMinor int
  reservedUntil date
}

Table referrals {
  _id string [pk]
  referrerOrgId string [ref: > customeronboardings._id]
  refereeOrgId string [unique, ref: > customeronboardings._id]
  couponCode string
  status string
  qualifyingOrderId string [ref: > orders._id]
  bonusCredits int
}

Table quotes {
  _id string [pk]
  orgId string [ref: > customeronboardings._id]
  appId string [ref: > apps.appId]
  priceBookId string [ref: > priceBooks._id]
  priceBookVersion int
  selection object [note: 'planCode | customAmountMinor, couponCode']
  lines object
  credits int
  validityDays int
  expiresAt date [note: 'TTL index, 15 minutes']
}

Table orders {
  _id string [pk]
  orderNumber string [unique]
  orgId string [ref: > customeronboardings._id]
  appId string [ref: > apps.appId]
  quoteId string [ref: - quotes._id]
  createdBy string
  quoteSnapshot object
  amountDueMinor int
  taxMinor int
  amountPaidMinor int
  status string
  provider string
  providerRefs object
  checkoutUrl string
  expiresAt date
  idempotencyKey string
  invoiceId string [ref: - invoices._id]

  indexes {
    (orgId, idempotencyKey) [unique]
    (orgId, createdAt)
    (status, updatedAt)
  }
}

Table paymentAttempts {
  _id string [pk]
  orderId string [ref: > orders._id, note: 'self-serve']
  invoiceId string [ref: > invoices._id, note: 'admin payment link']
  provider string
  providerPaymentId string
  status string
  amountMinor int
  currency string
  method string

  indexes {
    (provider, providerPaymentId) [unique]
  }
}

Table webhookEvents {
  _id string [pk]
  provider string
  eventId string
  paymentAttemptId string [ref: > paymentAttempts._id]
  type string
  status string
  attempts int
  receivedAt date
  processedAt date
  payload object [note: 'removed after 90 days']

  indexes {
    (provider, eventId) [unique]
  }
}

Table paymentLinks {
  _id string [pk]
  invoiceId string [ref: > invoices._id]
  provider string
  providerLinkId string
  url string
  amountMinor int
  status string
  expiresAt date
  remindersSent int

  indexes {
    (provider, providerLinkId) [unique]
  }
}

Table invoices {
  _id string [pk]
  invoiceNumber string [unique]
  series string [note: 'IN or GL']
  financialYear string
  source string [note: 'SELF_SERVE or ADMIN']
  orderId string [unique, ref: - orders._id, note: 'sparse']
  orgId string [ref: > customeronboardings._id]
  appId string [ref: > apps.appId]
  createdBy string
  idempotencyKey string
  status string [note: 'UNPAID, PAID, VOID']
  settlement string [note: 'GATEWAY, OFFLINE, COMPLIMENTARY']
  issuedAt date
  dueAt date
  currency string
  supplier object [note: 'snapshot']
  customer object [note: 'snapshot']
  placeOfSupply string
  lines array
  addOnLines array
  tax array
  totals object
  fx object
  payment object
  activePaymentLinkId string [ref: - paymentLinks._id]
  credits int
  validityDays int
  creditPlanId string [ref: - creditplans._id]
  eInvoice object
  templateVersion string
  firstRenderSha256 string

  indexes {
    (orgId, issuedAt)
    (appId, issuedAt)
    (status, dueAt)
  }
}

Table creditNotes {
  _id string [pk]
  creditNoteNumber string [unique]
  invoiceId string [ref: > invoices._id]
  reason string
  amountMinor int
  taxMinor int
  creditsRevoked int
  refundId string
  templateVersion string
}

Table billingCounters [note: 'Gap-free invoice, credit note and order numbers'] {
  _id string [pk, note: 'e.g. INV/IN/2026-27']
  seq int
}

TableGroup existing {
  users
  customeronboardings
  apps
  creditplans
}

TableGroup pricing {
  priceBooks
}

TableGroup coupons_and_referrals {
  coupons
  couponAccounts
  couponRedemptions
  referrals
}

TableGroup checkout {
  quotes
  orders
  paymentAttempts
  webhookEvents
  paymentLinks
}

TableGroup invoicing {
  invoices
  creditNotes
  billingCounters
}
```
