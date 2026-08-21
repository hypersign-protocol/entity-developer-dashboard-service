import { SERVICE_TYPES } from '../../supported-service/services/iServiceList';
import { CreditPlan, CreditStatus } from '../schemas/credit.schema';
import { CreditCommandService } from './credit-command.service';
import { CreditBullMqProvider } from './credit-bullmq.provider';

describe('CreditCommandService', () => {
  it('publishes an idempotent SDK grant command for an active credit', async () => {
    const bullMq = { add: jest.fn().mockResolvedValue(undefined) };
    const service = new CreditCommandService(
      bullMq as unknown as CreditBullMqProvider,
    );
    const credit = {
      _id: 'credit-1',
      status: CreditStatus.ACTIVE,
      serviceId: 'app-1',
      apiCredit: { total: 100, used: 25 },
      criticalBalance: 10,
      referenceId: 'payment-1',
      validityDays: 30,
      expiresAt: new Date('2026-09-01T00:00:00.000Z'),
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
    } as CreditPlan;

    await service.grantCreditPlan(credit, SERVICE_TYPES.CAVACH_API, 'tenant-1');

    expect(bullMq.add).toHaveBeenCalledTimes(1);
    const [queueName, jobName, command, options] = bullMq.add.mock.calls[0];
    expect(queueName).toBe('credit.commands.KYC_SERVICE');
    expect(jobName).toBe('credit.grant.requested');
    expect(command).toEqual(
      expect.objectContaining({
        schemaVersion: 3,
        commandId: 'grant-KYC_SERVICE-credit-1',
        serviceType: 'KYC_SERVICE',
        payload: expect.objectContaining({
          subject: {
            appId: 'app-1',
            tenantId: 'tenant-1',
            appType: 'KYC_SERVICE',
            creditType: 'API_CREDIT',
          },
          planId: 'credit-1',
          amount: 75,
          criticalBalance: 10,
          grantedAt: new Date('2026-08-01T00:00:00.000Z').getTime(),
          expiresAt: new Date('2026-09-01T00:00:00.000Z').getTime(),
          referenceId: 'payment-1',
        }),
      }),
    );
    expect(options).toEqual({ jobId: command.commandId });
  });

  it('rejects a non-active credit plan', async () => {
    const bullMq = { add: jest.fn() };
    const service = new CreditCommandService(
      bullMq as unknown as CreditBullMqProvider,
    );

    await expect(
      service.grantCreditPlan(
        { status: CreditStatus.INACTIVE } as CreditPlan,
        SERVICE_TYPES.CAVACH_API,
      ),
    ).rejects.toThrow('Only an active credit plan can be granted');

    expect(bullMq.add).not.toHaveBeenCalled();
  });

  it('rejects an exhausted credit plan', async () => {
    const bullMq = { add: jest.fn() };
    const service = new CreditCommandService(
      bullMq as unknown as CreditBullMqProvider,
    );

    await expect(
      service.grantCreditPlan(
        {
          _id: 'credit-1',
          status: CreditStatus.ACTIVE,
          serviceId: 'app-1',
          apiCredit: { total: 100, used: 100 },
          criticalBalance: 10,
          referenceId: 'payment-1',
          validityDays: 30,
          expiresAt: new Date('2026-09-01T00:00:00.000Z'),
          createdAt: new Date('2026-08-01T00:00:00.000Z'),
        } as CreditPlan,
        SERVICE_TYPES.CAVACH_API,
      ),
    ).rejects.toThrow('Credit plan must have a positive remaining balance');
    expect(bullMq.add).not.toHaveBeenCalled();
  });

  it('rejects a plan with an invalid critical balance', async () => {
    const bullMq = { add: jest.fn() };
    const service = new CreditCommandService(
      bullMq as unknown as CreditBullMqProvider,
    );

    await expect(
      service.grantCreditPlan(
        {
          _id: 'credit-1',
          status: CreditStatus.ACTIVE,
          serviceId: 'app-1',
          apiCredit: { total: 100, used: 0 },
          criticalBalance: -1,
          referenceId: 'payment-1',
          validityDays: 30,
          expiresAt: new Date('2026-09-01T00:00:00.000Z'),
          createdAt: new Date('2026-08-01T00:00:00.000Z'),
        } as CreditPlan,
        SERVICE_TYPES.CAVACH_API,
      ),
    ).rejects.toThrow('criticalBalance must be a non-negative safe integer');
    expect(bullMq.add).not.toHaveBeenCalled();
  });

  it('rejects an active plan whose service has no SDK catalog', async () => {
    const bullMq = { add: jest.fn() };
    const service = new CreditCommandService(
      bullMq as unknown as CreditBullMqProvider,
    );

    await expect(
      service.grantCreditPlan(
        { status: CreditStatus.ACTIVE } as CreditPlan,
        'UNKNOWN_SERVICE',
      ),
    ).rejects.toThrow('No SDK credit catalog configured');
    expect(bullMq.add).not.toHaveBeenCalled();
  });
});
