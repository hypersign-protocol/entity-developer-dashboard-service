import { SERVICE_TYPES } from '../../supported-service/services/iServiceList';
import { CreditStatus } from '../schemas/credit.schema';
import { CreditRepository } from './credit.repository';

describe('CreditRepository SSI activation', () => {
  it('preserves the latest allowance and derives status from current usage', async () => {
    const exec = jest.fn().mockResolvedValue({});
    const lean = jest.fn().mockReturnValue({ exec });
    const findOneAndUpdate = jest.fn().mockReturnValue({ lean });
    const repository = new CreditRepository({ findOneAndUpdate } as any);
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
    const repository = new CreditRepository({ findOneAndUpdate } as any);

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
