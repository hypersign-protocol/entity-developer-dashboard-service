import { NotFoundException } from '@nestjs/common';
import { UserRole } from 'src/user/schema/user.schema';
import { CreditStatus } from '../schemas/credit.schema';
import { CreditService } from './credits.service';

describe('CreditService fetchCreditDetails', () => {
  const plans = [{ _id: 'plan-1', serviceId: 'app-1' }];
  const appRepository = { findOne: jest.fn() };
  const creditRepository = {
    findBasedOnAggregationPipeline: jest.fn(),
  };
  let service: CreditService;

  beforeEach(() => {
    jest.clearAllMocks();
    appRepository.findOne.mockResolvedValue({
      appId: 'app-1',
      userId: 'owner-1',
    });
    creditRepository.findBasedOnAggregationPipeline.mockResolvedValue(plans);
    service = new CreditService(
      {} as never,
      appRepository as never,
      creditRepository as never,
      {} as never,
      {} as never,
    );
  });

  it("returns the owner's own app plans", async () => {
    await expect(
      service.fetchCreditDetails('app-1', CreditStatus.ACTIVE, {
        userId: 'owner-1',
      }),
    ).resolves.toBe(plans);
    expect(
      creditRepository.findBasedOnAggregationPipeline.mock.calls[0][0][0],
    ).toEqual({
      $match: { serviceId: 'app-1', status: CreditStatus.ACTIVE },
    });
  });

  it("refuses another user's app without reading any plans", async () => {
    await expect(
      service.fetchCreditDetails('app-1', undefined, { userId: 'stranger' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(
      creditRepository.findBasedOnAggregationPipeline,
    ).not.toHaveBeenCalled();
  });

  it('answers an unknown app the same way as a not-owned one', async () => {
    appRepository.findOne.mockResolvedValue(null);
    await expect(
      service.fetchCreditDetails('missing', undefined, { userId: 'owner-1' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lets a super admin read any app', async () => {
    await expect(
      service.fetchCreditDetails('app-1', undefined, {
        userId: 'admin-1',
        role: UserRole.SUPER_ADMIN,
      }),
    ).resolves.toBe(plans);
    expect(appRepository.findOne).not.toHaveBeenCalled();
  });
});
