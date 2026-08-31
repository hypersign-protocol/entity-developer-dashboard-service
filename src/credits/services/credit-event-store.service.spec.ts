import { CreditRepository } from '../repositories/credit.repository';
import { CreditService } from './credits.service';
import { CreditEventStore } from './credit-event-store.service';
import { CreditNotificationService } from './credit-notification.service';
import { CreditLedgerRepository } from '../repositories/credit-ledger.repository';
import { SERVICE_TYPES } from 'src/supported-service/services/iServiceList';
import {
  CreditEnvironment,
  CreditType,
} from '@hypersign-protocol/credit-middleware';

describe('CreditEventStore', () => {
  let repository: jest.Mocked<CreditRepository>;
  let creditService: jest.Mocked<CreditService>;
  let creditNotificationService: jest.Mocked<CreditNotificationService>;
  let commitEventRepository: jest.Mocked<CreditLedgerRepository>;
  let store: CreditEventStore;

  beforeEach(() => {
    repository = {
      initializeCommitPersistence: jest.fn(),
      applyPlanCreditCommit: jest.fn(),
      hasProcessedCommit: jest.fn(),
      claimCommitLedgerWrite: jest.fn().mockResolvedValue('ledger-lease-1'),
      markCommitLedgerWritten: jest.fn(),
      releaseCommitLedgerWrite: jest.fn(),
      findOneAndUpdate: jest.fn(),
      findParticularCreditDetail: jest.fn(),
      findActiveCreditForService: jest.fn(),
    } as unknown as jest.Mocked<CreditRepository>;
    creditService = {
      activateCredit: jest.fn(),
    } as unknown as jest.Mocked<CreditService>;
    creditNotificationService = {
      notifyUsageThreshold: jest.fn(),
      notifyAllowanceUsageThreshold: jest.fn(),
    } as unknown as jest.Mocked<CreditNotificationService>;
    commitEventRepository = {
      create: jest.fn(),
      exists: jest.fn().mockResolvedValue(false),
    } as unknown as jest.Mocked<CreditLedgerRepository>;
    store = new CreditEventStore(
      repository,
      creditService,
      creditNotificationService,
      commitEventRepository,
    );
  });

  it('applies a middleware committed event to the active app credit', async () => {
    repository.applyPlanCreditCommit.mockResolvedValue({} as never);

    await store.append(
      job('credit.committed', {
        eventId: 'event-1',
        schemaVersion: 3,
        catalogVersion: '2026-08-14',
        serviceType: SERVICE_TYPES.CAVACH_API,
        event: {
          type: 'COMMITTED',
          appId: 'app-1',
          planId: 'plan-1',
          amount: 2,
          reservationId: 'reservation-1',
          timestamp: 1787287938626,
          tenantId: 'tenant-1',
          appType: SERVICE_TYPES.CAVACH_API,
          creditType: 'API_CREDIT',
          operation: 'POST /api/v1/e-kyc/verification/session',
          totalAmount: 2,
          allocationIndex: 0,
          allocationCount: 1,
          planBalanceAfter: 8,
          balanceAfter: 8,
        },
      }),
    );

    expect(repository.applyPlanCreditCommit).toHaveBeenCalledWith(
      'app-1',
      'plan-1',
      2,
      'event-1',
      CreditType.API_CREDIT,
      SERVICE_TYPES.CAVACH_API,
      expect.objectContaining({
        eventId: 'event-1',
        timestamp: new Date(1787287938626),
        metadata: expect.objectContaining({
          tenantId: 'tenant-1',
          serviceId: 'app-1',
        }),
        operation: 'POST /api/v1/e-kyc/verification/session',
      }),
    );
    expect(creditNotificationService.notifyUsageThreshold).toHaveBeenCalled();
    expect(commitEventRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 'event-1' }),
    );
    expect(repository.markCommitLedgerWritten).toHaveBeenCalledWith(
      'event-1',
      'ledger-lease-1',
    );
    expect(
      repository.applyPlanCreditCommit.mock.calls[0][6],
    ).not.toHaveProperty('payload');
  });

  it('maps an SSI blockchain wallet commit to its SSI dashboard plan', async () => {
    repository.applyPlanCreditCommit.mockResolvedValue({} as never);

    await store.append(
      job('credit.committed', {
        eventId: 'ssi-event-1',
        schemaVersion: 3,
        catalogVersion: '3.7.2',
        serviceType: SERVICE_TYPES.SSI_API,
        event: {
          type: 'COMMITTED',
          appId: 'ssi-app-1',
          planId: 'ssi-plan-1.BLOCKCHAIN_TXN_CREDIT',
          amount: 50,
          reservationId: 'ssi-reservation-1',
          timestamp: 1787287938626,
          tenantId: 'tenant-ssi',
          appType: SERVICE_TYPES.SSI_API,
          creditType: CreditType.BLOCKCHAIN_TXN_CREDIT,
          operation: 'POST /api/v1/did/register',
          totalAmount: 50,
          allocationIndex: 0,
          allocationCount: 1,
          planBalanceAfter: 450,
          balanceAfter: 450,
        },
      }),
    );

    expect(repository.applyPlanCreditCommit).toHaveBeenCalledWith(
      'ssi-app-1',
      'ssi-plan-1',
      50,
      'ssi-event-1',
      CreditType.BLOCKCHAIN_TXN_CREDIT,
      SERVICE_TYPES.SSI_API,
      expect.objectContaining({
        planId: 'ssi-plan-1',
        metadata: expect.objectContaining({
          serviceType: SERVICE_TYPES.SSI_API,
          creditType: CreditType.BLOCKCHAIN_TXN_CREDIT,
        }),
      }),
    );
    expect(
      creditNotificationService.notifyUsageThreshold,
    ).not.toHaveBeenCalled();
    expect(
      creditNotificationService.notifyAllowanceUsageThreshold,
    ).toHaveBeenCalled();
    expect(commitEventRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 'ssi-event-1' }),
    );
  });

  it('applies every allocation from one SSI reservation to its own dashboard plan', async () => {
    repository.applyPlanCreditCommit.mockResolvedValue({} as never);
    const baseEvent = {
      type: 'COMMITTED',
      appId: 'ssi-app-1',
      timestamp: 1787726078879,
      tenantId: 'tenant-ssi',
      appType: SERVICE_TYPES.SSI_API,
      creditType: CreditType.BLOCKCHAIN_TXN_CREDIT,
      operation: 'POST /api/v1/did/register',
      reservationId: 'reservation-spanning-plans',
      totalAmount: 4000,
      allocationCount: 2,
      balanceAfter: 0,
    };

    await store.append(
      job('credit.committed', {
        eventId: '1787726078880-0',
        schemaVersion: 3,
        catalogVersion: '3.7.2',
        serviceType: SERVICE_TYPES.SSI_API,
        event: {
          ...baseEvent,
          planId: 'plan-1.BLOCKCHAIN_TXN_CREDIT',
          amount: 1000,
          allocationIndex: 0,
          planBalanceAfter: 0,
        },
      }),
    );
    await store.append(
      job('credit.committed', {
        eventId: '1787726078880-2',
        schemaVersion: 3,
        catalogVersion: '3.7.2',
        serviceType: SERVICE_TYPES.SSI_API,
        event: {
          ...baseEvent,
          planId: 'plan-2.BLOCKCHAIN_TXN_CREDIT',
          amount: 3000,
          allocationIndex: 1,
          planBalanceAfter: 0,
        },
      }),
    );

    expect(repository.applyPlanCreditCommit).toHaveBeenNthCalledWith(
      1,
      'ssi-app-1',
      'plan-1',
      1000,
      '1787726078880-0',
      CreditType.BLOCKCHAIN_TXN_CREDIT,
      SERVICE_TYPES.SSI_API,
      expect.objectContaining({ eventId: '1787726078880-0' }),
    );
    expect(repository.applyPlanCreditCommit).toHaveBeenNthCalledWith(
      2,
      'ssi-app-1',
      'plan-2',
      3000,
      '1787726078880-2',
      CreditType.BLOCKCHAIN_TXN_CREDIT,
      SERVICE_TYPES.SSI_API,
      expect.objectContaining({ eventId: '1787726078880-2' }),
    );
  });

  it('acknowledges a retried event that was already committed', async () => {
    repository.applyPlanCreditCommit.mockResolvedValue(null);
    repository.hasProcessedCommit.mockResolvedValue(true);

    await expect(store.append(committedJob())).resolves.toBeUndefined();

    expect(commitEventRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 'event-1' }),
    );
    expect(
      creditNotificationService.notifyUsageThreshold,
    ).not.toHaveBeenCalled();
  });

  it('releases the ledger lease when a time-series append fails', async () => {
    const ledgerError = new Error('temporary ledger failure');
    repository.applyPlanCreditCommit.mockResolvedValue({} as never);
    commitEventRepository.create.mockRejectedValue(ledgerError);

    await expect(store.append(committedJob())).rejects.toThrow(
      'temporary ledger failure',
    );

    expect(repository.releaseCommitLedgerWrite).toHaveBeenCalledWith(
      'event-1',
      'ledger-lease-1',
      ledgerError,
    );
  });

  it('finishes the outbox when the ledger write succeeded before a retry', async () => {
    commitEventRepository.exists.mockResolvedValue(true);

    await expect(store.append(committedJob())).resolves.toBeUndefined();

    expect(repository.applyPlanCreditCommit).not.toHaveBeenCalled();
    expect(commitEventRepository.create).not.toHaveBeenCalled();
    expect(repository.markCommitLedgerWritten).toHaveBeenCalledWith('event-1');
  });

  it('rejects malformed committed lifecycle events', async () => {
    await expect(
      store.append(
        job('credit.committed', {
          eventId: 'event-1',
          schemaVersion: 3,
          catalogVersion: '2026-08-14',
          serviceType: SERVICE_TYPES.CAVACH_API,
          event: {
            type: 'COMMITTED',
            environment: 'PROD',
            appId: 'app-1',
            planId: 'plan-1',
            amount: 0,
            reservationId: 'reservation-1',
          },
        }),
      ),
    ).rejects.toThrow('Invalid committed credit lifecycle event');
  });

  it('rejects commits that cannot be represented in analytics before applying them', async () => {
    await expect(
      store.append(
        job('credit.committed', {
          eventId: 'event-1',
          schemaVersion: 3,
          catalogVersion: '2026-08-14',
          serviceType: SERVICE_TYPES.CAVACH_API,
          event: {
            type: 'COMMITTED',
            appId: 'app-1',
            planId: 'plan-1',
            amount: 2,
            reservationId: 'reservation-1',
          },
        }),
      ),
    ).rejects.toThrow('Invalid committed credit analytics data');

    expect(repository.applyPlanCreditCommit).not.toHaveBeenCalled();
  });

  it('marks the database plan inactive when the plan expired', async () => {
    await store.append(lifecycleJob('credit.plan-expired', 'PLAN_EXPIRED'));

    expect(repository.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'plan-1', serviceId: 'app-1', status: 'Active' },
      { $set: { status: 'Inactive' } },
    );
    expect(commitEventRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'PLAN_EXPIRED', planId: 'plan-1' }),
    );
  });

  it('activates the database plan with the middleware grant expiry', async () => {
    const expiresAt = Date.now() + 60_000;

    await store.append(
      job('credit.granted', {
        eventId: 'event-1',
        schemaVersion: 3,
        catalogVersion: '2026-08-14',
        serviceType: SERVICE_TYPES.CAVACH_API,
        event: {
          type: 'CREDIT_GRANTED',
          appId: 'app-1',
          planId: 'plan-1',
          expiresAt,
        },
      }),
    );

    expect(repository.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'plan-1', serviceId: 'app-1', status: 'Inactive' },
      { $set: { status: 'Active', expiresAt: new Date(expiresAt) } },
    );
    expect(commitEventRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'CREDIT_GRANTED',
        planId: 'plan-1',
      }),
    );
  });

  it('activates one valid inactive replacement after a critical balance event', async () => {
    repository.findParticularCreditDetail.mockResolvedValue({
      _id: 'plan-2',
    } as never);

    await store.append(
      lifecycleJob('credit.critical-balance', 'CRITICAL_BALANCE'),
    );

    expect(repository.findParticularCreditDetail).toHaveBeenCalledWith({
      serviceId: 'app-1',
      status: 'Inactive',
      expiresAt: { $exists: false },
    });
    expect(creditService.activateCredit).toHaveBeenCalledWith(
      'plan-2',
      'app-1',
    );
    expect(commitEventRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'CRITICAL_BALANCE',
        planId: 'plan-1',
      }),
    );
  });

  it('accepts DEV observations without applying a financial commit', async () => {
    await store.append(
      job('credit.observed', {
        eventId: 'event-dev-1',
        schemaVersion: 3,
        catalogVersion: '2026-08-14',
        serviceType: SERVICE_TYPES.CAVACH_API,
        event: {
          type: 'CREDIT_OBSERVED',
          appId: 'app-1',
          requestId: 'request-dev-1:api',
          requestedAmount: 2,
          deductedAmount: 0,
          environment: CreditEnvironment.DEV,
          billingMode: 'OBSERVE',
        },
      }),
    );

    expect(repository.applyPlanCreditCommit).not.toHaveBeenCalled();
    expect(repository.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it.each([
    ['credit.reserved', 'RESERVED'],
    ['credit.rolled-back', 'ROLLED_BACK'],
    ['credit.expired', 'EXPIRED'],
  ])('stores %s lifecycle events', async (name, type) => {
    await store.append(
      job(name, {
        eventId: `event-${type}`,
        schemaVersion: 3,
        catalogVersion: '2026-08-14',
        serviceType: SERVICE_TYPES.CAVACH_API,
        event: {
          type,
          timestamp: 1787287938626,
          appId: 'app-1',
          tenantId: 'tenant-1',
          appType: SERVICE_TYPES.CAVACH_API,
          creditType: CreditType.API_CREDIT,
          planId: 'plan-1',
          reservationId: 'reservation-1',
          amount: 2,
        },
      }),
    );

    expect(commitEventRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: `event-${type}`,
        eventType: type,
        reservationId: 'reservation-1',
      }),
    );
  });

  it('skips an event already present in time-series history', async () => {
    commitEventRepository.exists.mockResolvedValue(true);

    await store.append(lifecycleJob('credit.plan-expired', 'PLAN_EXPIRED'));

    expect(repository.findOneAndUpdate).not.toHaveBeenCalled();
    expect(commitEventRepository.create).not.toHaveBeenCalled();
  });

  it('stores rejected commands with a service-scoped event id', async () => {
    await store.append(
      job('credit.command-rejected', {
        schemaVersion: 3,
        serviceType: SERVICE_TYPES.SSI_API,
        commandId: 'command-1',
        commandName: 'credit.grant-requested',
        reason: 'invalid grant',
        timestamp: 1787287938626,
      }),
    );

    expect(commitEventRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: 'SSI_API:command-1:rejected',
        eventType: 'credit.command-rejected',
        timestamp: new Date(1787287938626),
      }),
    );
  });

  it('rejects an observation that claims a deduction', async () => {
    await expect(
      store.append(
        job('credit.observed', {
          eventId: 'event-dev-1',
          schemaVersion: 3,
          catalogVersion: '2026-08-14',
          serviceType: SERVICE_TYPES.CAVACH_API,
          event: {
            type: 'CREDIT_OBSERVED',
            appId: 'app-1',
            requestId: 'request-dev-1:api',
            requestedAmount: 2,
            deductedAmount: 1,
            environment: CreditEnvironment.DEV,
            billingMode: 'OBSERVE',
          },
        }),
      ),
    ).rejects.toThrow('Invalid observed credit lifecycle event');
  });

  it('does not activate another plan when an active replacement has balance', async () => {
    repository.findActiveCreditForService.mockResolvedValue({} as never);

    await store.append(
      lifecycleJob('credit.critical-balance', 'CRITICAL_BALANCE'),
    );

    expect(repository.findActiveCreditForService).toHaveBeenCalledWith(
      'app-1',
      'plan-1',
    );
    expect(repository.findParticularCreditDetail).not.toHaveBeenCalled();
    expect(creditService.activateCredit).not.toHaveBeenCalled();
  });

  it('does nothing when no inactive, unactivated replacement exists', async () => {
    repository.findParticularCreditDetail.mockResolvedValue(null);

    await store.append(
      lifecycleJob('credit.critical-balance', 'CRITICAL_BALANCE'),
    );

    expect(creditService.activateCredit).not.toHaveBeenCalled();
  });

  it('stores observed events without applying a financial commit', async () => {
    await store.append(
      job('credit.observed', {
        eventId: 'event-dev-1',
        schemaVersion: 3,
        catalogVersion: '2026-08-14',
        serviceType: SERVICE_TYPES.CAVACH_API,
        event: {
          type: 'CREDIT_OBSERVED',
          appId: 'app-1',
          tenantId: 'tenant-1',
          appType: 'KYC_SERVICE',
          creditType: 'API_CREDIT',
          timestamp: 1787287938626,
          operation: 'POST /api/v1/e-kyc/verification/session',
          requestId: 'request-dev-1:api',
          environment: CreditEnvironment.DEV,
          billingMode: 'OBSERVE',
          requestedAmount: 2,
          deductedAmount: 0,
        },
      }),
    );

    expect(repository.applyPlanCreditCommit).not.toHaveBeenCalled();
    expect(commitEventRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: 'event-dev-1',
        eventType: 'CREDIT_OBSERVED',
      }),
    );
  });
});

function job(name: string, data: unknown) {
  return { name, data };
}

function lifecycleJob(name: string, type: 'PLAN_EXPIRED' | 'CRITICAL_BALANCE') {
  return job(name, {
    eventId: 'event-1',
    schemaVersion: 3,
    catalogVersion: '2026-08-14',
    serviceType: SERVICE_TYPES.CAVACH_API,
    event: {
      type,
      appId: 'app-1',
      planId: 'plan-1',
    },
  });
}

function committedJob() {
  return job('credit.committed', {
    eventId: 'event-1',
    schemaVersion: 3,
    catalogVersion: '2026-08-14',
    serviceType: SERVICE_TYPES.CAVACH_API,
    event: {
      type: 'COMMITTED',
      environment: 'PROD',
      appId: 'app-1',
      planId: 'plan-1',
      amount: 2,
      reservationId: 'reservation-1',
      timestamp: 1787287938626,
      tenantId: 'tenant-1',
      appType: SERVICE_TYPES.CAVACH_API,
      creditType: 'API_CREDIT',
      operation: 'POST /api/v1/e-kyc/verification/session',
      totalAmount: 2,
      allocationIndex: 0,
      allocationCount: 1,
      planBalanceAfter: 8,
      balanceAfter: 8,
    },
  });
}
