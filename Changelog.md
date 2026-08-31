# Changelog

## [Unreleased]


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
- Added a way to track credit issuer.

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
- Issueing BJJ issuer did if interested service is  `AGE_VERIFCATION` or `PROOF_OF_PERSONHOOD`
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