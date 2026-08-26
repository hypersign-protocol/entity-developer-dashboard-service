import { SERVICE_TYPES } from '../../supported-service/services/iServiceList';
import { CreditType } from '@hypersign-protocol/credit-middleware';
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
      serviceType: SERVICE_TYPES.CAVACH_API,
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
    expect(queueName).toBe('credit.commands.CAVACH_API');
    expect(jobName).toBe('credit.grant.requested');
    expect(command).toEqual(
      expect.objectContaining({
        schemaVersion: 3,
        commandId: 'grant-CAVACH_API-credit-1',
        serviceType: SERVICE_TYPES.CAVACH_API,
        payload: expect.objectContaining({
          subject: {
            appId: 'app-1',
            tenantId: 'tenant-1',
            appType: SERVICE_TYPES.CAVACH_API,
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

  it('publishes separate SSI API and blockchain wallet grants', async () => {
    const bullMq = { add: jest.fn().mockResolvedValue(undefined) };
    const service = new CreditCommandService(
      bullMq as unknown as CreditBullMqProvider,
    );
    const credit = {
      _id: 'ssi-credit-1',
      status: CreditStatus.ACTIVE,
      serviceId: 'ssi-app-1',
      serviceType: SERVICE_TYPES.SSI_API,
      apiCredit: { total: 100, used: 25 },
      onChainAllowance: { amount: 500, denom: 'uhid', usedAmount: 100 },
      criticalBalance: 40,
      referenceId: 'ssi-payment-1',
      validityDays: 30,
      expiresAt: new Date('2026-09-01T00:00:00.000Z'),
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
    } as CreditPlan;

    await service.grantCreditPlan(credit, SERVICE_TYPES.SSI_API, 'tenant-ssi');

    expect(bullMq.add).toHaveBeenCalledTimes(2);
    const commands = bullMq.add.mock.calls.map((call) => call[2]);
    expect(bullMq.add.mock.calls.map((call) => call[0])).toEqual([
      'credit.commands.SSI_API',
      'credit.commands.SSI_API',
    ]);
    expect(commands).toEqual([
      expect.objectContaining({
        commandId: 'grant-SSI_API-ssi-credit-1.API_CREDIT',
        serviceType: SERVICE_TYPES.SSI_API,
        payload: expect.objectContaining({
          subject: expect.objectContaining({
            appType: SERVICE_TYPES.SSI_API,
            creditType: CreditType.API_CREDIT,
          }),
          planId: 'ssi-credit-1.API_CREDIT',
          referenceId: 'ssi-payment-1.API_CREDIT',
          amount: 100,
          criticalBalance: 40,
        }),
      }),
      expect.objectContaining({
        commandId: 'grant-SSI_API-ssi-credit-1.BLOCKCHAIN_TXN_CREDIT',
        serviceType: SERVICE_TYPES.SSI_API,
        payload: expect.objectContaining({
          subject: expect.objectContaining({
            appType: SERVICE_TYPES.SSI_API,
            creditType: CreditType.BLOCKCHAIN_TXN_CREDIT,
          }),
          planId: 'ssi-credit-1.BLOCKCHAIN_TXN_CREDIT',
          referenceId: 'ssi-payment-1.BLOCKCHAIN_TXN_CREDIT',
          amount: 500,
          criticalBalance: 200,
        }),
      }),
    ]);
  });

  it('publishes an idempotent SSI commit command for a successful transaction', async () => {
    const bullMq = { add: jest.fn().mockResolvedValue(undefined) };
    const service = new CreditCommandService(
      bullMq as unknown as CreditBullMqProvider,
    );

    await service.settleSsiTransaction({
      transactionJobId: 'txn-1',
      reservationId: 'reservation-1',
      status: 'SUCCEEDED',
    });

    expect(bullMq.add).toHaveBeenCalledWith(
      'credit.commands.SSI_API',
      'credit.commit.requested',
      expect.objectContaining({
        schemaVersion: 3,
        commandId: 'settle-SSI_API-reservation-1-commit',
        serviceType: SERVICE_TYPES.SSI_API,
        payload: {
          reservationId: 'reservation-1',
          transactionJobId: 'txn-1',
        },
      }),
      { jobId: 'settle-SSI_API-reservation-1-commit' },
    );
  });

  it('publishes an SSI rollback command for a failed transaction', async () => {
    const bullMq = { add: jest.fn().mockResolvedValue(undefined) };
    const service = new CreditCommandService(
      bullMq as unknown as CreditBullMqProvider,
    );

    await service.settleSsiTransaction({
      transactionJobId: 'txn-2',
      reservationId: 'reservation-2',
      status: 'FAILED',
      reason: 'chain rejected the transaction',
    });

    expect(bullMq.add).toHaveBeenCalledWith(
      'credit.commands.SSI_API',
      'credit.rollback.requested',
      expect.objectContaining({
        commandId: 'settle-SSI_API-reservation-2-rollback',
        payload: {
          reservationId: 'reservation-2',
          transactionJobId: 'txn-2',
          reason: 'chain rejected the transaction',
        },
      }),
      { jobId: 'settle-SSI_API-reservation-2-rollback' },
    );
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
          serviceType: SERVICE_TYPES.CAVACH_API,
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
          serviceType: SERVICE_TYPES.CAVACH_API,
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
