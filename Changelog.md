# Changelog

## [Unreleased]
## [3.11.14] - 2026-05-25
### Added
- Added logger statements for debugging
- Added support for storing username during email OTP login by extracting it from the email before `@`

### Fixed
- Fixed delete authenticator API
- Fixed deletion of linked SSI service while deleting IdService
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