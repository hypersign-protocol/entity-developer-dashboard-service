import { BadRequestException } from '@nestjs/common';
import { TimeUnit } from 'src/customer-onboarding/constants/enum';
import { SERVICE_TYPES } from '../../supported-service/services/iServiceList';
import { CreditRepository } from '../repositories/credit.repository';
import {
  CreditPlan,
  CreditSourceEnum,
  CreditStatus,
} from '../schemas/credit.schema';
import { CreditCommandService } from './credit-command.service';
import { CreditService } from './credits.service';

describe('CreditService', () => {
  let repository: jest.Mocked<CreditRepository>;
  let commandService: jest.Mocked<CreditCommandService>;
  let appRepository: { findOne: jest.Mock };
  let service: CreditService;

  beforeEach(() => {
    repository = {
      findParticularCreditDetail: jest.fn(),
      findOneAndUpdate: jest.fn(),
      create: jest.fn(),
      findActiveCreditForService: jest.fn(),
    } as unknown as jest.Mocked<CreditRepository>;
    commandService = {
      grantCreditPlan: jest.fn(),
    } as unknown as jest.Mocked<CreditCommandService>;
    appRepository = {
      findOne: jest.fn().mockResolvedValue({
        appId: 'app-1',
        subdomain: 'tenant-1',
        services: [{ id: SERVICE_TYPES.CAVACH_API }],
      }),
    };
    service = new CreditService(
      {} as never,
      appRepository as never,
      repository,
      commandService,
      {} as never,
    );
  });

  it.each([
    [
      'an expired plan',
      plan({ expiresAt: new Date('2026-08-01T00:00:00.000Z') }),
      'Expired credit cannot be activated',
    ],
    [
      'an exhausted plan',
      plan({ apiCredit: { total: 100, used: 100 } }),
      'Fully used credit plan cannot be activated',
    ],
  ])(
    'rejects %s when activating a credit',
    async (_description, credit, errorMessage) => {
      repository.findParticularCreditDetail.mockResolvedValue(credit as never);

      await expect(
        service.activateCredit(credit._id as string, 'app-1'),
      ).rejects.toThrow(new BadRequestException([errorMessage]));
      expect(repository.findOneAndUpdate).not.toHaveBeenCalled();
      expect(commandService.grantCreditPlan).not.toHaveBeenCalled();
    },
  );

  it('queues a CAVACH grant without activating the selected plan locally', async () => {
    const credit = plan({ status: CreditStatus.INACTIVE });
    repository.findParticularCreditDetail.mockResolvedValue(credit as never);

    await service.activateCredit(credit._id as string, 'app-1');

    expect(repository.findOneAndUpdate).not.toHaveBeenCalled();
    expect(commandService.grantCreditPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: credit._id,
        status: CreditStatus.ACTIVE,
        expiresAt: credit.expiresAt,
      }),
      SERVICE_TYPES.CAVACH_API,
      'tenant-1',
    );
  });

  it('stores a first CAVACH credit with a stable expiry before publishing it', async () => {
    const createdCredit = plan({
      expiresAt: undefined,
      referenceId: 'payment-1',
      source: CreditSourceEnum.MANUAL_RECHARGE,
    });
    repository.create.mockResolvedValue(createdCredit as never);

    await service.grantCredit(
      'app-1',
      {
        amount: '100',
        validityPeriod: 30,
        validityPeriodUnit: TimeUnit.Days,
        amountDenom: 'uhid',
      },
      'admin-1',
      CreditSourceEnum.MANUAL_RECHARGE,
    );

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        status: CreditStatus.INACTIVE,
        validityDays: 30,
        criticalBalance: 40,
        referenceId: expect.any(String),
        expiresAt: expect.any(Date),
      }),
    );
    expect(commandService.grantCreditPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        status: CreditStatus.ACTIVE,
        expiresAt: expect.any(Date),
      }),
      SERVICE_TYPES.CAVACH_API,
      'tenant-1',
    );
  });

  it('creates an inactive credit without an expiry when the app already has an active usable credit', async () => {
    repository.findActiveCreditForService.mockResolvedValue(plan() as never);
    repository.create.mockResolvedValue(
      plan({
        referenceId: 'payment-2',
        source: CreditSourceEnum.MANUAL_RECHARGE,
      }) as never,
    );
    appRepository.findOne.mockResolvedValue({
      appId: 'app-1',
      subdomain: 'tenant-1',
      services: [{ id: SERVICE_TYPES.SSI_API }],
    });
    const grantSSIAllowance = jest
      .spyOn(service, 'grantSSIAllowance')
      .mockResolvedValue({} as never);

    await service.grantCredit(
      'app-1',
      {
        amount: '100',
        validityPeriod: 30,
        validityPeriodUnit: TimeUnit.Days,
        amountDenom: 'uhid',
      },
      'admin-1',
      CreditSourceEnum.MANUAL_RECHARGE,
    );

    expect(repository.findActiveCreditForService).toHaveBeenCalledWith('app-1');
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        apiCredit: { total: 100, used: 0 },
        status: CreditStatus.INACTIVE,
        validityDays: 30,
        criticalBalance: 40,
        referenceId: expect.any(String),
      }),
    );
    expect(repository.create).toHaveBeenCalledWith(
      expect.not.objectContaining({ expiresAt: expect.any(Date) }),
    );
    expect(commandService.grantCreditPlan).not.toHaveBeenCalled();
    expect(grantSSIAllowance).not.toHaveBeenCalled();
  });

  it('reuses an existing plan for an exact grant reference retry', async () => {
    const existing = plan({
      referenceId: 'payment-retry',
      source: CreditSourceEnum.MANUAL_RECHARGE,
    });
    repository.findParticularCreditDetail.mockResolvedValue(existing as never);

    await service.grantCredit(
      'app-1',
      {
        amount: '100',
        validityPeriod: 30,
        validityPeriodUnit: TimeUnit.Days,
        amountDenom: 'uhid',
      },
      'admin-1',
      CreditSourceEnum.MANUAL_RECHARGE,
      'payment-retry',
    );

    expect(repository.create).not.toHaveBeenCalled();
    expect(repository.findActiveCreditForService).not.toHaveBeenCalled();
    expect(commandService.grantCreditPlan).toHaveBeenCalledWith(
      expect.objectContaining({ referenceId: 'payment-retry' }),
      SERVICE_TYPES.CAVACH_API,
      'tenant-1',
    );
  });

  it('rejects reuse of a grant reference with different semantics', async () => {
    repository.findParticularCreditDetail.mockResolvedValue(
      plan({
        referenceId: 'payment-conflict',
        source: CreditSourceEnum.MANUAL_RECHARGE,
      }) as never,
    );

    await expect(
      service.grantCredit(
        'app-1',
        {
          amount: '101',
          validityPeriod: 30,
          validityPeriodUnit: TimeUnit.Days,
          amountDenom: 'uhid',
        },
        'admin-1',
        CreditSourceEnum.MANUAL_RECHARGE,
        'payment-conflict',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(repository.create).not.toHaveBeenCalled();
    expect(commandService.grantCreditPlan).not.toHaveBeenCalled();
  });

  it('sets expiry and grants the SSI allowance when activating a queued credit', async () => {
    const credit = plan({
      status: CreditStatus.INACTIVE,
      expiresAt: undefined,
    });
    repository.findParticularCreditDetail.mockResolvedValue(credit as never);
    repository.findOneAndUpdate.mockResolvedValue(credit as never);
    appRepository.findOne.mockResolvedValue({
      appId: 'app-1',
      subdomain: 'tenant-1',
      services: [{ id: SERVICE_TYPES.SSI_API }],
    });
    const grantSSIAllowance = jest
      .spyOn(service, 'grantSSIAllowance')
      .mockResolvedValue({
        credit: { amount: '100', denom: 'uhid' },
        creditScope: [],
      });

    await service.activateCredit(credit._id as string, 'app-1');

    expect(grantSSIAllowance).toHaveBeenCalledWith('app-1', '100', 30 / 365);
    expect(repository.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: credit._id, serviceId: 'app-1' },
      {
        $set: expect.objectContaining({
          status: CreditStatus.ACTIVE,
          expiresAt: expect.any(Date),
          onChainAllowance: { amount: 100, denom: 'uhid' },
          onChainAllowanceScopes: [],
        }),
      },
    );
    expect(commandService.grantCreditPlan).not.toHaveBeenCalled();
  });
});

function plan(overrides: Partial<CreditPlan> = {}) {
  return {
    _id: '6a82ef1bedd27b1f5c1e2f7f',
    serviceId: 'app-1',
    status: CreditStatus.INACTIVE,
    apiCredit: { total: 100, used: 0 },
    criticalBalance: 40,
    referenceId: 'payment-1',
    validityDays: 30,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    expiresAt: new Date('2026-09-01T00:00:00.000Z'),
    ...overrides,
  } as CreditPlan & { _id: string };
}
