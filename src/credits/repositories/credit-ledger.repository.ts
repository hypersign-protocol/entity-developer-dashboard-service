import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  CreditLedger,
  CreditLedgerMetadata,
} from '../schemas/credit-ledger.schema';

export type CreateCreditLedgerEvent = {
  timestamp: Date;
  metadata: CreditLedgerMetadata;
  eventType: string;
  planId?: string;
  operation?: string;
  eventId: string;
  schemaVersion: number;
  catalogVersion?: string;
  reservationId?: string;
  amount?: number;
  totalAmount?: number;
  allocationIndex?: number;
  allocationCount?: number;
  planBalanceAfter?: number;
  balanceAfter?: number;
};

@Injectable()
export class CreditLedgerRepository {
  constructor(
    @InjectModel(CreditLedger.name)
    private readonly ledgerModel: Model<CreditLedger>,
  ) {}

  async create(event: CreateCreditLedgerEvent): Promise<CreditLedger> {
    Logger.debug('Adding credit event to ledger', CreditLedgerRepository.name);
    return new this.ledgerModel(event).save();
  }

  async exists(eventId: string): Promise<boolean> {
    return Boolean(await this.ledgerModel.exists({ eventId }).exec());
  }
}
