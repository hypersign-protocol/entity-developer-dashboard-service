import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { BillingErrorCode } from '../billing.constants';
import { BillingException } from '../billing.exception';
import { checkCouponEligibility } from '../coupons/coupon-eligibility';
import {
  priceSelection,
  PricingError,
  PricingSelection,
} from '../pricing/pricing';
import {
  Coupon,
  CouponAccount,
  CouponAccountDocument,
  CouponDocument,
  CouponStatus,
} from '../schemas/coupon.schema';
import { BillingAccount } from './billing-account.service';
import { CatalogService } from './catalog.service';

@Injectable()
export class CouponService {
  constructor(
    @InjectModel(Coupon.name)
    private readonly couponModel: Model<CouponDocument>,
    @InjectModel(CouponAccount.name)
    private readonly couponAccountModel: Model<CouponAccountDocument>,
    private readonly catalogService: CatalogService,
  ) {}

  /**
   * GET /billing/coupons (docs/payment/api-contract.md §3.2): listed coupons
   * the account can use now. Never returns unlisted codes or the rules.
   */
  async listEligible(account: BillingAccount, selection?: PricingSelection) {
    const coupons = await this.couponModel
      .find({
        region: account.region,
        status: CouponStatus.ACTIVE,
        listed: true,
      })
      .lean();
    if (!coupons.length) return { coupons: [] };

    const claims = await this.couponAccountModel
      .find(
        {
          orgId: account.orgId,
          couponId: { $in: coupons.map((c) => String(c._id)) },
        },
        { couponId: 1, redemptions: 1 },
      )
      .lean();
    const claimOf = new Map(claims.map((c) => [c.couponId, c]));
    const book = selection
      ? await this.catalogService.getPublishedBook(account.region)
      : null;
    const now = new Date();

    const eligible = [];
    for (const coupon of coupons) {
      const result = checkCouponEligibility(
        coupon,
        { ...account, claim: claimOf.get(String(coupon._id)) },
        now,
      );
      if ('reason' in result) continue;

      let previewDiscountMinor: number | null = null;
      if (book) {
        try {
          previewDiscountMinor = priceSelection(book, selection, coupon).coupon
            .amountMinor;
        } catch (error) {
          if (!(error instanceof PricingError)) throw error;
          throw new BillingException(
            HttpStatus.UNPROCESSABLE_ENTITY,
            BillingErrorCode[error.code],
            error.message,
            error.code === 'AMOUNT_OUT_OF_RANGE'
              ? {
                  minMinor: book.custom.minMinor,
                  maxMinor: book.custom.maxMinor,
                }
              : undefined,
          );
        }
      }

      eligible.push({
        code: coupon.code,
        title: coupon.title,
        description: coupon.description,
        percentBps: coupon.percentBps,
        maxDiscountMinor: coupon.maxDiscountMinor ?? null,
        previewDiscountMinor,
        usesLeft: result.usesLeft,
        expiresAt: result.expiresAt,
      });
    }
    return { coupons: eligible };
  }
}
