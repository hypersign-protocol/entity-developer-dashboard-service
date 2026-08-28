import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import type {
  CreditBullMqJob,
  CreditBullMqProvider as CreditBullMqProviderContract,
  CreditBullMqWorker,
} from '@hypersign-protocol/credit-middleware';
import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';

@Injectable()
export class CreditBullMqProvider
  implements CreditBullMqProviderContract, OnApplicationShutdown
{
  private readonly queues = new Map<string, Queue>();
  private readonly workers = new Set<Worker>();
  private readonly connection: Redis;

  constructor(redisUrl: string, private readonly workerConcurrency = 10) {
    this.connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  }

  async add(
    queueName: string,
    jobName: string,
    data: unknown,
    options: { jobId: string },
  ): Promise<unknown> {
    const queue = this.queue(queueName);
    return queue.add(jobName, data, {
      jobId: options.jobId,
      attempts: 10,
      backoff: { type: 'exponential', delay: 1_000 },
      removeOnComplete: 1_000,
      removeOnFail: 5_000,
    });
  }

  async retryFailedJobs(
    queueName: string,
    jobName: string,
    failedReasonIncludes: string,
  ): Promise<number> {
    const jobs = await this.queue(queueName).getJobs(
      ['failed'],
      0,
      4_999,
      true,
    );
    let retried = 0;
    for (const job of jobs) {
      if (
        job.name !== jobName ||
        !job.failedReason?.includes(failedReasonIncludes)
      ) {
        continue;
      }
      try {
        await job.retry('failed');
        retried += 1;
      } catch (error) {
        // Another dashboard replica may have retried the same job first.
        if ((await job.getState()) === 'failed') throw error;
      }
    }
    return retried;
  }

  async createWorker(
    queueName: string,
    processor: (job: CreditBullMqJob) => Promise<unknown>,
  ): Promise<CreditBullMqWorker> {
    const worker = new Worker(
      queueName,
      (job) => processor({ id: job.id, name: job.name, data: job.data }),
      {
        connection: this.connection,
        concurrency: this.workerConcurrency,
      },
    );
    this.workers.add(worker);
    return {
      close: async () => {
        this.workers.delete(worker);
        await worker.close();
      },
    };
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all([...this.workers].map((worker) => worker.close()));
    await Promise.all([...this.queues.values()].map((queue) => queue.close()));
    await this.connection.quit();
  }

  private queue(queueName: string): Queue {
    let queue = this.queues.get(queueName);
    if (!queue) {
      queue = new Queue(queueName, { connection: this.connection });
      this.queues.set(queueName, queue);
    }
    return queue;
  }
}
