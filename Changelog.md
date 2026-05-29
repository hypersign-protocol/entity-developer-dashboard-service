# Changelog

## [Unreleased]
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

## [3.11.12] - 2026-06-28
### Fixed

- Updated URL sanitizer to store only the origin in whitelisted CORS entries, excluding query parameters and paths.
- Fixed the issue of multiple entries for the same access type being added to the access list in the database.
- Modified the user update function to support both aggregation pipelines and update objects.
### Added 

- Added Changelog.md file to track changes in the project.
- Update package.json to bump version to 3.11.12.