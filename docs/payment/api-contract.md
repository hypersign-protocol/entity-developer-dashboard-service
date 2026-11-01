# Billing API contract (for dashboard integration)

The request and response formats for the billing APIs in `entity-developer-dashboard-service`. The dashboard can be built and mocked against this document while the backend is implemented. The design behind it is in [credits-top-up-payment.md](credits-top-up-payment.md) (the ADR, "§" below), and the delivery order is in [epics.md](epics.md).

| Part | Status | Build the UI now? |
|---|---|---|
| [Stage 1: invoicing](#stage-1-invoicing) | **Agreed** | Yes |
| [Stage 2: payments](#stage-2-payments-provisional) | **Provisional**, the payment gateway isn't chosen yet | Only behind the `features.pay` flag, and expect changes |

Any change to an agreed endpoint is recorded in the [changelog](#changelog) at the end.

---

## 1. Conventions

### 1.1 Base URL and authentication

- **Base URL:** the dashboard service's existing URL. Every path below starts with `/api/v1`.
- **Authentication:** the same as every other dashboard call. The session is in the `accessToken` cookie, so send requests with credentials (`withCredentials: true` in axios, `credentials: 'include'` in fetch). Don't send an `Authorization` header.
- **Team members:** they call the same endpoints. The server maps them to the account owner's organisation.
- **Permissions:**
  - customer reads need `READ_BILLING`;
  - customer writes need `WRITE_BILLING`;
  - `/admin/...` endpoints need a super-admin session.

  The account owner has both billing permissions automatically.

### 1.2 Headers

| Header | When | Value |
|---|---|---|
| `Content-Type` | Requests with a body | `application/json` |
| `Idempotency-Key` | `POST /admin/billing/invoices`, `POST /billing/orders` | A new UUID v4 for each user action. Reuse the **same** key when retrying the same action after a network error or a double click. |

### 1.3 Money, percentages, dates and ids

- **Money is always an integer in minor units** (paise or cents), in a field ending in `Minor`. The `currency` field sits next to it.
  - Display rule: divide by 100 and format with `Intl.NumberFormat`: `en-IN` for `INR`, `en-US` for `USD`, always 2 decimals. For example, `172431` with `INR` is `₹1,724.31`.
- **Percentages are integer basis points**, in fields ending in `Bps`. For example, `4650` is 46.5%. Display rule: `bps / 100` followed by `%`.
- **Never calculate an amount in the UI.** Show what the server returns. Even custom-amount totals come from a quote (§3.3).
- **Dates** are ISO 8601 strings in UTC, like `"2026-10-31T10:15:00.000Z"`. Show them in the user's local time.
- **Ids** are strings.

### 1.4 Enums

| Name | Values |
|---|---|
| `Region` | `IN`, `GLOBAL` |
| `Currency` | `INR` (with `IN`), `USD` (with `GLOBAL`) |
| `InvoiceStatus` | `UNPAID`, `PAID`, `VOID` |
| `InvoiceSettlement` | `COMPLIMENTARY`, `OFFLINE`, `GATEWAY` (only on `PAID` invoices) |
| `InvoiceSource` | `SELF_SERVE`, `ADMIN` |
| `OfflinePaymentMethod` | `BANK_TRANSFER`, `UPI`, `CHEQUE`, `CARD_OUTSIDE_DASHBOARD`, `OTHER_SYSTEM` |
| `TaxLineType` | `CGST`, `SGST`, `IGST`, `GST` (Indian state not known yet), `ZERO_RATED_EXPORT`, `VAT`, `SALES_TAX` |
| `TaxMode` | `INCLUDED_IN_QUOTE` (India: the quote contains the final GST), `NONE` (Global: no tax is charged), `CALCULATED_AT_CHECKOUT` (reserved: not returned today) |

### 1.5 Errors

Errors use the service's existing format, `statusCode`, `message` (always an array) and `error`, plus two fields added for billing: a machine-readable `code` and an optional `details`. Other endpoints in this service return only `statusCode`, `message` and `error`, so a shared error handler must not assume `code` is present.

```json
{
  "statusCode": 422,
  "error": "Unprocessable Entity",
  "code": "COUPON_INVALID",
  "message": ["This coupon code is not valid."],
  "details": {}
}
```

- **Branch on `code`,** never on `message`.
- **`message[0]`** is safe to show to the user unless an endpoint says otherwise.
- **`details`** is optional. Its shape depends on the `code`, and each case is described below.

Codes shared by all endpoints:

| HTTP | `code` | Meaning | UI behaviour |
|---|---|---|---|
| 400 | `VALIDATION_FAILED` | The request body or query is invalid. `details.fields` holds an object of field name → message | Show the messages next to the fields |
| 401 | (no code, existing behaviour) | Not logged in, or the session expired | The existing logout flow |
| 403 | (no code, existing behaviour) | Missing `READ_BILLING` / `WRITE_BILLING`, or not a super admin | Hide or disable the feature |
| 404 | `APP_NOT_FOUND` | The app doesn't exist or isn't in the caller's organisation | — |
| 422 | `APP_NOT_BILLABLE` | The app isn't an ID Service (`CAVACH_API`) app | — |
| 429 | (no code, existing behaviour) | Too many requests | "Please try again in a moment" |
| 503 | `BILLING_DISABLED` | Billing is switched off for this region | Hide top-up and billing features |

### 1.6 Paginated lists

List endpoints take `page` (default 1) and `limit` (default 10, at most 100). They return:

```json
{ "data": [], "page": 1, "limit": 10, "total": 0 }
```

---

## Stage 1: invoicing

### 2. Billing profile

The company details printed on invoices. They are stored on the organisation's onboarding record and prefilled from onboarding and KYB (§4.1).

#### `BillingProfile` object

```json
{
  "orgId": "69832fafec5bf58b25caff2b",
  "legalName": "Acme Technologies Private Limited",
  "email": "billing@acme.example",
  "address": {
    "street": "12 MG Road",
    "city": "Bengaluru",
    "province": "Karnataka",
    "postalCode": "560001",
    "country": "IN"
  },
  "gstStateCode": "29",
  "taxIds": [{ "type": "GSTIN", "number": "29ABCDE1234F1Z5" }],
  "region": "IN",
  "currency": "INR",
  "source": "SAVED",
  "complete": true,
  "missingFields": [],
  "locked": false,
  "lockedAt": null
}
```

| Field | Notes |
|---|---|
| `address.country` | ISO 3166-1 alpha-2 code |
| `gstStateCode` | India only, 2 digits. The server works it out from a GSTIN. Without a GSTIN, the UI sends it from a state dropdown |
| `taxIds[].type` | `GSTIN`, `PAN`, `VAT`, … (the existing `TaxIdTypes`). The server validates the number against the type |
| `region`, `currency` | Read-only. Only a super admin can change them |
| `source` | `PREFILLED`: never saved, so the values are suggestions; show the form for confirmation. `SAVED`: the customer has confirmed them |
| `complete` | `true` only when nothing is missing **and** the customer has saved the profile (`source: "SAVED"`). `false` means invoices can't be issued yet. `missingFields` lists the missing fields, using the same paths as above, for example `"address.postalCode"` or `"gstStateCode"`; it can be empty while `source` is still `PREFILLED`, in which case the form only needs confirming |
| `locked` | `true` after the first paid invoice. The region and tax IDs can't be edited any more; show them read-only, with "Contact support to change" |

#### `GET /api/v1/customer-onboarding/billing`

Returns the caller's organisation's profile, prefilled if it was never saved. Needs `READ_BILLING`.

- **200:** `BillingProfile`
- **404 `ONBOARDING_NOT_FOUND`:** the account hasn't onboarded. Send the user to onboarding.

#### `PUT /api/v1/customer-onboarding/billing`

Saves the profile. Needs `WRITE_BILLING`.

```json
{
  "legalName": "Acme Technologies Private Limited",
  "email": "billing@acme.example",
  "address": { "street": "12 MG Road", "city": "Bengaluru", "province": "Karnataka", "postalCode": "560001", "country": "IN" },
  "gstStateCode": "29",
  "taxIds": [{ "type": "GSTIN", "number": "29ABCDE1234F1Z5" }]
}
```

- **200:** the saved `BillingProfile`, with `source: "SAVED"`.
- **400 `VALIDATION_FAILED`:** for example, an invalid GSTIN appears as `details.fields["taxIds[0].number"]`.
- **409 `BILLING_PROFILE_LOCKED`:** the request changed the tax IDs of a locked profile.

---

### 3. Top-up popup

#### 3.1 `GET /api/v1/billing/catalog`

The published prices for the caller's region. Replaces `creditTopUpPricing.js`. Needs `READ_BILLING`.

**200:**

```json
{
  "priceBookId": "6723a1f0c1d2e3f4a5b6c7d8",
  "version": 1,
  "region": "IN",
  "currency": "INR",
  "creditsPerMajorUnit": 1,
  "validityDays": 30,
  "taxMode": "INCLUDED_IN_QUOTE",
  "features": { "coupons": true, "pay": false },
  "plans": [
    { "code": "IN_999",  "priceMinor": 99900,  "discountBps": 1000, "discountMinor": 9990,   "totalBeforeTaxMinor": 89910,  "credits": 999,  "displayOrder": 1 },
    { "code": "IN_2499", "priceMinor": 249900, "discountBps": 2500, "discountMinor": 62475,  "totalBeforeTaxMinor": 187425, "credits": 2499, "displayOrder": 2 },
    { "code": "IN_4999", "priceMinor": 499900, "discountBps": 2800, "discountMinor": 139972, "totalBeforeTaxMinor": 359928, "credits": 4999, "displayOrder": 3 },
    { "code": "IN_9999", "priceMinor": 999900, "discountBps": 3500, "discountMinor": 349965, "totalBeforeTaxMinor": 649935, "credits": 9999, "displayOrder": 4 }
  ],
  "custom": {
    "enabled": true,
    "minMinor": 99900,
    "maxMinor": 999900,
    "discountRanges": [
      { "minMinor": 99900,  "maxMinor": 249899, "discountBps": 1000 },
      { "minMinor": 249900, "maxMinor": 499899, "discountBps": 2500 },
      { "minMinor": 499900, "maxMinor": 999899, "discountBps": 2800 },
      { "minMinor": 999900, "maxMinor": 999900, "discountBps": 3500 }
    ]
  },
  "addOns": [
    { "code": "VALIDITY", "title": "Credit validity", "shortTitle": "1 month validity", "description": "Credits are valid for 1 month from activation. Unused credits don't carry forward.", "icon": "mdi-calendar-clock", "priceMinor": 0, "included": true },
    { "code": "HUMAN_SUPPORT_24X7", "title": "24×7 human support", "shortTitle": "24×7 support", "description": "…", "icon": "mdi-headset", "priceMinor": 0, "included": true },
    { "code": "EMAIL_SUPPORT", "title": "Email support", "shortTitle": "Email support", "description": "…", "icon": "mdi-email-outline", "priceMinor": 0, "included": true }
  ],
  "calculatorFlowIds": ["india"]
}
```

| Field | Notes |
|---|---|
| `plans` | Sort by `displayOrder`. The discount and total are already worked out, so show them as they are. The total excludes tax |
| `custom.discountRanges` | Only for showing a "25% off" hint while the user types a custom amount. Amounts still come from a quote |
| `custom` amounts | Must be whole major units (a multiple of 100 minor units) between `minMinor` and `maxMinor` |
| `taxMode` | `INCLUDED_IN_QUOTE`: show the GST line(s) from the quote. `NONE`: show no tax line and no "+ tax"; the total is final. `CALCULATED_AT_CHECKOUT` isn't returned today; if it ever is, show "Tax is calculated on the secure payment page" |
| `features.pay` | `false` during stage 1. Show the Pay button disabled, for example with a "Coming soon" tooltip |
| `features.coupons` | `false` hides "Apply coupon" |
| `addOns` | `priceMinor: 0` displays as "Free". `included: true` means there is no checkbox |
| `calculatorFlowIds` | Pass these to the Credit Calculator in place of the "Preview as" switch |

**A Global account gets the same shape:** `region: "GLOBAL"`, `currency: "USD"`, `creditsPerMajorUnit: 90`, `validityDays: 180`, `taxMode: "NONE"` and `calculatorFlowIds: ["global", "business"]`. The plans are:

| `code` | `priceMinor` | `discountBps` | `discountMinor` | `totalBeforeTaxMinor` | `credits` |
|---|---|---|---|---|---|
| `GL_99` | 9900 | 0 | 0 | 9900 | 8910 |
| `GL_199` | 19900 | 4000 | 7960 | 11940 | 17910 |
| `GL_299` | 29900 | 4650 | 13904 | 15996 | 26910 |
| `GL_499` | 49900 | 5200 | 25948 | 23952 | 44910 |
| `GL_1499` | 149900 | 5500 | 82445 | 67455 | 134910 |

#### 3.2 `GET /api/v1/billing/coupons?appId=…&planCode=…` or `…&customAmountMinor=…`

The listed coupons the account can use right now. Feeds the **Apply a coupon** dialog. Needs `READ_BILLING`. `planCode` and `customAmountMinor` are optional; without them, `previewDiscountMinor` is `null`.

**200:**

```json
{
  "coupons": [
    {
      "code": "FOUNDING8",
      "title": "Founding customer offer",
      "description": "8% off your first 3 top-ups within 6 months of KYB approval.",
      "percentBps": 800,
      "maxDiscountMinor": null,
      "previewDiscountMinor": 14994,
      "usesLeft": 3,
      "expiresAt": "2027-04-12T00:00:00.000Z"
    }
  ]
}
```

- **An empty list** means no offers. Show the code input only.
- **`previewDiscountMinor`** feeds the "Saves ₹149.94 on this top-up" line.
- **Picking a coupon from the list** or typing a code doesn't apply it. Applying means requesting a new quote with `couponCode` (§3.3).

#### 3.3 `POST /api/v1/billing/quotes`

Prices the current selection. Request a new quote every time the plan, the custom amount or the coupon changes. Debounce custom-amount typing by about 400 ms. Needs `READ_BILLING`. Rate-limited.

**Request:** exactly one of `planCode` and `customAmountMinor`.

```json
{ "appId": "98f0815cf8c2096a2b54ea1746f5b9538a72", "planCode": "IN_2499", "couponCode": "FOUNDING8" }
```

```json
{ "appId": "98f0815cf8c2096a2b54ea1746f5b9538a72", "customAmountMinor": 320000 }
```

**200, India:**

```json
{
  "quoteId": "6723b0a1c1d2e3f4a5b6c7e9",
  "appId": "98f0815cf8c2096a2b54ea1746f5b9538a72",
  "region": "IN",
  "currency": "INR",
  "priceBookVersion": 1,
  "selection": { "planCode": "IN_2499", "customAmountMinor": null, "couponCode": "FOUNDING8" },
  "subtotalMinor": 249900,
  "planDiscount": { "percentBps": 2500, "amountMinor": 62475 },
  "coupon": { "code": "FOUNDING8", "percentBps": 800, "amountMinor": 14994 },
  "addOns": [
    { "code": "VALIDITY", "title": "Credit validity", "priceMinor": 0 },
    { "code": "HUMAN_SUPPORT_24X7", "title": "24×7 human support", "priceMinor": 0 },
    { "code": "EMAIL_SUPPORT", "title": "Email support", "priceMinor": 0 }
  ],
  "totalBeforeTaxMinor": 172431,
  "tax": {
    "mode": "INCLUDED_IN_QUOTE",
    "amountMinor": 31038,
    "lines": [{ "type": "IGST", "rateBps": 1800, "amountMinor": 31038 }]
  },
  "totalMinor": 203469,
  "credits": 2499,
  "validityDays": 30,
  "billingProfileComplete": true,
  "expiresAt": "2026-10-31T10:15:00.000Z"
}
```

**200, Global,** with `planCode: "GL_299"` and `couponCode: "FOUNDING15"`. These fields differ from the India example:

```json
{
  "region": "GLOBAL",
  "currency": "USD",
  "subtotalMinor": 29900,
  "planDiscount": { "percentBps": 4650, "amountMinor": 13904 },
  "coupon": { "code": "FOUNDING15", "percentBps": 1500, "amountMinor": 2399 },
  "totalBeforeTaxMinor": 13597,
  "tax": { "mode": "NONE", "amountMinor": 0, "lines": [] },
  "totalMinor": 13597,
  "credits": 26910,
  "validityDays": 180
}
```

| Field | Notes |
|---|---|
| `coupon` | `null` when there's no coupon |
| `tax.lines` | Show one row per line: "IGST (18%)", or "CGST (9%)" and "SGST (9%)". Type `GST` means the customer's state isn't known yet, which is also signalled by `billingProfileComplete: false` |
| `totalMinor` | `totalBeforeTaxMinor` plus `tax.amountMinor`: the final amount in both regions. Global charges no tax, so it equals `totalBeforeTaxMinor` |
| `billingProfileComplete` | `false`: show the billing details form before Pay (stage 2) |
| `expiresAt` | 15 minutes. Request a new quote when the popup is reopened, or before Pay if it has expired |
| `quoteId` | Kept for Pay in stage 2 (§6.1) |

**Errors:**

| HTTP | `code` | UI behaviour |
|---|---|---|
| 422 | `COUPON_INVALID` | Show "This coupon code is not valid." under the coupon field, remove the coupon, and request the quote again without it. Every rejected code gets this same response, whatever the reason |
| 429 | `RATE_LIMITED` | After 10 rejected coupon codes in 10 minutes, the account can't try more codes for a while. Show "Too many coupon attempts. Please try again later." and quote without the coupon. Quotes without a coupon still work. This 429 **does** carry a `code`, unlike the shared rate limiter's |
| 422 | `AMOUNT_OUT_OF_RANGE` | Under the custom amount, show the allowed range from `custom.minMinor` and `custom.maxMinor` and "For larger amounts, talk to sales". `details`: `{ "minMinor": 99900, "maxMinor": 999900 }` |
| 422 | `PLAN_NOT_FOUND` | The plan isn't in the published price book any more. Reload the catalog |

---

### 4. Invoices: customer

#### `InvoiceSummary` object

```json
{
  "invoiceId": "6723c4d2c1d2e3f4a5b6c7f0",
  "invoiceNumber": "HS/IN/2026-27/000123",
  "source": "ADMIN",
  "status": "PAID",
  "settlement": "OFFLINE",
  "appId": "98f0815cf8c2096a2b54ea1746f5b9538a72",
  "appName": "Acme KYC",
  "issuedAt": "2026-10-31T09:00:00.000Z",
  "paidAt": "2026-10-30T00:00:00.000Z",
  "dueAt": null,
  "currency": "INR",
  "totalMinor": 4720000,
  "amountPaidMinor": 4720000,
  "balanceDueMinor": 0,
  "credits": 40000,
  "validityDays": 30,
  "creditPlanId": "6723c4d9c1d2e3f4a5b6c7f1",
  "payment": { "method": "BANK_TRANSFER", "reference": "UTR0012345678", "provider": null },
  "payNowUrl": null
}
```

| Field | Notes |
|---|---|
| `status` / `settlement` | Tag and settlement text in Credit Purchase History: `PAID` + `GATEWAY` is "Paid · Paid via {payment.method}"; `PAID` + `OFFLINE` is "Paid · Paid offline"; `PAID` + `COMPLIMENTARY` is "Complimentary · No payment due"; `UNPAID` is "Due · Due {dueAt}" (stage 2); `VOID` is "Void" |
| `creditPlanId` | Joins the invoice to a credit plan from the existing `GET /api/v1/app/:appId/credits` (the plan's `_id`). `null` for unpaid or void invoices, which have no plan yet |
| `payNowUrl` | Only on unpaid invoices (stage 2). Show **Pay now** when it isn't `null` |

#### `GET /api/v1/billing/invoices?appId=…&status=…&page=…&limit=…`

The organisation's invoices, newest first. Needs `READ_BILLING`. `appId` and `status` are optional filters.

- **200:** a paginated list of `InvoiceSummary`.

**How Credit Purchase History uses it:** load the app's credit plans as today, plus `GET /billing/invoices?appId=…`. Then:
- put each invoice in the **Invoice** column of the plan whose `_id` equals its `creditPlanId`;
- add the `UNPAID` invoices, which have no plan, as "Awaiting payment" rows (stage 2);
- sort all rows by date.

#### `InvoiceDocument` object

Everything printed on the invoice, copied in when it was issued and never changed afterwards. The dashboard renders the PDF from it (ADR §8.3); nothing is stored as a file.

India, **Already paid**, customer in Maharashtra:

```json
{
  "invoiceId": "6723c4d2c1d2e3f4a5b6c7f0",
  "invoiceNumber": "HS/IN/2026-27/000123",
  "templateVersion": "invoice-v1",
  "series": "IN",
  "financialYear": "2026-27",
  "source": "ADMIN",
  "status": "PAID",
  "settlement": "OFFLINE",
  "issuedAt": "2026-11-01T09:00:00.000Z",
  "paidAt": "2026-10-30T00:00:00.000Z",
  "dueAt": null,
  "currency": "INR",
  "supplier": {
    "legalName": "Hypermine Technologies Private Limited",
    "email": "billing@hypersign.id",
    "address": { "street": "1st Floor, 12 MG Road", "city": "Bengaluru", "province": "Karnataka", "postalCode": "560001", "country": "IN" },
    "gstin": "29AAAAA0000A1Z5",
    "pan": "AAAAA0000A",
    "cin": null,
    "lutArn": null
  },
  "customer": {
    "legalName": "Acme Technologies Private Limited",
    "email": "billing@acme.example",
    "address": { "street": "4 Linking Road", "city": "Mumbai", "province": "Maharashtra", "postalCode": "400050", "country": "IN" },
    "taxIds": [{ "type": "GSTIN", "number": "27ABCDE1234F1Z5" }],
    "gstStateCode": "27"
  },
  "placeOfSupply": { "code": "27", "name": "Maharashtra" },
  "app": { "appId": "98f0815cf8c2096a2b54ea1746f5b9538a72", "appName": "Acme KYC" },
  "orderNumber": null,
  "lines": [
    { "description": "Prepaid verification credits", "sac": "998314", "quantity": 1, "unitPriceMinor": 4000000, "discountMinor": 0, "taxableMinor": 4000000 }
  ],
  "addOnLines": [
    { "code": "VALIDITY", "title": "Credit validity" },
    { "code": "HUMAN_SUPPORT_24X7", "title": "24×7 human support" },
    { "code": "EMAIL_SUPPORT", "title": "Email support" }
  ],
  "discounts": { "plan": null, "coupon": null },
  "tax": [{ "type": "IGST", "rateBps": 1800, "amountMinor": 720000 }],
  "taxNote": "Tax is payable on reverse charge: No.",
  "totals": {
    "subtotalMinor": 4000000,
    "discountMinor": 0,
    "taxableMinor": 4000000,
    "taxMinor": 720000,
    "totalMinor": 4720000,
    "amountPaidMinor": 4720000,
    "balanceDueMinor": 0
  },
  "credits": 40000,
  "validityDays": 30,
  "payment": { "method": "BANK_TRANSFER", "reference": "UTR0012345678", "provider": null, "paymentId": null, "paidAt": "2026-10-30T00:00:00.000Z" },
  "payNowUrl": null,
  "voidedAt": null,
  "voidReason": null
}
```

How other invoices differ:

| Invoice | Differences |
|---|---|
| **Complimentary** (Free credits) | `settlement: "COMPLIMENTARY"`, `lines[0].unitPriceMinor: 0`, `tax: []`, every `totals` field `0`, `payment: null` |
| **Customer in Karnataka** (our state) | `tax`: CGST 9% and SGST 9% lines |
| **Global** | `series: "GL"`, `financialYear: null`, `currency: "USD"`, `tax: []`, `customer.gstStateCode: null`, `placeOfSupply: { "code": "96", "name": "Other Countries" }`, `taxNote`: "Supply meant for export of services under LUT without payment of IGST." |
| **Self-serve** (stage 2) | `source: "SELF_SERVE"`, `settlement: "GATEWAY"`, `orderNumber` set, `discounts.plan` / `discounts.coupon` filled, `payment.provider` and `payment.paymentId` set |
| **Unpaid** (stage 2) | `status: "UNPAID"`, `paidAt: null`, `dueAt` and `payNowUrl` set, `payment: null` |

Rendering rules:
- **Pick the template by `templateVersion`.** Keep every version the dashboard has ever shipped. If the version is unknown, show "Please refresh the dashboard to download this invoice" instead of rendering with another template.
- **Print only what's in the object.** Don't recompute amounts or look up current company or customer details; they may have changed since the invoice was issued.
- **Derived text** (amount in words, date formats, badge labels) is part of the template version: don't change it for an existing version.
- **`taxNote`, `placeOfSupply`, `supplier.cin` and `supplier.lutArn`:** print them when not `null`.
- **The line's sub-text** ("40,000 credits · valid 30 days · Acme KYC") comes from `credits`, `validityDays` and `app.appName`.
- **File name:** the invoice number with `/` replaced by `-`, for example `HS-IN-2026-27-000123.pdf`.

#### `GET /api/v1/billing/invoices/:invoiceId`

The full invoice, for **Download**. Needs `READ_BILLING`.

- **200:** `InvoiceDocument`
- **404 `INVOICE_NOT_FOUND`:** no such invoice in the caller's organisation.

Emailing invoices is **deferred**: there is no email endpoint in v1.

---

### 5. Invoices: super admin

The **Super Admin › Recharge Service Credits** page, when ID Service is selected (§8.2). These endpoints need a super-admin session.

#### `GET /api/v1/admin/billing/profiles?appId=…`

Feeds the **Billed to** card in step 1.

**200:**

```json
{
  "app": { "appId": "98f0815cf8c2096a2b54ea1746f5b9538a72", "appName": "Acme KYC", "serviceId": "CAVACH_API" },
  "org": { "orgId": "69832fafec5bf58b25caff2b", "companyName": "Acme Technologies" },
  "profile": { "…": "BillingProfile, as in §2" }
}
```

- **404 `APP_NOT_FOUND`**
- **422 `APP_NOT_BILLABLE`:** an SSI app. Use the existing SSI recharge flow.
- **`profile.complete: false`:** list `profile.missingFields` and disable creation, because invoices need a complete profile.

#### `PATCH /api/v1/admin/billing/profiles/:orgId`

Completes or corrects a customer's billing profile, for example before invoicing a customer who never saved the billing form. The body is the full profile, as for the customer's `PUT` (§2), plus three admin fields:

| Field | Notes |
|---|---|
| `region` | Optional, `IN` or `GLOBAL`. Changes the billing region and currency |
| `unlock` | Optional. `true` clears the lock set by the first invoice |
| `reason` | **Required.** Logged with the super admin's id |

Unlike the customer, a super admin may change tax IDs on a locked profile. Saving marks the profile confirmed, so `complete` becomes `true` when nothing is missing.

```json
{
  "legalName": "Acme Technologies Private Limited",
  "email": "billing@acme.example",
  "address": { "street": "4 Linking Road", "city": "Mumbai", "province": "Maharashtra", "postalCode": "400050", "country": "IN" },
  "taxIds": [{ "type": "GSTIN", "number": "27ABCDE1234F1Z5" }],
  "reason": "Details confirmed with the customer by email"
}
```

- **200:** `BillingProfile`
- **400 `VALIDATION_FAILED`**, **404 `ONBOARDING_NOT_FOUND`**

#### `POST /api/v1/admin/billing/invoices/preview`

Feeds the summary panel's live totals while the admin types. It creates nothing. Debounce it by about 400 ms. The body is the same as for create, without `Idempotency-Key`.

**200:**

```json
{
  "currency": "INR",
  "credits": 40000,
  "validityDays": 30,
  "totalBeforeTaxMinor": 4000000,
  "tax": { "amountMinor": 720000, "lines": [{ "type": "IGST", "rateBps": 1800, "amountMinor": 720000 }] },
  "totalMinor": 4720000,
  "willIssueAs": { "status": "PAID", "settlement": "OFFLINE" },
  "creditsActive": "IMMEDIATELY"
}
```

- **`creditsActive`:** `IMMEDIATELY` when the app has no active plan; `AFTER_CURRENT_PLAN` when it has one, because a new plan waits until the current one runs low or the customer activates it (today's credit behaviour); `WHEN_PAID` for **Collect payment** (stage 2). Show it in the summary panel, for example "Credits start after the current plan".
- **Errors:** the same as for create.

#### `POST /api/v1/admin/billing/invoices`

Creates the invoice. Header: `Idempotency-Key`.

**Free credits:**

```json
{ "appId": "98f0815cf8c2096a2b54ea1746f5b9538a72", "credits": 5000, "validityDays": 30, "amountMinor": 0, "note": "Pilot credits agreed by sales" }
```

**Already paid:**

```json
{
  "appId": "98f0815cf8c2096a2b54ea1746f5b9538a72",
  "credits": 40000,
  "validityDays": 30,
  "amountMinor": 4000000,
  "isPaid": true,
  "payment": { "method": "BANK_TRANSFER", "reference": "UTR0012345678", "paidAt": "2026-10-30" },
  "note": "Annual prepay"
}
```

| Field | Rules |
|---|---|
| `credits` | Whole number above 0 |
| `validityDays` | Whole number above 0. The UI turns months into days, using the region's validity add-on as the default (India 30, Global 180) |
| `amountMinor` | **Excludes tax.** `0` means complimentary, and then `isPaid` and `payment` are ignored |
| `isPaid` | Required when `amountMinor > 0`. `false` is **Collect payment** (stage 2) and returns `422 PAYMENTS_NOT_AVAILABLE` until then |
| `payment` | Required when `isPaid` is `true`. `method` is an `OfflinePaymentMethod`, `reference` can't be empty, and `paidAt` is a date (`YYYY-MM-DD`) not in the future |
| `recipients` | Optional list of email addresses. Defaults to the billing email |
| `note` | Optional and internal. It isn't printed on the invoice |

**201:**

```json
{
  "invoice": { "…": "InvoiceSummary, as in §4" },
  "paymentLink": null
}
```

The result card shows `invoice.invoiceNumber`, the customer and the total, with **Download invoice**, which loads `GET /admin/billing/invoices/:invoiceId` (below) and renders the PDF. `paymentLink` is only set for **Collect payment** (stage 2).

**Errors:**

| HTTP | `code` | Notes |
|---|---|---|
| 422 | `BILLING_PROFILE_INCOMPLETE` | `details.missingFields` holds the missing field paths |
| 422 | `PAYMENTS_NOT_AVAILABLE` | `isPaid: false` before stage 2 |
| 409 | `IDEMPOTENCY_KEY_REUSED` | The same key was used with a different body. Generate a new key |
| 422 | `APP_NOT_BILLABLE` | An SSI app. Use the existing SSI recharge |
| 422 | `ONBOARDING_NOT_FOUND` | The app's owner has no organisation |
| 503 | `BILLING_NOT_CONFIGURED` | Our company details (`BILLING_*` settings) are missing or inconsistent. `details.problems` lists them. Show "Invoicing is not configured yet" |
| 500 | (no code) | `message[0]`: "Invoice … was issued, but the credits could not be granted yet. Retry with the same Idempotency-Key." Show it with a **Retry** button that resends the same request and key; the retry grants the credits without issuing a second invoice |

A retry with the same key and body returns the original `201` response.

#### `GET /api/v1/admin/billing/invoices?orgId=…&appId=…&status=…&source=…&settlement=…&from=…&to=…&page=…&limit=…`

Searches all invoices. All filters are optional; `from` and `to` are dates (`YYYY-MM-DD`) on `issuedAt`.

- **200:** a paginated list of `InvoiceSummary`, each with `"org": { "orgId": "…", "companyName": "…" }` added.

#### `GET /api/v1/admin/billing/invoices/:invoiceId`

The same `InvoiceDocument` as the customer endpoint (§4), for any organisation, with `"org": { "orgId": "…", "companyName": "…" }` added. The result card's **Download invoice** renders the PDF from it.

- **404 `INVOICE_NOT_FOUND`**

#### Existing endpoint, changed

`POST /api/v1/app/:appId/credits`: once the `BILLING_INVOICED_GRANTS` setting is `true`, it returns **409 `USE_INVOICES`** for ID Service apps. It stays off until the new recharge page is live, so the current page keeps working. SSI Service apps are unchanged.

---

## Stage 2: payments (provisional)

These depend on the gateway choice and may change. Build them only behind `features.pay`.

### 6. Checkout

#### 6.1 `POST /api/v1/billing/orders`

Pay. Header: `Idempotency-Key`. Needs `WRITE_BILLING`.

```json
{ "quoteId": "6723b0a1c1d2e3f4a5b6c7e9" }
```

**201:**

```json
{
  "orderId": "6723d1e2c1d2e3f4a5b6c801",
  "orderNumber": "ORD-2026-000123",
  "status": "PENDING_PAYMENT",
  "checkoutUrl": "https://gateway.example/checkout/…",
  "expiresAt": "2026-10-31T10:45:00.000Z"
}
```

Redirect the browser to `checkoutUrl`. The gateway sends the user back to `/credits/payment/return?orderId=…`.

**Errors:**

| HTTP | `code` | UI behaviour |
|---|---|---|
| 409 | `QUOTE_EXPIRED` | Request a new quote. If the total changed, ask the user to confirm; otherwise retry Pay |
| 422 | `COUPON_INVALID` | Remove the coupon, show the new total and ask the user to confirm |
| 422 | `BILLING_PROFILE_INCOMPLETE` | Show the billing details form |
| 503 | `PAYMENTS_UNAVAILABLE` | "Payments are temporarily unavailable", with a retry |

#### 6.2 `GET /api/v1/billing/orders/:orderId`

Polled by the return page every 2 seconds, for up to 60 seconds.

**200:**

```json
{
  "orderId": "6723d1e2c1d2e3f4a5b6c801",
  "orderNumber": "ORD-2026-000123",
  "status": "FULFILLED",
  "appId": "98f0815cf8c2096a2b54ea1746f5b9538a72",
  "appName": "Acme KYC",
  "currency": "INR",
  "totalMinor": 203469,
  "credits": 2499,
  "invoice": { "invoiceId": "6723c4d2c1d2e3f4a5b6c7f0", "invoiceNumber": "HS/IN/2026-27/000124" },
  "failureReason": null
}
```

How the return page uses `status`:

| `status` | Return page shows |
|---|---|
| `FULFILLED` | "{credits} credits added", with **Download invoice** |
| `PENDING_PAYMENT`, `PAID` | Keep polling. After 60 seconds: "Payment processing; credits will appear once confirmed" |
| `FAILED`, `EXPIRED`, `CANCELLED` | Failure message with **Try again** |
| `NEEDS_REVIEW` | "We're checking your payment. Our team will contact you." |

#### 6.3 `POST /api/v1/billing/orders/:orderId/cancel`

The customer abandons an unpaid order. No body.

- **200:** the order, with `status: "CANCELLED"`.

### 7. Paying an unpaid invoice

- **Customers:** an `UNPAID` `InvoiceSummary` has `dueAt` and `payNowUrl`. **Pay now** opens `payNowUrl`.
- **Super admin, Collect payment:** `POST /admin/billing/invoices` with `"isPaid": false` and optional `recipients` returns:

```json
{
  "invoice": { "…": "InvoiceSummary with status UNPAID" },
  "paymentLink": { "url": "https://gateway.example/pay/…", "expiresAt": "2026-11-15T09:00:00.000Z", "sentTo": ["billing@acme.example"] }
}
```

- **Super-admin actions on an unpaid invoice:**

| Endpoint | Body | Effect |
|---|---|---|
| `POST /admin/billing/invoices/:id/mark-paid` | `{ "method": "BANK_TRANSFER", "reference": "UTR…", "paidAt": "2026-11-02" }` | Settles the invoice and activates its credits |
| `POST /admin/billing/invoices/:id/payment-link` | none | Creates a new link after the old one expired |
| `POST /admin/billing/invoices/:id/remind` | none | Emails the link again |
| `POST /admin/billing/invoices/:id/void` | `{ "reason": "…" }` | Voids the invoice. No credits are granted |

---

## Changelog

| Date | Change |
|---|---|
| 2026-10-31 | First version. Stage 1 agreed; stage 2 provisional. |
| 2026-10-31 | §1.5: stated that `code` and `details` are billing additions; other endpoints return only `statusCode`, `message` and `error`. |
| 2026-10-31 | §1.5: 403 and 429 come from the shared permission guard and rate limiter, so they carry no `code`. `GET /billing/catalog` and `GET /billing/coupons` are implemented. |
| 2026-11-01 | §4–5 implemented (super-admin Free credits and Already paid, invoice list and data, customer list and data). `PATCH /admin/billing/profiles/:orgId` takes the full profile plus `region`, `unlock` and `reason`. Preview `creditsActive` adds `AFTER_CURRENT_PLAN`. Create adds `503 BILLING_NOT_CONFIGURED` and the retryable 500. The `USE_INVOICES` 409 is behind `BILLING_INVOICED_GRANTS`. |
| 2026-11-01 | Invoices: PDFs are rendered by the dashboard. `GET /billing/invoices/:id/download` and `GET /admin/billing/invoices/:id/download` are replaced by `GET /billing/invoices/:id` and `GET /admin/billing/invoices/:id`, which return the new `InvoiceDocument` object (§4). `POST /billing/invoices/:id/email` is deferred. |
| 2026-10-31 | Global charges no tax: `taxMode` and `tax.mode` are `NONE` with `tax.amountMinor: 0` (was `CALCULATED_AT_CHECKOUT` with `null`). India unchanged: a single "GST 18%" line until the customer's state is known. |
| 2026-10-31 | §2 and §3.3 implemented: `GET`/`PUT /customer-onboarding/billing` and `POST /billing/quotes`. §2: `complete` also requires a saved profile. §3.3: added `429 RATE_LIMITED` for repeated rejected coupon codes. |
