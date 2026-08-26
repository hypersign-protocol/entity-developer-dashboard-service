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
import {
  MSG_CREATE_DID_TYPEURL,
  MSG_DEACTIVATE_DID_TYPEURL,
} from '../../utils/authz';
import { BasicAllowance } from 'cosmjs-types/cosmos/feegrant/v1beta1/feegrant';

describe('CreditService', () => {
  let repository: jest.Mocked<CreditRepository>;
  let commandService: jest.Mocked<CreditCommandService>;
  let appRepository: { findOne: jest.Mock };
  let service: CreditService;

  beforeEach(() => {
    repository = {
      findParticularCreditDetail: jest.fn(),
      findOneAndUpdate: jest.fn(),
      activateSsiCreditPlan: jest.fn(),
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

  it('publishes the first active SSI plan after creating its on-chain allowance', async () => {
    const createdCredit = plan({
      serviceType: SERVICE_TYPES.SSI_API,
      status: CreditStatus.ACTIVE,
      onChainAllowance: { amount: 100, denom: 'uhid', usedAmount: 0 },
      source: CreditSourceEnum.MANUAL_RECHARGE,
    });
    repository.create.mockResolvedValue(createdCredit as never);
    appRepository.findOne.mockResolvedValue({
      appId: 'app-1',
      subdomain: 'tenant-ssi',
      services: [{ id: SERVICE_TYPES.SSI_API }],
    });
    jest.spyOn(service, 'grantSSIAllowance').mockResolvedValue({
      credit: { amount: '100', denom: 'uhid' },
      feegrant: {
        amount: '100',
        previousRemainingAmount: '0',
        denom: 'uhid',
      },
      creditScope: [],
    });

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
        serviceType: SERVICE_TYPES.SSI_API,
        status: CreditStatus.ACTIVE,
        onChainAllowance: { amount: 100, denom: 'uhid', usedAmount: 0 },
      }),
    );
    expect(commandService.grantCreditPlan).toHaveBeenCalledWith(
      createdCredit,
      SERVICE_TYPES.SSI_API,
      'tenant-ssi',
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

  it('backfills a legacy critical balance before activating a queued SSI credit', async () => {
    const credit = plan({
      status: CreditStatus.INACTIVE,
      expiresAt: undefined,
      criticalBalance: undefined,
    });
    repository.findParticularCreditDetail.mockResolvedValue(credit as never);
    const normalizedCredit = plan({
      serviceType: SERVICE_TYPES.SSI_API,
      criticalBalance: 40,
    });
    const activatedCredit = plan({
      status: CreditStatus.ACTIVE,
      criticalBalance: 40,
      onChainAllowance: { amount: 100, denom: 'uhid', usedAmount: 0 },
    });
    repository.findOneAndUpdate.mockResolvedValueOnce(
      normalizedCredit as never,
    );
    repository.activateSsiCreditPlan.mockResolvedValue(
      activatedCredit as never,
    );
    appRepository.findOne.mockResolvedValue({
      appId: 'app-1',
      subdomain: 'tenant-1',
      services: [{ id: SERVICE_TYPES.SSI_API }],
    });
    const grantSSIAllowance = jest
      .spyOn(service, 'grantSSIAllowance')
      .mockResolvedValue({
        credit: { amount: '100', denom: 'uhid' },
        feegrant: {
          amount: '100',
          previousRemainingAmount: '0',
          denom: 'uhid',
        },
        creditScope: [],
      });

    await service.activateCredit(credit._id as string, 'app-1');

    expect(grantSSIAllowance).toHaveBeenCalledWith('app-1', '100', 30 / 365);
    expect(repository.findOneAndUpdate).toHaveBeenCalledWith(
      {
        _id: credit._id,
        serviceId: 'app-1',
      },
      {
        $set: {
          criticalBalance: 40,
          serviceType: SERVICE_TYPES.SSI_API,
        },
      },
    );
    expect(repository.activateSsiCreditPlan).toHaveBeenCalledWith(
      'app-1',
      credit._id,
      expect.any(Date),
      40,
      { amount: 100, denom: 'uhid', usedAmount: 0 },
      [],
    );
    expect(commandService.grantCreditPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        status: CreditStatus.ACTIVE,
        onChainAllowance: { amount: 100, denom: 'uhid', usedAmount: 0 },
      }),
      SERVICE_TYPES.SSI_API,
      'tenant-1',
    );
  });

  it('resumes SDK publication without repeating an already-persisted SSI allowance', async () => {
    const credit = plan({
      serviceType: SERVICE_TYPES.SSI_API,
      status: CreditStatus.ACTIVE,
      criticalBalance: undefined,
      onChainAllowance: { amount: 100, denom: 'uhid', usedAmount: 0 },
      onChainAllowanceScopes: [],
    });
    const normalizedCredit = plan({
      serviceType: SERVICE_TYPES.SSI_API,
      status: CreditStatus.ACTIVE,
      criticalBalance: 40,
      onChainAllowance: { amount: 100, denom: 'uhid', usedAmount: 0 },
      onChainAllowanceScopes: [],
    });
    repository.findParticularCreditDetail.mockResolvedValue(credit as never);
    repository.findOneAndUpdate.mockResolvedValue(normalizedCredit as never);
    repository.activateSsiCreditPlan.mockResolvedValue(
      normalizedCredit as never,
    );
    appRepository.findOne.mockResolvedValue({
      appId: 'app-1',
      subdomain: 'tenant-1',
      services: [{ id: SERVICE_TYPES.SSI_API }],
    });
    const grantSSIAllowance = jest.spyOn(service, 'grantSSIAllowance');

    await service.activateCredit(credit._id as string, 'app-1');

    expect(grantSSIAllowance).not.toHaveBeenCalled();
    expect(repository.activateSsiCreditPlan).toHaveBeenCalledWith(
      'app-1',
      credit._id,
      credit.expiresAt,
      40,
      undefined,
      undefined,
    );
    expect(commandService.grantCreditPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        serviceType: SERVICE_TYPES.SSI_API,
        status: CreditStatus.ACTIVE,
        criticalBalance: 40,
        onChainAllowance: { amount: 100, denom: 'uhid', usedAmount: 0 },
      }),
      SERVICE_TYPES.SSI_API,
      'tenant-1',
    );
  });

  it('does not overwrite a blockchain commit that wins the activation race', async () => {
    const credit = plan({
      serviceType: SERVICE_TYPES.SSI_API,
      status: CreditStatus.ACTIVE,
      onChainAllowance: { amount: 1000, denom: 'uhid', usedAmount: 0 },
    });
    repository.findParticularCreditDetail.mockResolvedValue(credit as never);
    repository.activateSsiCreditPlan.mockResolvedValue(
      plan({
        serviceType: SERVICE_TYPES.SSI_API,
        status: CreditStatus.INACTIVE,
        onChainAllowance: {
          amount: 1000,
          denom: 'uhid',
          usedAmount: 1000,
        },
      }) as never,
    );
    appRepository.findOne.mockResolvedValue({
      appId: 'app-1',
      subdomain: 'tenant-1',
      services: [{ id: SERVICE_TYPES.SSI_API }],
    });
    const grantSSIAllowance = jest.spyOn(service, 'grantSSIAllowance');

    await expect(
      service.activateCredit(credit._id as string, 'app-1'),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(grantSSIAllowance).not.toHaveBeenCalled();
    expect(commandService.grantCreditPlan).not.toHaveBeenCalled();
  });

  it('rejects reactivation when the persisted SSI blockchain allowance is depleted', async () => {
    const credit = plan({
      serviceType: SERVICE_TYPES.SSI_API,
      status: CreditStatus.INACTIVE,
      onChainAllowance: { amount: 1000, denom: 'uhid', usedAmount: 1000 },
    });
    repository.findParticularCreditDetail.mockResolvedValue(credit as never);
    appRepository.findOne.mockResolvedValue({
      appId: 'app-1',
      subdomain: 'tenant-1',
      services: [{ id: SERVICE_TYPES.SSI_API }],
    });

    await expect(
      service.activateCredit(credit._id as string, 'app-1'),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(repository.activateSsiCreditPlan).not.toHaveBeenCalled();
    expect(commandService.grantCreditPlan).not.toHaveBeenCalled();
  });

  it('revokes existing SSI AuthZ and fee grants before broadcasting replacements', async () => {
    const signAndBroadcast = jest
      .fn()
      .mockResolvedValue(successfulTx('REPLACEMENT_TX'));
    const authzGrants = jest
      .fn()
      .mockImplementation(
        (_granter: string, _grantee: string, msgTypeUrl: string) =>
          Promise.resolve({
            grants:
              msgTypeUrl === MSG_CREATE_DID_TYPEURL
                ? [
                    {
                      authorization: {
                        typeUrl: '/cosmos.authz.v1beta1.GenericAuthorization',
                      },
                    },
                  ]
                : [],
          }),
      );
    const feegrantAllowance = jest
      .fn()
      .mockResolvedValue(basicFeegrantAllowance('40'));
    const grantService = makeGrantService(
      signAndBroadcast,
      authzGrants,
      feegrantAllowance,
    );

    const grantResult = await grantService.grantSSIAllowance(
      'app-1',
      '100',
      30 / 365,
    );

    expect(signAndBroadcast).toHaveBeenCalledTimes(1);
    const replacementMessages = signAndBroadcast.mock.calls[0][1];
    expect(replacementMessages).toHaveLength(9);
    const replacementFeegrant = replacementMessages.find(
      ({ typeUrl }) => typeUrl === '/cosmos.feegrant.v1beta1.MsgGrantAllowance',
    );
    const decodedReplacement = BasicAllowance.decode(
      replacementFeegrant.value.allowance.value,
    );
    expect(decodedReplacement.spendLimit).toEqual([
      { denom: 'uhid', amount: '140' },
    ]);
    expect(grantResult.credit.amount).toBe('100');
    expect(grantResult.feegrant.amount).toBe('140');
    expect(replacementMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          typeUrl: '/cosmos.authz.v1beta1.MsgRevoke',
          value: expect.objectContaining({
            msgTypeUrl: MSG_CREATE_DID_TYPEURL,
          }),
        }),
        expect.objectContaining({
          typeUrl: '/cosmos.feegrant.v1beta1.MsgRevokeAllowance',
        }),
        expect.objectContaining({
          typeUrl: '/cosmos.authz.v1beta1.MsgGrant',
          value: expect.objectContaining({
            grant: expect.objectContaining({
              authorization: expect.objectContaining({
                typeUrl: '/cosmos.authz.v1beta1.GenericAuthorization',
              }),
            }),
          }),
        }),
        expect.objectContaining({
          typeUrl: '/cosmos.feegrant.v1beta1.MsgGrantAllowance',
        }),
      ]),
    );
    expect(authzGrants).toHaveBeenCalledWith(
      'hid-granter',
      'hid-app',
      MSG_DEACTIVATE_DID_TYPEURL,
    );
  });

  it('broadcasts only the replacement when no previous SSI grant exists', async () => {
    const signAndBroadcast = jest
      .fn()
      .mockResolvedValue(successfulTx('GRANT_TX'));
    const grantService = makeGrantService(
      signAndBroadcast,
      jest.fn().mockResolvedValue({ grants: [] }),
      jest.fn().mockResolvedValue({}),
    );

    await grantService.grantSSIAllowance('app-1', '100');

    expect(signAndBroadcast).toHaveBeenCalledTimes(1);
    expect(signAndBroadcast.mock.calls[0][1]).toHaveLength(7);
  });

  it('fails atomically when the combined SSI replacement transaction fails', async () => {
    const signAndBroadcast = jest.fn().mockResolvedValue({
      ...successfulTx('FAILED_REVOKE_TX'),
      code: 5,
      rawLog: 'revoke failed',
    });
    const grantService = makeGrantService(
      signAndBroadcast,
      jest.fn().mockResolvedValue({ grants: [{}] }),
      jest.fn().mockResolvedValue({}),
    );

    await expect(
      grantService.grantSSIAllowance('app-1', '100'),
    ).rejects.toThrow();

    expect(signAndBroadcast).toHaveBeenCalledTimes(1);
    expect(signAndBroadcast.mock.calls[0][1]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          typeUrl: '/cosmos.authz.v1beta1.MsgRevoke',
        }),
        expect.objectContaining({
          typeUrl: '/cosmos.authz.v1beta1.MsgGrant',
        }),
      ]),
    );
  });
});

function makeGrantService(
  signAndBroadcast: jest.Mock,
  authzGrants: jest.Mock,
  feegrantAllowance: jest.Mock,
): CreditService {
  const appRepository = {
    findOne: jest.fn().mockResolvedValue({
      appId: 'app-1',
      walletAddress: 'hid-app',
      services: [{ id: SERVICE_TYPES.SSI_API }],
    }),
  };
  const moduleRef = {
    resolve: jest.fn().mockResolvedValue({
      generateWallet: jest.fn().mockResolvedValue({
        address: 'hid-granter',
        wallet: {},
      }),
    }),
  };
  const grantService = new CreditService(
    { get: jest.fn().mockReturnValue('test-value') } as never,
    appRepository as never,
    {} as never,
    {} as never,
    moduleRef as never,
  );
  (grantService as any).granterClient = { signAndBroadcast };
  (grantService as any).grantQueryClient = {
    authz: { grants: authzGrants },
    feegrant: { allowance: feegrantAllowance },
  };
  return grantService;
}

function successfulTx(transactionHash: string) {
  return {
    code: 0,
    height: 1,
    transactionHash,
    gasWanted: 500000,
    gasUsed: 100000,
    rawLog: '',
  };
}

function basicFeegrantAllowance(remainingAmount: string) {
  return {
    allowance: {
      granter: 'hid-granter',
      grantee: 'hid-app',
      allowance: {
        typeUrl: '/cosmos.feegrant.v1beta1.BasicAllowance',
        value: BasicAllowance.encode(
          BasicAllowance.fromPartial({
            spendLimit: [{ denom: 'uhid', amount: remainingAmount }],
          }),
        ).finish(),
      },
    },
  };
}

function plan(overrides: Partial<CreditPlan> = {}) {
  return {
    _id: '6a82ef1bedd27b1f5c1e2f7f',
    serviceId: 'app-1',
    serviceType: SERVICE_TYPES.CAVACH_API,
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
