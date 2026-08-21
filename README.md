## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Concepts with code commits

Added basic project st. with following features

- [Basic project st.](https://github.com/hypersign-protocol/studio-api/commit/d80f266d6ed4a458c66257b60b1df2bd84d1622b)
- [Modules](https://github.com/hypersign-protocol/studio-api/commit/0c27814642feee7ff4a517fd4cce257273ce683d)
- [Services](https://github.com/hypersign-protocol/studio-api/commit/0c27814642feee7ff4a517fd4cce257273ce683d)
- [Controllers](https://github.com/hypersign-protocol/studio-api/commit/0c27814642feee7ff4a517fd4cce257273ce683d)
- [Middleware](https://github.com/hypersign-protocol/studio-api/commit/9a6b7b396685cf9d9b592cfacb8e852cf918082f)
- [Swagger Doc](https://github.com/hypersign-protocol/studio-api/commit/e0b23fba36076c97daeaed8e6fbce7d0cb1abf24)
- [Validation](https://github.com/hypersign-protocol/studio-api/commit/4e73e7cbcfe699111581d53ad4c5d9a2bbca8260)
- [Exceptions](https://github.com/hypersign-protocol/studio-api/commit/bd6959b50216cded979309f62a8936c111d3b947)
- [DTOs](https://github.com/hypersign-protocol/studio-api/commit/0c27814642feee7ff4a517fd4cce257273ce683d)
- [Mongo Database connection](https://github.com/hypersign-protocol/studio-api/commit/357436181e4a525fe50b2c8cc4a50c016a437489)
- [environment var](https://github.com/hypersign-protocol/studio-api/commit/2d119e6898a772dcf6ff54e477eb5d354e9b4e18)

## Architecture

![img](https://camo.githubusercontent.com/c26967122228485ff75c80f03d4c9816759bc8fd0dd1a9477edb9a150f92479e/68747470733a2f2f6d656469612e646973636f72646170702e6e65742f6174746163686d656e74732f313032363338323037363937363537343532342f313034393932323436383531303434393636342f696d6167652e706e673f77696474683d31313535266865696768743d363631)

## Pre-requisites

Node version `v16.14.0`

```bash
npm i -g @nestjs/cli
```

## Use full commands

```bash
## Generate a new module
nest g module <module-name>

## Generate a controller
nest g controller <module-name/controllers/controller-name>

## Generate a service
nest g service <module-name/services/service-name>

## Generate a  middleware
nest g middleware <module-name/middlewares/middleware-name>
```

## Installation

```bash
$ yarn
```

## Building the app

```bash

  yarn build

```

## Running the app

```bash
# development
$ yarn run start

# watch mode
$ yarn run start:dev

# production mode
$ yarn run start:prod
```

## Test

```bash
#Test using postman collection
 yarn test:newman
```

## create tag

- bump version and create tag

```bash
 #command
  yarn bumpVersion --ver ${flag/version-number}
#example
 # yarn bumpVersion --ver patch // for bug fix
 #yarn bumpVersion --ver minor // for minor changes
 #yarn bumpVersion --ver major // for major changes
  #yarn bumpVersion --ver 1.2.0 // for custom version
```

- push tag

```bash
  yarn pushTag
```

## Docs

- http://localhost:3001/api
- http://localhost:3001/api-json

## KYC credit integration

The dashboard is the system of record for credit plans. KYC plans are delivered
to `@hypersign-protocol/credit-middleware` version 5 through BullMQ schema-v3
commands.

Required Redis configuration:

- `CREDIT_REDIS_URL`, or `REDIS_HOST` plus `REDIS_PORT`;
- the same Redis instance used by the KYC service; and
- the default BullMQ prefix `bull` unless both applications override it.

Transport contract:

- service type: `KYC_SERVICE`;
- grant queue: `credit.commands.KYC_SERVICE`;
- lifecycle queue: `credit.lifecycle`;
- grant job: `credit.grant.requested`;
- envelope schema: `3`.

`POST /api/v1/app/:appId/credits` requires a stable `referenceId`, `amount`,
plan-specific `criticalBalance`, and validity. Retrying the same business
purchase must reuse `referenceId`; changing its financial semantics is rejected.
The dashboard atomically finds-or-creates a plan under the unique
`serviceId + referenceId` key and stores its expiry before publishing the grant,
so concurrent retries use identical `planId`, amount, threshold, grant time,
and expiry.

The lifecycle worker applies `credit.committed` idempotently to the exact Mongo
plan, activates plans after `credit.granted`, handles plan expiry and critical
balance events, and validates DEV `credit.observed` events. DEV observations
always have `deductedAmount: 0`; they are operational logs and do not update
financial usage.

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://kamilmysliwiec.com)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](LICENSE).

```

```
