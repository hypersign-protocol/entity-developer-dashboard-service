import { CreditRepository } from '../repositories/credit.repository';
import { CreditEventStore } from './credit-event-store.service';

describe('CreditEventStore', () => {
  let repository: jest.Mocked<CreditRepository>;
  let store: CreditEventStore;

  beforeEach(() => {
    repository = {
      applyPlanCreditCommit: jest.fn(),
      hasProcessedCommit: jest.fn(),
    } as unknown as jest.Mocked<CreditRepository>;
    store = new CreditEventStore(repository);
  });

  it('applies a middleware committed event to the active app credit', async () => {
    repository.applyPlanCreditCommit.mockResolvedValue({} as never);

    await store.append(
      job('credit.committed', {
        eventId: 'event-1',
        schemaVersion: 2,
        catalogVersion: '2026-08-14',
        catalogId: 'KYC',
        event: {
          type: 'COMMITTED',
          appId: 'app-1',
          planId: 'plan-1',
          amount: 2,
          reservationId: 'reservation-1',
        },
      }),
    );

    expect(repository.applyPlanCreditCommit).toHaveBeenCalledWith(
      'app-1',
      'plan-1',
      2,
      'event-1',
    );
  });

  it('acknowledges a retried event that was already committed', async () => {
    repository.applyPlanCreditCommit.mockResolvedValue(null);
    repository.hasProcessedCommit.mockResolvedValue(true);

    await expect(
      store.append(
        job('credit.committed', {
          eventId: 'event-1',
          schemaVersion: 2,
          catalogVersion: '2026-08-14',
          catalogId: 'KYC',
          event: {
            type: 'COMMITTED',
            appId: 'app-1',
            planId: 'plan-1',
            amount: 2,
            reservationId: 'reservation-1',
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
          schemaVersion: 2,
          catalogVersion: '2026-08-14',
          catalogId: 'KYC',
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
});

function job(name: string, data: unknown) {
  return { name, data };
}
