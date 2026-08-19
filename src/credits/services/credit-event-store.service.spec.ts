import { CreditRepository } from '../repositories/credit.repository';
import { CreditService } from './credits.service';
import { CreditEventStore } from './credit-event-store.service';

describe('CreditEventStore', () => {
  let repository: jest.Mocked<CreditRepository>;
  let creditService: jest.Mocked<CreditService>;
  let store: CreditEventStore;

  beforeEach(() => {
    repository = {
      applyPlanCreditReservation: jest.fn(),
      releasePlanCreditReservation: jest.fn(),
      findOneAndUpdate: jest.fn(),
      findParticularCreditDetail: jest.fn(),
      findActiveCreditForService: jest.fn(),
    } as unknown as jest.Mocked<CreditRepository>;
    creditService = {
      activateCredit: jest.fn(),
    } as unknown as jest.Mocked<CreditService>;
    store = new CreditEventStore(repository, creditService);
  });

  it('applies a middleware reserved event to the app credit', async () => {
    repository.applyPlanCreditReservation.mockResolvedValue({} as never);

    await store.append(
      job('credit.reserved', {
        eventId: 'event-1',
        schemaVersion: 2,
        catalogVersion: '2026-08-14',
        catalogId: 'hypersign-kyc-api-pricing',
        event: {
          type: 'RESERVED',
          appId: 'app-1',
          planId: 'plan-1',
          amount: 2,
          reservationId: 'reservation-1',
        },
      }),
    );

    expect(repository.applyPlanCreditReservation).toHaveBeenCalledWith(
      'app-1',
      'plan-1',
      2,
    );
  });

  it.each(['ROLLED_BACK', 'EXPIRED'] as const)(
    'restores used credit when a reservation is %s',
    async (type) => {
      repository.releasePlanCreditReservation.mockResolvedValue({} as never);

      await store.append(
        job(`credit.${type.toLowerCase().replace('_', '-')}`, {
          eventId: 'event-2',
          schemaVersion: 2,
          catalogVersion: '2026-08-14',
          catalogId: 'hypersign-kyc-api-pricing',
          event: {
            type,
            appId: 'app-1',
            planId: 'plan-1',
            reservationId: 'reservation-1',
            restoredAmount: 2,
          },
        }),
      );

      expect(repository.releasePlanCreditReservation).toHaveBeenCalledWith(
        'app-1',
        'plan-1',
        2,
      );
    },
  );

  it('rejects malformed committed lifecycle events', async () => {
    await expect(
      store.append(
        job('credit.committed', {
          eventId: 'event-1',
          schemaVersion: 2,
          catalogVersion: '2026-08-14',
          catalogId: 'hypersign-kyc-api-pricing',
          event: {
            type: 'COMMITTED',
            appId: 'app-1',
            planId: 'plan-1',
            amount: 0,
            reservationId: 'reservation-1',
          },
        }),
      ),
    ).rejects.toThrow('Invalid committed credit lifecycle event');
  });

  it('marks the database plan inactive when the plan expired', async () => {
    await store.append(lifecycleJob('credit.plan-expired', 'PLAN_EXPIRED'));

    expect(repository.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'plan-1', serviceId: 'app-1', status: 'Active' },
      { $set: { status: 'Inactive' } },
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
});

function job(name: string, data: unknown) {
  return { name, data };
}

function lifecycleJob(name: string, type: 'PLAN_EXPIRED' | 'CRITICAL_BALANCE') {
  return job(name, {
    eventId: 'event-1',
    schemaVersion: 2,
    catalogVersion: '2026-08-14',
    catalogId: 'hypersign-kyc-api-pricing',
    event: {
      type,
      appId: 'app-1',
      planId: 'plan-1',
    },
  });
}
