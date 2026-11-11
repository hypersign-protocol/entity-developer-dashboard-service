# Changelog

## [Unreleased]

### Added — Billing module (`src/billing`)

- Added a price book catalog and coupons: `GET /api/v1/billing/catalog` returns the published prices for the caller's region, and `GET /api/v1/billing/coupons` returns the coupons the caller is eligible for.
- Added billing profiles with India GST support. `GET` and `PUT /api/v1/customer-onboarding/billing` read and save the profile. The tax split (CGST + SGST, or IGST) is worked out from the supplier and customer state codes.
- Added `POST /api/v1/billing/quotes`, which prices a credit top-up with the coupon and tax applied.
- Added invoices with sequential invoice numbers, our supplier details ("Billed by") and the SAC code. Users can list and fetch their invoices with `GET /api/v1/billing/invoices` and `GET /api/v1/billing/invoices/:invoiceId`.
- Added super-admin billing APIs under `/api/v1/admin/billing`: list and update billing profiles, preview and issue invoices for free or offline-paid credits, list invoices, and list, cancel or resend payment links.
- Added a free-credit promotion that each organisation can claim once: `GET /api/v1/billing/promotion` and `POST /api/v1/billing/promotion/claim`.
- KYB approval now saves the full KYB details into the billing profile, including personal tax IDs. Coupons and invoices use these details.
- Added `BILLING_INVOICED_GRANTS`. When it is `true`, ID Service credits can only be granted through invoices, and `POST /api/v1/app/:appId/credits` returns 409.
- Added the `READ_BILLING` and `WRITE_BILLING` dashboard access types.

### Added — Payments (Razorpay)

- Added Razorpay as the first payment gateway, behind a payment-provider interface so that more gateways can be added later. Payments are offered in India first.
- Added orders: `POST /api/v1/billing/orders`, `GET /api/v1/billing/orders/:orderId`, `POST /api/v1/billing/orders/:orderId/confirm` (checks the checkout signature, then grants credits and issues an invoice) and `POST /api/v1/billing/orders/:orderId/cancel`.
- Coupons are reserved while an order is pending and released when it is cancelled or fails.
- Added payment links for global (non-India) customers. Users can list theirs with `GET /api/v1/billing/payment-links`.
- Added a payment-reconciliation job that runs every 5 minutes. It settles orders and payment links whose confirmation never arrived.
- Added an optional Razorpay webhook at `POST /api/v1/billing/webhooks/razorpay`. It checks the signature against `RAZORPAY_WEBHOOK_SECRET` and records each event once, so a repeated event is not processed twice.

### Configuration

- New environment variables (see `env.sample`): `BILLING_ENABLED_REGIONS`, `BILLING_PAY_ENABLED`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `BILLING_CHECKOUT_NAME`, `BILLING_SUPPLIER_*` (legal name, address, GSTIN, PAN, CIN, LUT ARN, state code), `BILLING_SAC_CODE`, `BILLING_INVOICE_PREFIX` and `BILLING_INVOICED_GRANTS`. Redis (`REDIS_URL` or `REDIS_HOST`/`REDIS_PORT`) is needed for the reconciliation job.
- Seed and backfill scripts are in `docs/payment/scripts/`: price books and coupons, the KYB-approved date backfill, and a staging test account.
- The design, API contract, epics and go-live checklist are in `docs/payment/`.

### Fixed

- Fixed payment-link creation for global payments.
- Fixed payment-link reconciliation.

## [3.18.0] 

- Updated access control for `/customer-onboarding/{id}/process`: superadmins and the onboarding owner can now access the endpoint.
- Added a reusable function to calculate SSI and KYC credits based on the service type.
- Removed credit details from the request body of `POST /api/v1/customer-onboarding/{id}/process`.
- Updated `POST /api/v1/customer-onboarding` to automatically process credits based on the type of service requested by the user.
- Added an L1 support email to superadmins to trigger re-onboarding in case of onboarding failure.
- Implemented Redis to display the live status of the onboarding process.
- Removed `kyc-credit` allocation during onboarding, as credits are not required in dev mode.
- Added free credit allocation for production mode.

### Fixed

- Fixed onboarding recovery so users can retry from the next incomplete step after an interrupted process.
## [3.17.0] - 2026-10-07
### Added

- Added new access to the /oauth API for third-party customers to access KYB APIs.
- Added businessId as an optional query parameter to the /oauth API.
- Implemented PATCH /customer-onboarding to verify the company when moving an app to production.
- Implemented checks for MFA setup and company verification when moving an app to production.
## [3.16.5] - 2026-10-06

### Updated

- Fixed bug related to country selection

## [3.16.4] - 2026-10-06

### Updated

- Mail footer
- Twitter link

## [3.16.3] - 2026-09-30

### Modified

- Added some new services to the Interested Services list.
- Added a new field, referralSource, to track how users came to know about us.
- Added validation for AADHAR_VERIFICATION, PAN_VERIFICATION, and BANK_VERIFICATION services. These services can only be selected if the user is from India.
- Disable built-in-login&vault-setp and email notification while onboarding
- Fixed access list caching issue

## [3.16.2] - 2026-09-28

### Added

- Exposed session read access for dashboard
- Added new service type `AADHAR_VERIFICATION`
- Updated credit request template with more customer information

## [3.16.1] - 2026-09-04

### Added

- Added `DELETE_WIDGET_CONFIG` access permission for deleting widget configurations.
- Added optional `linkedWidgetConfigIds` parameter to store linked widget configuration IDs.
- Updated customer onboarding to pass linkedWidgetConfigIds to the KYC verifier page and name/description when configuring the ID widget.
- Added companyName, email and user name in mail template of super admin

## [3.16.0] - 2026-08-27

### Added

- Api to fetch credit list
- Api to activate specific credit
- Storing credit detail in respective service queue
- Added serviceType to the credit schema so that we don't need to query the apps table to determine whether the plan is for ID Service or SSI Service.”
- Storing event details in a time-series-based table

## [Unreleased]

## [3.15.0] - 2026-07-16

- Added credit expiry email processing.
- Implemented credit expiry and credit exhaustion email notifications for SUPER_ADMIN users of the API service.
- Updated the `find()` method in `UserRepository` to support optional field projection.

## [3.14.0] - 2026-07-14

### Changed
- Added a way to trak credit issuer.

## [3.13.1] - 2026-07-06

### Changed

- Updated hypersign logo url.

## [3.13.0] - 2026-06-24

### Added

- Added new access `WRITE_ZK_PROOF_VERIFY` for accessing zk-proof verifcation api.
- Added `ed25519` and `babyJubJub` keys for ZK-proof verification.
- Granted All dashboard access during onboarding.
- Enabled ZKProofAge with the default age of 18 when `AgeVerification` is selected as a service.

## [3.12.3] - 2026-06-10

### Added

- Added businessId as an optional query parameter in verifier token generation.

## [3.12.2] - 2026-06-02

### Added

- Generating Kyb token with kyb grants
- Implemented role based access
- Providing dashboard access while onboarding new customer

## [3.12.0] - 2026-05-29

### Added

- Added logger statements for debugging
- Added support for storing username during email OTP login by extracting it from the email before `@`
- Added api to get list of user accessing admin account

### Fixed

- Fixed delete authenticator API
- Fixed deletion of linked SSI service while deleting IdService
- Fixed stale tenant permissions in generated service access tokens after role updates.

## [3.11.14] - 2026-05-26

### Added

- Added logger statements for debugging
- Added support for storing username during email OTP login by extracting it from the email before `@`
- Added new service type `PROOF_OF_PERSONHOOD` in onboarding
- Issueing BJJ issuer did if interested service is `AGE_VERIFCATION` or `PROOF_OF_PERSONHOOD`
- Added api to fetch list of user accessing particular tennat data.

### Fixed

- Fixed delete authenticator API
- Fixed deletion of linked SSI service while deleting IdService
- Fixed stale tenant permissions in generated service access tokens after role updates.
- Update `SSI API Service` and `KYC API Service` labels to `SSI Service` and `ID Service`.
- Fixed issue of invite getting accepted by othe user if it has invite code

## [3.11.13] - 2026-05-14

### Added

- Update package.json to bump version to 3.11.13.
- Updated `hypersign-vault-client` and `hs-ssi-sdk` to latest master branch

## [3.11.13] - 2026-05-14

### Added

- Update package.json to bump version to 3.11.13.
- Updated `hypersign-vault-client` and `hs-ssi-sdk` to latest master branch

## [3.11.12] - 2026-06-28

### Fixed

- Updated URL sanitizer to store only the origin in whitelisted CORS entries, excluding query parameters and paths.
- Fixed the issue of multiple entries for the same access type being added to the access list in the database.
- Modified the user update function to support both aggregation pipelines and update objects.

### Added

- Added Changelog.md file to track changes in the project.
- Update package.json to bump version to 3.11.12.
