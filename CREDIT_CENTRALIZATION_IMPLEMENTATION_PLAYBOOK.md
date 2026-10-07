# Centralized Credit Management Implementation Playbook

## 1. Objective

Move credit-plan ownership from the KYC/Cavach and SSI API services into the Entity Developer Dashboard service while preserving existing plan behavior.

The finished system must have these properties:

- Dashboard MongoDB is the durable source of truth for every credit plan.
- Redis is the runtime source used for fast balance checks and atomic deductions.
- Product services do not create, activate, update, or store credit plans.
- A shared middleware package contains billable API mappings and enforcement logic.
- A dashboard worker synchronizes Redis deductions into MongoDB.
- Existing service-local plans are migrated without losing balances or history.
- Cutover happens through shadow mode, reconciliation, and one-service-at-a-time enforcement.

## 2. Repositories and ownership

### `entity-developer-dashboard-service`

Owns:

- Centralized plan schema and collection
- Plan creation, activation, listing, and balance APIs
- Manual recharge flow
- Customer onboarding provisioning
- Initial Cavach credit provisioning
- SSI AuthZ/feegrant creation
- Redis hydration
- Internal active-plan endpoint
- Redis-to-MongoDB sync worker
- Notifications
- Migration scripts and reconciliation tools

### `hypersign-kyc-service`

Eventually removes:

- `src/common/creditManager` persistence and managers
- Local verification and deduction guards
- Public/local plan mutation APIs
- Local notification handling for credits

It retains the old implementation only during shadow mode.

### `entity-api-service`

Eventually removes:

- `src/credit-manager` persistence and managers
- Local plan APIs
- Local credit and HID allowance deduction

It retains the old implementation only during shadow mode.

### New shared package

Create a separately versioned package named:

```text
@hypersign/credit-middleware
```

Do not place dashboard persistence code in this package. It is a runtime client used by product services.

## 3. Decisions to lock before coding

Use these decisions consistently unless the team explicitly changes the ADR:

1. Use plural `credits` in all dashboard routes.
2. Use HTTP 402 for absent, expired, or insufficient paid credits.
3. Use HTTP 503 when Redis/dashboard hydration is unavailable and enforcement is fail-closed.
4. Use a trusted incoming `x-request-id`; generate a UUID when it is absent.
5. Store monetary/credit counters as integer values only. Reject decimals, negatives, `NaN`, and values above JavaScript safe-integer range.
6. Use UTC timestamps and ISO-8601 API responses.
7. Treat `serviceId` as the dashboard `appId`.
8. A service can have only one active plan.
9. New recharges are inactive when an active plan already exists.
10. An inactive plan starts its validity clock when activated, not when created.
11. Deduct only for configured successful status codes. Default success range is 200-399.
12. Dev/free bypass behavior must be explicit configuration, never inferred silently.
13. Redis is not audit storage. Configure persistence and export usage events to durable storage.
14. Do not delete service-local credit data during rollout.

## 4. Dashboard data model

Create `src/credit-management/schemas/centralized-credit-plan.schema.ts`.

```ts
export enum CreditStatus {
  ACTIVE = 'Active',
  INACTIVE = 'Inactive',
}

export enum CreditSource {
  MANUAL_RECHARGE = 'MANUAL_RECHARGE',
  CUSTOMER_ONBOARDING = 'CUSTOMER_ONBOARDING',
  INITIAL_FREE_CREDIT = 'INITIAL_FREE_CREDIT',
  MIGRATION = 'MIGRATION',
  PAYMENT = 'PAYMENT',
  ADJUSTMENT = 'ADJUSTMENT',
}

export enum MigrationSource {
  KYC_SERVICE = 'KYC_SERVICE',
  SSI_SERVICE = 'SSI_SERVICE',
}

@Schema({ _id: false })
export class CreditNotificationState {
  @Prop({ type: Number, default: 0 })
  lastNotifiedUsageThreshold?: number;

  @Prop({ type: [Number], default: [] })
  expiryThresholdsSent?: number[];

  @Prop({ type: Boolean, default: false })
  exhaustedNotificationSent?: boolean;
}

@Schema({ _id: false })
export class OnChainCreditAllowance {
  @Prop({ required: true, type: Number, min: 0 })
  amount: number;

  @Prop({ required: true, type: String })
  denom: string;

  @Prop({ required: true, type: Number, default: 0, min: 0 })
  usedAmount: number;
}

@Schema({ timestamps: true, collection: 'centralized_credit_plans' })
export class CentralizedCreditPlan {
  @Prop({ required: true, type: String, trim: true })
  serviceId: string;

  @Prop({ required: true, type: Number, min: 0 })
  totalCredits: number;

  @Prop({ required: true, type: Number, min: 0, default: 0 })
  usedCredits: number;

  @Prop({ required: true, type: Number, min: 1 })
  validityDays: number;

  @Prop({ required: false, type: Date })
  expiresAt?: Date;

  @Prop({ required: true, enum: CreditStatus, default: CreditStatus.INACTIVE })
  status: CreditStatus;

  @Prop({ required: false, type: OnChainCreditAllowance })
  onChainAllowance?: OnChainCreditAllowance;

  @Prop({ required: false, type: [String], default: [] })
  onChainAllowanceScopes?: string[];

  @Prop({ required: false, type: String })
  creditedBy?: string;

  @Prop({ required: true, enum: CreditSource })
  source: CreditSource;

  @Prop({ required: false, enum: MigrationSource })
  migrationSource?: MigrationSource;

  @Prop({ required: false, type: String })
  legacyCreditId?: string;

  @Prop({ required: false, type: CreditNotificationState })
  notification?: CreditNotificationState;

  @Prop({ required: true, type: Number, default: 1 })
  version: number;
}
```

Create these indexes:

```ts
CentralizedCreditPlanSchema.index({ serviceId: 1, createdAt: 1 });
CentralizedCreditPlanSchema.index({ serviceId: 1, status: 1 });
CentralizedCreditPlanSchema.index(
  { migrationSource: 1, legacyCreditId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      migrationSource: { $exists: true },
      legacyCreditId: { $exists: true },
    },
  },
);
CentralizedCreditPlanSchema.index(
  { serviceId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: CreditStatus.ACTIVE },
    name: 'one_active_credit_plan_per_service',
  },
);
```

Before adding the unique active-plan index to a database containing migrated data, run a duplicate-active-plan report and resolve every conflict.

### Validation invariants

Enforce in DTOs and service logic:

- `totalCredits >= 0`
- `0 <= usedCredits <= totalCredits`
- `validityDays >= 1`
- `0 <= onChainAllowance.usedAmount <= onChainAllowance.amount`
- On-chain allowance requires a non-empty denomination.
- SSI scopes are an allow-listed set, not arbitrary strings.
- Migration fields are required only when `source === MIGRATION`.
- `expiresAt` is required for active plans.

## 5. Dashboard module structure

Create:

```text
src/credit-management/
  controllers/
    credit-management.controller.ts
    internal-credit.controller.ts
  dto/
    create-credit-plan.dto.ts
    credit-balance-response.dto.ts
    list-credit-plans.dto.ts
  repositories/
    credit-plan.repository.ts
  schemas/
    centralized-credit-plan.schema.ts
    credit-usage-event.schema.ts
  services/
    credit-management.service.ts
    credit-redis.service.ts
    credit-rollover.service.ts
    credit-notification.service.ts
  workers/
    credit-sync.worker.ts
  scripts/
    migrate-kyc-credits.ts
    migrate-ssi-credits.ts
    reconcile-credit-usage.ts
  credit-management.module.ts
```

Keep the existing `src/credits` module temporarily as a compatibility entry point. Its public recharge controller should delegate to `CreditManagementService`.

## 6. Plan creation logic

Implement:

```ts
createCreditPlanForService(input: {
  serviceId: string;
  amount: number;
  validityPeriod: number;
  validityPeriodUnit: 'DAY' | 'DAYS' | 'WEEK' | 'MONTH' | 'YEAR';
  creditedBy?: string;
  source: CreditSource;
  onChainAllowance?: {
    amount: number;
    denom: string;
    usedAmount?: number;
  };
  onChainAllowanceScopes?: string[];
}): Promise<CentralizedCreditPlan>
```

Execute in this order:

1. Validate `serviceId` and load the dashboard app.
2. Verify that the app has exactly one supported billable service type.
3. Parse all amounts as safe non-negative integers.
4. Convert validity to days:
   - day/days: `value`
   - week: `value * 7`
   - month: `value * 30`
   - year: `value * 365`
5. If SSI provisioning requires AuthZ/feegrant, create it before inserting the plan and capture the returned allowance/scopes.
6. Start a MongoDB transaction.
7. Query the active plan for `serviceId`.
8. When an active plan exists, insert the new plan as inactive without `expiresAt`.
9. When no active plan exists, insert it as active and set `expiresAt = now + validityDays`.
10. Commit the transaction.
11. If the new plan is active, hydrate its Redis active key.
12. If Redis hydration fails, do not roll back the committed MongoDB plan. Log/metric the error; lazy hydration must recover it.
13. Return the saved plan and whether it became active.

Handle duplicate-key error from the unique active-plan index by retrying once as an inactive plan. This protects concurrent recharges.

For SSI chain grants, record the transaction hash or grant identifier if available. If the chain operation succeeds and MongoDB fails, emit an operational alert and compensation record; never silently repeat the chain grant.

## 7. Activation and rollover logic

Implement `activateCreditPlan(creditId)`:

1. Start a MongoDB transaction.
2. Load the target plan and fail with 404 if missing.
3. Reject it if `usedCredits >= totalCredits`.
4. Reject it if its existing `expiresAt` is already expired.
5. Deactivate the currently active plan for the same `serviceId`.
6. Set target status to active.
7. If it has no `expiresAt`, set it to `now + validityDays`.
8. Increment its `version`.
9. Commit.
10. Replace the Redis active snapshot using the resulting plan.

Implement `rolloverService(serviceId)`:

1. Load the current active plan.
2. Consider it unusable when expired, off-chain exhausted, or required SSI allowance exhausted.
3. Set it inactive in a transaction.
4. Find the oldest usable inactive plan by `createdAt`.
5. Activate it and start its expiry clock if needed.
6. Hydrate Redis with the new plan.
7. If none exists, delete the Redis active key and emit an exhausted event.

Never calculate `totalCredits - usedCredits` inside a normal Mongo filter. Use `$expr`, aggregation, or load-and-validate logic.

## 8. Dashboard APIs

### Manual recharge

```text
POST /api/v1/credits/:serviceId
```

Request:

```json
{
  "amount": 1000,
  "validityPeriod": 6,
  "validityPeriodUnit": "MONTH",
  "onChainAllowanceAmount": 5000000,
  "onChainAllowanceDenom": "uhid"
}
```

Rules:

- Require dashboard authentication and super-admin authorization.
- Use `creditedBy = req.user.userId`.
- Use `source = MANUAL_RECHARGE`.
- Ignore SSI allowance fields for non-SSI services.
- Do not call downstream `/api/v1/credit` endpoints.

### Activate plan

```text
POST /api/v1/credits/:creditId/activate
```

Require super-admin access.

### List plans

```text
GET /api/v1/credits/services/:serviceId
```

Support pagination and stable sorting. Never return internal migration or notification fields unless the caller is an admin.

### Active balance

```text
GET /api/v1/credits/services/:serviceId/balance
```

Response:

```json
{
  "serviceId": "app_123",
  "activeCreditId": "...",
  "totalCredits": 1000,
  "usedCredits": 250,
  "availableCredits": 750,
  "expiresAt": "2026-09-01T00:00:00.000Z",
  "onChainAllowance": {
    "amount": 5000000,
    "usedAmount": 100,
    "availableAmount": 4999900,
    "denom": "uhid"
  }
}
```

For the current runtime balance, prefer Redis when present. Fall back to MongoDB when absent. Indicate internally which source answered the request for observability.

### Internal hydration endpoint

```text
GET /api/v1/internal/credits/services/:serviceId/active
```

Rules:

- Authenticate with a dedicated service token or mTLS identity.
- Do not use a user-facing JWT.
- Rate-limit by calling service identity.
- Return 404 when no usable active plan exists.
- Return only the runtime snapshot fields.
- Log caller identity, service ID, request ID, and outcome.

## 9. Update existing dashboard flows

### Existing manual recharge

Change `CreditsController.grantCredit()` to call `createCreditPlanForService()`.

Delete the downstream token creation and product-service fetch from `AuthzCreditService.grantCredit()` only after the central call is covered by tests.

### Customer onboarding

Replace `handleCreditService()` downstream calls with two direct central service calls:

- SSI plan using the SSI app ID and AuthZ/feegrant allowance.
- KYC/Cavach plan using the KYC app ID without on-chain fields.

Use `source = CUSTOMER_ONBOARDING` and `creditedBy = superAdminUserId`.

Make onboarding retries idempotent. Store or derive a provisioning idempotency key such as:

```text
customer-onboarding:{onboardingId}:{serviceType}:credit
```

Do not create a second plan when the onboarding operation is retried.

### Initial free Cavach plan

Replace `grantCavachCredit()` with a central plan call after app creation:

```ts
createCreditPlanForService({
  serviceId: appId,
  amount: 1501,
  validityPeriod: 6,
  validityPeriodUnit: 'MONTH',
  creditedBy: userId,
  source: CreditSource.INITIAL_FREE_CREDIT,
});
```

Define whether app creation must fail if initial credit creation fails. Recommended behavior: fail the workflow or place it in a recoverable `PROVISIONING_FAILED` state; do not return a fully provisioned app without its promised plan.

## 10. Redis runtime model

Use a dedicated Redis connection/config namespace. Add environment variables:

```text
CREDIT_REDIS_URL=
CREDIT_REDIS_KEY_PREFIX=credit
CREDIT_IDEMPOTENCY_TTL_SECONDS=86400
CREDIT_SYNC_INTERVAL_MS=5000
CREDIT_INTERNAL_AUTH_TOKEN=
CREDIT_USAGE_STREAM_MAXLEN=
```

### Active snapshot

```text
credit:service:{serviceId}:active
```

Redis hash fields:

```text
creditId
serviceId
totalCredits
usedCredits
expiresAtEpochMs
onChainAllowanceAmount
onChainAllowanceUsedAmount
onChainAllowanceDenom
version
lastHydratedAtEpochMs
```

Use integers for counters and epoch milliseconds for timestamps. Do not store JSON numbers that must be parsed inconsistently.

### Pending delta

```text
credit:service:{serviceId}:plan:{creditId}:delta
```

Hash fields:

```text
usedCreditsDelta
onChainAllowanceUsedAmountDelta
requestCount
lastUpdatedAtEpochMs
```

### Inflight worker delta

```text
credit:service:{serviceId}:plan:{creditId}:inflight:{batchId}
```

This prevents loss when MongoDB fails after the worker claims a delta.

### Usage stream

```text
credit:usage-events
```

Event fields:

```text
eventId
serviceId
creditId
requestId
creditKey
amount
hidAmount
method
routeTemplate
statusCode
occurredAt
middlewareVersion
mode
```

Use normalized route templates, not URLs containing customer identifiers or secrets.

### Idempotency

```text
credit:idempotency:{requestId}
```

TTL: 24 hours by default. The value contains the deduction result.

Request IDs must be unique per logical billable operation. A client must not reuse the same ID for different endpoints or payloads. Store an operation fingerprint and reject mismatched reuse.

### Hydration lock

```text
credit:service:{serviceId}:hydrate-lock
```

Acquire with `SET value NX EX 10`. Release only when the stored lock value matches the caller's unique value.

## 11. Atomic deduction Lua logic

The shared package must execute one Lua script after a successful handler result and before sending the final response where the framework permits it.

Inputs:

- Active key
- Delta key
- Usage stream key
- Idempotency key
- Expected credit ID/version
- Off-chain amount
- HID amount
- Idempotency TTL
- Event fields and operation fingerprint

The script must:

1. Reject negative/non-integer amounts.
2. Return the stored result if the idempotency key exists and fingerprint matches.
3. Return `IDEMPOTENCY_CONFLICT` if the request ID exists with another fingerprint.
4. Return `REDIS_MISS` if the active key or mandatory fields are absent.
5. Return `PLAN_CHANGED` if credit ID/version differs from the middleware snapshot.
6. Return `CREDIT_EXPIRED` when expiry is at or before Redis server time.
7. Compute remaining off-chain balance.
8. Compute remaining HID allowance when `hidAmount > 0`.
9. Return the relevant insufficient-balance result before changing anything.
10. Increment active usage fields.
11. Increment delta fields and request count.
12. Append the usage event.
13. Store the idempotency result with TTL.
14. Return a structured success result containing resulting balances.

Do not increment and then manually roll back. Validate both off-chain and HID balances first, then perform all writes.

On `REDIS_MISS`, hydrate once and retry once. On `PLAN_CHANGED`, reread and retry once. Never retry indefinitely.

## 12. Shared middleware package

Suggested structure:

```text
src/
  catalog/
    cavach.cost-catalog.ts
    ssi.cost-catalog.ts
  decorators/
    billable.decorator.ts
  resolvers/
    service-identity.resolver.ts
    billable-action.resolver.ts
  redis/
    credit-redis.client.ts
    deduct-credit.lua
  clients/
    dashboard-credit.client.ts
  middleware/
    credit.interceptor.ts
  types/
  testing/
```

Registration:

```ts
CreditMiddlewareModule.register({
  serviceType: 'CAVACH_API',
  redisUrl: process.env.CREDIT_REDIS_URL,
  dashboardInternalUrl: process.env.DASHBOARD_INTERNAL_URL,
  internalAuthToken: process.env.DASHBOARD_INTERNAL_AUTH_TOKEN,
  mode: 'SHADOW' | 'ENFORCE',
  failMode: 'CLOSED',
  successStatusCodes: { min: 200, max: 399 },
});
```

Request flow:

1. Resolve authenticated `serviceId` from trusted request/app context.
2. Resolve the normalized route and billable action.
3. If the route is not billable, continue without Redis work.
4. Obtain/generate `requestId` and propagate it in the response.
5. Read the active snapshot.
6. On miss, acquire hydration lock and call the internal dashboard endpoint.
7. Hydrate Redis and reread. Waiting requests briefly poll with bounded retries.
8. Pre-check visible balance to fail early when obviously insufficient.
9. Run the business handler.
10. For an unsuccessful response, do not deduct.
11. In shadow mode, calculate and emit a shadow event without changing counters.
12. In enforce mode, run the atomic deduction script.
13. Map deduction errors to 402/503 and emit metrics.

Important limitation: business side effects may already have happened when a post-success deduction loses a race. For operations where that is unacceptable, implement a future reservation/commit protocol. Do not claim the initial post-success design gives transactional atomicity across Redis and the product database/blockchain.

## 13. Cost catalog extraction

Do not treat the ADR's sample catalog as complete.

For KYC/Cavach:

1. Enumerate every controller using `VerifyCreditAvailabilityGuard`, `ReduceCreditGuard`, and credit decorators.
2. Extract every `ACCESS_CREDITS` value.
3. Extract dynamic compliance pricing.
4. Record method, normalized route template, action key, amount, and bypass rules.
5. Add a test proving every decorated billable controller resolves to exactly one catalog entry.

For SSI:

1. Extract `getApiDetail()` route behavior.
2. Extract `CREDIT_COSTS.API`, `CREDIT_COSTS.STORAGE`, and `CREDIT_COSTS.ATTESTATION`.
3. Preserve cases where one request combines API, storage, credit, and HID costs.
4. Add table-driven tests for all route/body/query combinations.

Use explicit `@Billable()` metadata for ambiguous routes. Route inference is a compatibility mechanism, not the preferred long-term design.

## 14. Worker implementation

Run the worker as a separately deployable process/pod using the dashboard codebase. Do not run multiple uncoordinated timer loops inside every dashboard API replica.

### Safe delta claim

For each delta key:

1. Generate `batchId`.
2. Use Lua to atomically rename the current delta key to its inflight key only if it exists.
3. New request deductions immediately create a fresh delta key.
4. Read the claimed inflight hash.
5. Apply MongoDB update using a durable batch idempotency record.
6. On MongoDB success, delete the inflight key.
7. On MongoDB failure, leave it for retry.

Never use `HGET` followed by `DEL` before MongoDB success.

### Durable batch idempotency

Create a small sync-batch collection or usage-event collection with a unique `batchId`. Apply each batch at most once. A worker retry must detect an already-applied batch and safely delete the leftover inflight key.

### MongoDB update

Use an update filtered by plan ID and validate the result:

```ts
{
  $inc: {
    usedCredits: usedCreditsDelta,
    'onChainAllowance.usedAmount': onChainDelta,
    version: 1,
  }
}
```

Do not allow counters to exceed plan limits silently. If Redis and MongoDB disagree, record a reconciliation incident rather than truncating data.

### After each batch

1. Reload the plan.
2. Evaluate usage and expiry notification thresholds.
3. If exhausted/expired, run rollover under a distributed lock.
4. Persist the usage event or analytics record.
5. Update worker lag, success, failure, and pending-delta metrics.

### Stream processing

Use a Redis consumer group. Acknowledge an event only after durable processing. Reclaim stale pending entries. Apply retention only after confirming the durable event sink is complete.

## 15. Notifications

Move credit notification decisions to the dashboard worker.

Rules:

- Usage thresholds compare `usedCredits / totalCredits`.
- Expiry thresholds compare current UTC time with `expiresAt`.
- Exhaustion fires once per plan.
- Update notification state atomically before or together with queueing through an outbox pattern where possible.
- Queue jobs contain `serviceId`, plan ID, balance, threshold, and event time.
- A retry must not send the same threshold email twice.

Reuse the existing dashboard mail queues and templates after adapting their inputs to the central schema.

## 16. Migration scripts

Migration must be read-only against source databases and idempotent against the dashboard database.

### KYC transform

```ts
{
  serviceId: legacy.serviceId,
  totalCredits: Number(legacy.totalCredits),
  usedCredits: Number(legacy.used || 0),
  validityDays: Number(legacy.validityDuration),
  expiresAt: legacy.expiresAt,
  status: legacy.status,
  creditedBy: legacy.creditedBy,
  notification: normalizeNotification(legacy.notification),
  source: 'MIGRATION',
  migrationSource: 'KYC_SERVICE',
  legacyCreditId: String(legacy._id),
  version: 1,
}
```

Do not migrate `creditDenom`; off-chain units have no denomination centrally.

### SSI transform

```ts
{
  serviceId: legacy.serviceId,
  totalCredits: Number(legacy.totalCredits),
  usedCredits: Number(legacy.used || 0),
  validityDays: Number(legacy.validityDuration),
  expiresAt: legacy.expiresAt,
  status: legacy.status,
  onChainAllowance: legacy.credit
    ? {
        amount: Number(legacy.credit.amount),
        denom: String(legacy.credit.denom).toLowerCase(),
        usedAmount: Number(legacy.credit.used || 0),
      }
    : undefined,
  onChainAllowanceScopes: legacy.creditScope || [],
  creditedBy: legacy.creditedBy,
  source: 'MIGRATION',
  migrationSource: 'SSI_SERVICE',
  legacyCreditId: String(legacy._id),
  version: 1,
}
```

### Migration execution order

1. Export immutable source snapshots with checksums and timestamps.
2. Produce a dry-run report: total plans, active plans, invalid values, duplicate legacy IDs, duplicate active plans, exhausted plans, and expired plans.
3. Stop and resolve invalid/duplicate active data.
4. Insert with upsert on `{migrationSource, legacyCreditId}`.
5. Compare source and destination counts and total/used sums per service.
6. Hydrate active plans best-effort.
7. Run record-level reconciliation.
8. Store the report and source export securely for audit.

Do not normalize incorrect balances silently. Put invalid records in an exception report for an explicit decision.

## 17. Shadow mode

Start with KYC/Cavach because its model lacks SSI chain allowance complexity.

In shadow mode:

- Existing local guards remain authoritative.
- Shared middleware resolves costs and reads/hydrates central state.
- It emits predicted usage events.
- It does not block and does not mutate central active/delta counters.

Reconcile by `requestId`, route/action, and service ID. Compare:

- Request count
- Cost per request
- Local `used` increase
- Predicted central usage
- Expired/exhausted decisions
- Rollover selection

Do not cut over until unexplained differences are zero for the agreed observation window.

## 18. Enforcement cutover

For each service independently:

1. Freeze credit-plan mutations through the local product API.
2. Run a final incremental migration/reconciliation.
3. Hydrate every active service plan best-effort.
4. Enable shared middleware `ENFORCE` mode.
5. Disable the old local verification/deduction hot path.
6. Leave old data and read-only diagnostic endpoints available to operators.
7. Monitor errors, deduction latency, Redis misses, worker lag, and reconciliation.
8. Keep a feature flag allowing controlled rollback to local enforcement during the cutover window.

Cut over KYC first, stabilize, then SSI.

## 19. Cleanup

Only after both services are stable:

1. Remove downstream `/api/v1/credit` calls from the dashboard.
2. Remove KYC local credit controllers, guards, services, repositories, schemas, and module imports.
3. Remove SSI local credit controllers, guards, services, repositories, schemas, and module imports.
4. Remove obsolete JWT credit-token code and secrets.
5. Remove obsolete credit DB connections and indexes from product services.
6. Preserve database exports according to audit retention policy.
7. Update API documentation, operational runbooks, and architecture diagrams.

## 20. Testing requirements

### Dashboard unit tests

- Validity conversion for every unit
- First plan becomes active with expiry
- Subsequent plan becomes inactive without expiry
- Concurrent creation leaves one active plan
- Activation deactivates the previous plan
- Exhausted/expired plan cannot activate
- Oldest usable plan rollover
- SSI allowance validation
- Redis hydration serialization
- Authenticated internal endpoint
- Notification deduplication

### Redis/Lua tests

- Successful off-chain deduction
- Successful combined off-chain/HID deduction
- Insufficient off-chain balance changes nothing
- Insufficient HID balance changes nothing
- Missing active key
- Expired plan
- Plan/version mismatch
- Same request ID deducts once
- Same request ID with another fingerprint is rejected
- Concurrent requests never exceed balance
- Delta and usage event match active-counter increments

### Worker integration tests

- Safe claim while new deductions arrive
- Mongo failure retains inflight batch
- Retry applies batch once
- Worker crash after Mongo success does not double-apply
- Rollover hydrates the correct next plan
- No-next-plan deletes active cache
- Stream reclaim and acknowledgement

### Product middleware tests

- Non-billable route bypass
- Correct route/action costs
- Dynamic KYC compliance costs
- Combined SSI API/storage/HID costs
- Cold-cache hydration
- Dashboard unavailable fails closed
- Shadow mode never blocks/deducts
- Failed handler does not deduct
- Successful handler deducts once

### Migration tests

- KYC and SSI field mapping
- String-to-integer normalization
- Idempotent rerun
- Duplicate-active reporting
- Count and amount reconciliation
- Invalid record exception reporting

### End-to-end tests

- Manual recharge to successful paid request to worker sync
- Customer onboarding creates SSI and KYC plans
- Initial free Cavach credit
- Exhaustion and automatic rollover
- Cache loss followed by lazy hydration
- Retried request ID does not double-charge

## 21. Observability and alerts

Add structured logs and metrics for:

- Plan creation/activation/rollover
- Redis hydration success/failure/latency
- Deduction result and latency, without sensitive payloads
- Idempotency hits/conflicts
- Redis misses
- Usage stream lag
- Pending and inflight delta counts
- Worker batch success/failure/retry
- Mongo/Redis balance divergence
- No-active-plan and insufficient-balance responses
- SSI grant transaction failures

Alert on:

- Worker lag over the agreed threshold
- Old inflight keys
- Repeated hydration failures
- Redis memory/persistence/replication problems
- Mongo/Redis divergence
- Multiple-active-plan index violations
- Usage stream growth without acknowledgements

## 22. Deployment prerequisites

Before enforcement:

- Redis persistence is enabled appropriately (AOF is recommended for runtime deductions).
- Redis eviction policy cannot evict credit keys unexpectedly, or eviction is detected and safely hydrated.
- Redis is replicated/backed up according to the required recovery point.
- Dashboard internal endpoint is private and authenticated.
- Worker has a separate deployment and health check.
- Secrets are available to both product services.
- Network policies allow product services to reach Redis and the internal dashboard endpoint.
- MongoDB transactions are supported by the deployment topology.
- Feature flags exist for shadow/enforce/bypass and are auditable.

## 23. Pull request sequence

Use small, reviewable PRs in this order:

1. Dashboard schema, indexes, repository, DTOs, and unit tests.
2. Dashboard plan service and activation/list/balance APIs.
3. Dashboard Redis service and internal hydration endpoint.
4. Redirect manual recharge and initial Cavach provisioning.
5. Redirect customer onboarding and add provisioning idempotency.
6. Shared package skeleton and complete KYC cost catalog.
7. Shared Redis Lua deduction and middleware tests.
8. Dashboard worker, durable batches, usage events, and notifications.
9. KYC and SSI migration/reconciliation scripts.
10. KYC shadow integration.
11. KYC enforcement cutover.
12. Complete SSI cost/allowance middleware integration.
13. SSI shadow integration.
14. SSI enforcement cutover.
15. Product-local credit-module cleanup.

## 24. Definition of done

The project is complete only when:

- All new/recharged/onboarded plans are stored in dashboard MongoDB.
- Neither product service mutates a local credit-plan collection.
- Every paid API is represented in the tested shared catalog or explicit decorator metadata.
- Redis deductions are atomic and idempotent.
- Worker batches cannot be lost or double-applied.
- MongoDB converges to Redis runtime usage within the worker SLA.
- KYC and SSI migrations reconcile by record count and amounts.
- Shadow-mode differences are resolved before each cutover.
- Internal APIs are authenticated and not publicly exposed.
- Alerts and operational recovery procedures are tested.
- Old product-local data remains archived for audit.

## 25. Immediate first task

Begin with PR 1 only:

1. Create the dashboard `credit-management` module.
2. Add the central schema and indexes.
3. Add create/list/find-active repository methods.
4. Add strict DTO validation and validity conversion.
5. Add schema/repository/service unit tests.
6. Do not modify KYC or SSI enforcement yet.
7. Do not remove the existing dashboard `credits` module yet.

Completing this first task establishes the durable model without changing production charging behavior.
