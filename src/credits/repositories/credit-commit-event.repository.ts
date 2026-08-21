import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  CreditCommitEvent,
  CreditCommitEventMetadata,
} from '../schemas/credit-commit-event.schema';

export type CreateCreditCommitEvent = {
  timestamp: Date;
  metadata: CreditCommitEventMetadata;
  planId: string;
  operation: string;
  eventId: string;
  schemaVersion: number;
  catalogVersion: string;
  catalogId: string;
  reservationId: string;
  amount: number;
  totalAmount: number;
  allocationIndex: number;
  allocationCount: number;
  planBalanceAfter: number;
  balanceAfter: number;
};

@Injectable()
export class CreditCommitEventRepository {
  constructor(
    @InjectModel(CreditCommitEvent.name)
    private readonly commitEventModel: Model<CreditCommitEvent>,
  ) {}

  async create(event: CreateCreditCommitEvent): Promise<CreditCommitEvent> {
    Logger.debug(
      'Inside create() to add new commit event to db',
      'CreditCommitEventRepository',
    );
    return new this.commitEventModel(event).save();
  }
}
