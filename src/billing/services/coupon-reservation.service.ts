import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model } from 'mongoose';
import { checkCouponEligibility } from '../coupons/coupon-eligibility';
import {
  Coupon,
  CouponAccount,
  CouponAccountDocument,
  CouponDocument,
  CouponRedemption,
  CouponRedemptionDocument,
  CouponRedemptionStatus,
} from '../schemas/coupon.schema';
import { BillingAccount } from './billing-account.service';

export class CouponNotAvailable extends Error {
  constructor(readonly reason: string) {
    super(`Coupon not available: ${reason}`);
  }
}

// A coupon use is held while its order is unpaid (RESERVED), kept once paid
// (REDEEMED) and handed back otherwise (RELEASED). Counts include reservations,
// so the limits hold while customers are at the checkout (ADR §4.3).
// Each change runs in a transaction that also writes the coupon: concurrent
// orders conflict there, and the retry re-checks the limits.
@Injectable()
export class CouponReservationService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(Coupon.name)
    private readonly couponModel: Model<CouponDocument>,
    @InjectModel(CouponAccount.name)
    private readonly couponAccountModel: Model<CouponAccountDocument>,
    @InjectModel(CouponRedemption.name)
    private readonly redemptionModel: Model<CouponRedemptionDocument>,
  ) {}

  private async transaction(work: (session: ClientSession) => Promise<void>) {
    const session = await this.connection.startSession();
    try {
      await session.withTransaction(() => work(session));
    } finally {
      await session.endSession();
    }
  }

  /** Throws CouponNotAvailable when the account may no longer use it. */
  async reserve(input: {
    couponId: string;
    orderId: string;
    account: BillingAccount;
    discountMinor: number;
    until: Date;
  }) {
    const { couponId, orderId, account } = input;
    await this.transaction(async (session) => {
      const coupon = await this.couponModel
        .findById(couponId)
        .session(session)
        .lean();
      const claim = await this.couponAccountModel
        .findOne({ couponId, orgId: account.orgId }, { redemptions: 1 })
        .session(session)
        .lean();
      const result = coupon
        ? checkCouponEligibility(coupon, { ...account, claim }, new Date())
        : null;
      if (!result || 'reason' in result) {
        throw new CouponNotAvailable(
          result && 'reason' in result ? result.reason : 'UNKNOWN_CODE',
        );
      }
      await this.couponModel.updateOne(
        { _id: couponId },
        { $inc: { redemptionCount: 1, accountCount: claim ? 0 : 1 } },
        { session },
      );
      await this.couponAccountModel.updateOne(
        { couponId, orgId: account.orgId },
        { $inc: { redemptions: 1 } },
        { upsert: true, session },
      );
      await this.redemptionModel.create(
        [
          {
            couponId,
            code: coupon.code,
            orgId: account.orgId,
            orderId,
            status: CouponRedemptionStatus.RESERVED,
            discountMinor: input.discountMinor,
            reservedUntil: input.until,
          },
        ],
        { session },
      );
    });
  }

  /** The order was paid. A use released by an expired order is taken back. */
  async redeem(orderId: string) {
    await this.transaction(async (session) => {
      const redemption = await this.redemptionModel
        .findOne({ orderId })
        .session(session)
        .lean();
      if (
        !redemption ||
        redemption.status === CouponRedemptionStatus.REDEEMED
      ) {
        return;
      }
      if (redemption.status === CouponRedemptionStatus.RELEASED) {
        // Paid late, at the discounted price: count the use again, even past a limit.
        await this.count(redemption.couponId, redemption.orgId, 1, session);
        Logger.warn(
          `Coupon ${redemption.code} redeemed by late-paid order ${orderId} after release`,
          'CouponReservationService',
        );
      }
      await this.redemptionModel.updateOne(
        { _id: redemption._id },
        {
          $set: { status: CouponRedemptionStatus.REDEEMED },
          $unset: { reservedUntil: 1 },
        },
        { session },
      );
    });
  }

  /** The order ended unpaid: the use goes back to the account and the code. */
  async release(orderId: string) {
    await this.transaction(async (session) => {
      const redemption = await this.redemptionModel
        .findOneAndUpdate(
          { orderId, status: CouponRedemptionStatus.RESERVED },
          {
            $set: { status: CouponRedemptionStatus.RELEASED },
            $unset: { reservedUntil: 1 },
          },
          { session },
        )
        .lean();
      if (!redemption) return;
      await this.count(redemption.couponId, redemption.orgId, -1, session);
    });
  }

  private async count(
    couponId: string,
    orgId: string,
    by: 1 | -1,
    session: ClientSession,
  ) {
    const claim = await this.couponAccountModel
      .findOneAndUpdate(
        { couponId, orgId },
        { $inc: { redemptions: by } },
        { upsert: by === 1, new: true, session },
      )
      .lean();
    // An account holds a place in "first N accounts" only while it has a use.
    let accounts = 0;
    if (by === 1 && claim?.redemptions === 1) accounts = 1;
    if (by === -1 && claim && claim.redemptions <= 0) {
      await this.couponAccountModel.deleteOne({ _id: claim._id }, { session });
      accounts = -1;
    }
    await this.couponModel.updateOne(
      { _id: couponId },
      { $inc: { redemptionCount: by, accountCount: accounts } },
      { session },
    );
  }
}
