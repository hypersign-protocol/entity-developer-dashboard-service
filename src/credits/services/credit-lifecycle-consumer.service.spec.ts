import { CreditBullMqProvider } from './credit-bullmq.provider';
import { CreditEventStore } from './credit-event-store.service';
import { CreditLifecycleConsumer } from './credit-lifecycle-consumer.service';

describe('CreditLifecycleConsumer', () => {
  it('creates and closes the credit lifecycle worker', async () => {
    const close = jest.fn().mockResolvedValue(undefined);
    let processor: (job: any) => Promise<unknown>;
    const bullMq = {
      createWorker: jest.fn().mockImplementation((_queue, handler) => {
        processor = handler;
        return { close };
      }),
    } as unknown as CreditBullMqProvider;
    const store = {
      append: jest.fn().mockResolvedValue(undefined),
    } as unknown as CreditEventStore;
    const consumer = new CreditLifecycleConsumer(bullMq, store);

    await consumer.onApplicationBootstrap();
    expect(bullMq.createWorker).toHaveBeenCalledWith(
      'credit.lifecycle',
      expect.any(Function),
    );

    const job = { id: 'job-1', name: 'credit.reserved', data: {} };
    await processor(job);
    expect(store.append).toHaveBeenCalledWith(job);

    await consumer.onApplicationShutdown();
    expect(close).toHaveBeenCalledTimes(1);
  });
});
