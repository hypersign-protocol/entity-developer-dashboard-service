import { CreditRepository } from '../repositories/credit.repository';
import { CreditService } from './credits.service';
import { CreditEventStore } from './credit-event-store.service';
import { CreditNotificationService } from './credit-notification.service';
import { CreditCommitEventRepository } from '../repositories/credit-commit-event.repository';
import { SERVICE_TYPES } from 'src/supported-service/services/iServiceList';
import {
  CreditEnvironment,
  CreditType,
} from '@hypersign-protocol/credit-middleware';

describe('CreditEventStore', () => {
  let repository: jest.Mocked<CreditRepository>;
  let creditService: jest.Mocked<CreditService>;
  let creditNotificationService: jest.Mocked<CreditNotificationService>;
  let commitEventRepository: jest.Mocked<CreditCommitEventRepository>;
  let store: CreditEventStore;

  beforeEach(() => {
    repository = {
      applyPlanCreditCommit: jest.fn(),
      hasProcessedCommit: jest.fn(),
      findOneAndUpdate: jest.fn(),
      findParticularCreditDetail: jest.fn(),
      findActiveCreditForService: jest.fn(),
    } as unknown as jest.Mocked<CreditRepository>;
    creditService = {
      activateCredit: jest.fn(),
    } as unknown as jest.Mocked<CreditService>;
    creditNotificationService = {
      notifyUsageThreshold: jest.fn(),
    } as unknown as jest.Mocked<CreditNotificationService>;
    commitEventRepository = {
      create: jest.fn(),
    } as unknown as jest.Mocked<CreditCommitEventRepository>;
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
    );
    expect(creditNotificationService.notifyUsageThreshold).toHaveBeenCalled();
    expect(commitEventRepository.create).toHaveBeenCalledWith(
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
    );
    expect(
      creditNotificationService.notifyUsageThreshold,
    ).not.toHaveBeenCalled();
    expect(commitEventRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        planId: 'ssi-plan-1.BLOCKCHAIN_TXN_CREDIT',
        metadata: expect.objectContaining({
          serviceType: SERVICE_TYPES.SSI_API,
          creditType: CreditType.BLOCKCHAIN_TXN_CREDIT,
        }),
      }),
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
    );
    expect(repository.applyPlanCreditCommit).toHaveBeenNthCalledWith(
      2,
      'ssi-app-1',
      'plan-2',
      3000,
      '1787726078880-2',
      CreditType.BLOCKCHAIN_TXN_CREDIT,
      SERVICE_TYPES.SSI_API,
    );
  });

  it('acknowledges a retried event that was already committed', async () => {
    repository.applyPlanCreditCommit.mockResolvedValue(null);
    repository.hasProcessedCommit.mockResolvedValue(true);

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
      ),
    ).resolves.toBeUndefined();
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

  it('ignores observed events without storing analytics', async () => {
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
    expect(commitEventRepository.create).not.toHaveBeenCalled();
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
