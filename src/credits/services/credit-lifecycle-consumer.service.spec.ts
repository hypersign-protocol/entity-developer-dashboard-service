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
      retryFailedJobs: jest.fn().mockResolvedValue(0),
    } as unknown as CreditBullMqProvider;
    const store = {
      initialize: jest.fn().mockResolvedValue(undefined),
      append: jest.fn().mockResolvedValue(undefined),
    } as unknown as CreditEventStore;
    const consumer = new CreditLifecycleConsumer(bullMq, store);

    await consumer.onApplicationBootstrap();
    expect(store.initialize).toHaveBeenCalledTimes(1);
    expect(bullMq.createWorker).toHaveBeenCalledWith(
      'credit.lifecycle',
      expect.any(Function),
    );
    expect(bullMq.retryFailedJobs).toHaveBeenCalledWith(
      'credit.lifecycle',
      'credit.committed',
      expect.stringContaining('time-series collection'),
    );

    const job = { id: 'job-1', name: 'credit.reserved', data: {} };
    await processor(job);
    expect(store.append).toHaveBeenCalledWith(job);

    await consumer.onApplicationShutdown();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('serializes critical-balance processing for the same app', async () => {
    let processor: (job: any) => Promise<unknown>;
    const bullMq = {
      createWorker: jest.fn().mockImplementation((_queue, handler) => {
        processor = handler;
        return { close: jest.fn().mockResolvedValue(undefined) };
      }),
      retryFailedJobs: jest.fn().mockResolvedValue(0),
    } as unknown as CreditBullMqProvider;
    let finishFirst: () => void;
    const firstAppend = new Promise<void>((resolve) => {
      finishFirst = resolve;
    });
    const store = {
      initialize: jest.fn().mockResolvedValue(undefined),
      append: jest
        .fn()
        .mockImplementationOnce(() => firstAppend)
        .mockResolvedValue(undefined),
    } as unknown as CreditEventStore;
    const consumer = new CreditLifecycleConsumer(bullMq, store);
    await consumer.onApplicationBootstrap();

    const event = {
      name: 'credit.critical-balance',
      data: { event: { appId: 'app-1' } },
    };
    const first = processor({ id: 'job-1', ...event });
    await Promise.resolve();
    const second = processor({ id: 'job-2', ...event });
    await Promise.resolve();
    expect(store.append).toHaveBeenCalledTimes(1);

    finishFirst();
    await Promise.all([first, second]);
    expect(store.append).toHaveBeenCalledTimes(2);
  });
});
