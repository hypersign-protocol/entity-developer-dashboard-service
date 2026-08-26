import { SsiTransactionResultConsumer } from './ssi-transaction-result.consumer';

describe('SsiTransactionResultConsumer', () => {
  const result = (status: 'SUCCEEDED' | 'FAILED' | 'UNKNOWN') => ({
    schemaVersion: 1,
    eventId: `batch-1:${status}`,
    status,
    code: status === 'SUCCEEDED' ? 0 : 7,
    rawLog: status === 'FAILED' ? 'chain rejected' : '',
    items: [
      {
        transactionJobId: 'txn-1',
        reservationId: 'reservation-1',
        serviceType: 'SSI_API',
      },
    ],
  });

  function setup() {
    const commands = {
      settleSsiTransaction: jest.fn().mockResolvedValue(undefined),
    };
    const consumer = new SsiTransactionResultConsumer(
      { get: jest.fn() } as any,
      commands as any,
    );
    const channel = {
      ack: jest.fn(),
      nack: jest.fn(),
    };
    return { commands, consumer, channel };
  }

  it('turns a successful RabbitMQ result into a commit command', async () => {
    const { commands, consumer, channel } = setup();
    const message = {
      content: Buffer.from(JSON.stringify(result('SUCCEEDED'))),
    };

    await (consumer as any).consume(message, channel);

    expect(commands.settleSsiTransaction).toHaveBeenCalledWith({
      transactionJobId: 'txn-1',
      reservationId: 'reservation-1',
      status: 'SUCCEEDED',
      reason: undefined,
    });
    expect(channel.ack).toHaveBeenCalledWith(message);
    expect(channel.nack).not.toHaveBeenCalled();
  });

  it('turns a failed result into a rollback and preserves the chain reason', async () => {
    const { commands, consumer, channel } = setup();
    const message = { content: Buffer.from(JSON.stringify(result('FAILED'))) };

    await (consumer as any).consume(message, channel);

    expect(commands.settleSsiTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'FAILED',
        reason: 'chain rejected',
      }),
    );
    expect(channel.ack).toHaveBeenCalledWith(message);
  });

  it('does not settle an unknown blockchain outcome', async () => {
    const { commands, consumer, channel } = setup();
    const message = { content: Buffer.from(JSON.stringify(result('UNKNOWN'))) };

    await (consumer as any).consume(message, channel);

    expect(commands.settleSsiTransaction).not.toHaveBeenCalled();
    expect(channel.ack).toHaveBeenCalledWith(message);
  });

  it('requeues a valid result when BullMQ settlement publication fails', async () => {
    const { commands, consumer, channel } = setup();
    commands.settleSsiTransaction.mockRejectedValueOnce(
      new Error('redis down'),
    );
    const message = {
      content: Buffer.from(JSON.stringify(result('SUCCEEDED'))),
    };

    await (consumer as any).consume(message, channel);

    expect(channel.ack).not.toHaveBeenCalled();
    expect(channel.nack).toHaveBeenCalledWith(message, false, true);
  });
});
