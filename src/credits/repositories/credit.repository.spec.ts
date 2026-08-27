import { SERVICE_TYPES } from '../../supported-service/services/iServiceList';
import { CreditStatus } from '../schemas/credit.schema';
import { CreditRepository } from './credit.repository';

describe('CreditRepository SSI activation', () => {
  it('preserves the latest allowance and derives status from current usage', async () => {
    const exec = jest.fn().mockResolvedValue({});
    const lean = jest.fn().mockReturnValue({ exec });
    const findOneAndUpdate = jest.fn().mockReturnValue({ lean });
    const repository = new CreditRepository(
      { findOneAndUpdate } as any,
      {} as any,
    );
    const expiresAt = new Date('2026-10-25T00:00:00.000Z');

    await repository.activateSsiCreditPlan(
      'app-1',
      'plan-1',
      expiresAt,
      400,
      { amount: 1000, denom: 'uhid', usedAmount: 0 },
      [],
    );

    expect(findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'plan-1', serviceId: 'app-1' },
      [
        {
          $set: expect.objectContaining({
            serviceType: SERVICE_TYPES.SSI_API,
            expiresAt,
            criticalBalance: 400,
            onChainAllowance: {
              $ifNull: [
                '$onChainAllowance',
                { amount: 1000, denom: 'uhid', usedAmount: 0 },
              ],
            },
          }),
        },
        {
          $set: {
            status: {
              $cond: [
                {
                  $and: [
                    { $gt: ['$expiresAt', '$$NOW'] },
                    {
                      $lt: [
                        { $ifNull: ['$apiCredit.used', 0] },
                        { $ifNull: ['$apiCredit.total', 0] },
                      ],
                    },
                    {
                      $lt: [
                        { $ifNull: ['$onChainAllowance.usedAmount', 0] },
                        { $ifNull: ['$onChainAllowance.amount', 0] },
                      ],
                    },
                  ],
                },
                CreditStatus.ACTIVE,
                CreditStatus.INACTIVE,
              ],
            },
          },
        },
      ],
      { new: true },
    );
  });

  it('does not write an allowance snapshot when one is already persisted', async () => {
    const exec = jest.fn().mockResolvedValue({});
    const lean = jest.fn().mockReturnValue({ exec });
    const findOneAndUpdate = jest.fn().mockReturnValue({ lean });
    const repository = new CreditRepository(
      { findOneAndUpdate } as any,
      {} as any,
    );

    await repository.activateSsiCreditPlan(
      'app-1',
      'plan-1',
      new Date('2026-10-25T00:00:00.000Z'),
      400,
    );

    const pipeline = findOneAndUpdate.mock.calls[0][1];
    expect(pipeline[0].$set).not.toHaveProperty('onChainAllowance');
    expect(pipeline[0].$set).not.toHaveProperty('onChainAllowanceScopes');
  });
});

describe('CreditRepository commit idempotency', () => {
  const ledgerEvent = {
    timestamp: new Date('2026-08-27T00:00:00.000Z'),
    metadata: {
      serviceId: 'app-1',
      serviceType: SERVICE_TYPES.CAVACH_API,
    },
    eventType: 'COMMITTED',
    eventId: 'event-1',
    schemaVersion: 3 as const,
  };

  function setup(
    options: { duplicate?: boolean; updatedCredit?: unknown } = {},
  ) {
    const endSession = jest.fn();
    const session = {
      withTransaction: jest.fn(async (work: () => Promise<void>) => work()),
      endSession,
    };
    const exec = jest
      .fn()
      .mockResolvedValue(
        options.updatedCredit === undefined ? {} : options.updatedCredit,
      );
    const lean = jest.fn().mockReturnValue({ exec });
    const findOneAndUpdate = jest.fn().mockReturnValue({ lean });
    const creditModel = {
      db: { startSession: jest.fn().mockResolvedValue(session) },
      findOneAndUpdate,
    };
    const save = options.duplicate
      ? jest
          .fn()
          .mockRejectedValue(
            Object.assign(new Error('duplicate'), { code: 11000 }),
          )
      : jest.fn().mockResolvedValue({});
    const ledgerModel = jest.fn().mockImplementation(() => ({ save }));
    const repository = new CreditRepository(
      creditModel as any,
      ledgerModel as any,
    );
    return { repository, findOneAndUpdate, save, session, endSession };
  }

  it('atomically records the ledger event and increments the plan without an id array', async () => {
    const { repository, findOneAndUpdate, save, session, endSession } = setup();

    await expect(
      repository.applyPlanCreditCommit(
        'app-1',
        'plan-1',
        2,
        'event-1',
        'API_CREDIT',
        SERVICE_TYPES.CAVACH_API,
        ledgerEvent,
      ),
    ).resolves.toEqual({});

    expect(save).toHaveBeenCalledWith({ session });
    expect(findOneAndUpdate).toHaveBeenCalledWith(
      expect.not.objectContaining({
        processedCommitEventIds: expect.anything(),
      }),
      expect.any(Array),
      { new: true, session },
    );
    expect(JSON.stringify(findOneAndUpdate.mock.calls[0])).not.toContain(
      'processedCommitEventIds',
    );
    expect(endSession).toHaveBeenCalled();
  });

  it('does not increment credit when the ledger event already exists', async () => {
    const { repository, findOneAndUpdate, endSession } = setup({
      duplicate: true,
    });

    await expect(
      repository.applyPlanCreditCommit(
        'app-1',
        'plan-1',
        2,
        'event-1',
        'API_CREDIT',
        SERVICE_TYPES.CAVACH_API,
        ledgerEvent,
      ),
    ).resolves.toBeNull();

    expect(findOneAndUpdate).not.toHaveBeenCalled();
    expect(endSession).toHaveBeenCalled();
  });

  it('aborts the ledger transaction when the plan cannot accept the commit', async () => {
    const { repository, endSession } = setup({ updatedCredit: null });

    await expect(
      repository.applyPlanCreditCommit(
        'app-1',
        'plan-1',
        2,
        'event-1',
        'API_CREDIT',
        SERVICE_TYPES.CAVACH_API,
        ledgerEvent,
      ),
    ).rejects.toThrow('Credit commit exceeds the plan balance');
    expect(endSession).toHaveBeenCalled();
  });
});
