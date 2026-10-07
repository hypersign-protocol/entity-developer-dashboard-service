import { CreditRepository } from '../repositories/credit.repository';
import { CreditPlan, CreditStatus } from '../schemas/credit.schema';
import { CreditNotificationService } from './credit-notification.service';

describe('CreditNotificationService', () => {
  let creditRepository: jest.Mocked<CreditRepository>;
  let mailNotificationService: { addAJob: jest.Mock };
  let service: CreditNotificationService;

  beforeEach(() => {
    creditRepository = {
      findCreditDetailList: jest.fn(),
      findOneAndUpdate: jest.fn(),
    } as unknown as jest.Mocked<CreditRepository>;
    mailNotificationService = { addAJob: jest.fn() };

    service = new CreditNotificationService(
      creditRepository,
      {
        findOne: jest.fn().mockResolvedValue({ services: [] }),
        findAppsByPipeline: jest
          .fn()
          .mockResolvedValue([{ adminEmail: 'admin@example.com' }]),
      } as never,
      {} as never,
      mailNotificationService as never,
      {
        get: jest.fn((key: string) =>
          key === 'CREDIT_EXPIRY_THRESHOLDS' ? '30,7,0' : '',
        ),
      } as never,
      {} as never,
    );
  });

  it('does not send the 30-day reminder for a one-month plan', async () => {
    creditRepository.findCreditDetailList.mockResolvedValue([
      plan({ validityDays: 31 }),
    ] as never);

    await service.scanExpiringCredits();

    expect(creditRepository.findOneAndUpdate).not.toHaveBeenCalled();
    expect(mailNotificationService.addAJob).not.toHaveBeenCalled();
  });

  it('still sends the 30-day reminder for plans longer than one month', async () => {
    creditRepository.findCreditDetailList.mockResolvedValue([
      plan({ validityDays: 60 }),
    ] as never);
    creditRepository.findOneAndUpdate.mockResolvedValue({} as never);

    await service.scanExpiringCredits();

    expect(creditRepository.findOneAndUpdate).toHaveBeenCalledWith(
      expect.any(Object),
      { $set: { 'notification.expiryThresholdsSent': 30 } },
    );
    expect(mailNotificationService.addAJob).toHaveBeenCalledTimes(1);
  });
});

function plan(overrides: Partial<CreditPlan>): CreditPlan {
  return {
    _id: 'credit-1',
    serviceId: 'service-1',
    serviceType: 'CAVACH_API' as never,
    referenceId: 'reference-1',
    apiCredit: { total: 100, used: 0 },
    validityDays: 31,
    criticalBalance: 40,
    expiresAt: new Date(Date.now() + 29 * 24 * 60 * 60 * 1_000),
    status: CreditStatus.ACTIVE,
    ...overrides,
  } as CreditPlan;
}
