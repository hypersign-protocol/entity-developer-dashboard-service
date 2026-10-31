import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { redisClient } from 'src/utils/redis.provider';
import {
  BillingErrorCode,
  BillingRegion,
  REGION_TAX_MODE,
  TaxMode,
} from '../billing.constants';
import { BillingException, pricingException } from '../billing.exception';
import { checkCouponEligibility } from '../coupons/coupon-eligibility';
import { CreateQuoteDto } from '../dto/create-quote.dto';
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
} from '../schemas/coupon.schema';
import { Quote, QuoteDocument } from '../schemas/quote.schema';
import { indiaGst, supplierStateCode, TaxLine } from '../tax/india-gst';
import { BillingAccount } from './billing-account.service';
import { CatalogService } from './catalog.service';

const QUOTE_TTL_MS = 15 * 60 * 1000;
// Coupon guessing: at most this many rejected codes per account per window.
const COUPON_FAILURE_LIMIT = 10;
const COUPON_FAILURE_WINDOW_S = 10 * 60;

const couponInvalid = () =>
  new BillingException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    BillingErrorCode.COUPON_INVALID,
    'This coupon code is not valid.',
  );

@Injectable()
export class QuoteService {
  constructor(
    @InjectModel(Quote.name) private readonly quoteModel: Model<QuoteDocument>,
    @InjectModel(Coupon.name)
    private readonly couponModel: Model<CouponDocument>,
    @InjectModel(CouponAccount.name)
    private readonly couponAccountModel: Model<CouponAccountDocument>,
    private readonly catalogService: CatalogService,
  ) {}

  /** POST /billing/quotes (docs/payment/api-contract.md §3.3). */
  async create(
    account: BillingAccount,
    dto: CreateQuoteDto,
    createdBy: string,
  ) {
    const book = await this.catalogService.getPublishedBook(account.region);
    const selection: PricingSelection =
      dto.planCode !== undefined
        ? { planCode: dto.planCode }
        : { customAmountMinor: dto.customAmountMinor };
    const coupon = dto.couponCode
      ? await this.findUsableCoupon(account, dto.couponCode)
      : null;

    let priced;
    try {
      priced = priceSelection(book, selection, coupon);
    } catch (error) {
      if (!(error instanceof PricingError)) throw error;
      throw pricingException(error, book.custom);
    }

    const mode = REGION_TAX_MODE[account.region];
    let tax: { mode: TaxMode; amountMinor: number | null; lines: TaxLine[] };
    if (account.region === BillingRegion.IN) {
      tax = {
        mode,
        ...indiaGst(
          priced.totalBeforeTaxMinor,
          account.profile.gstStateCode,
          supplierStateCode(),
        ),
      };
    } else {
      tax = { mode, amountMinor: 0, lines: [] }; // Global: no tax
    }

    const addOns = book.addOns.map(({ code, title, priceMinor }) => ({
      code,
      title,
      priceMinor,
    }));
    const totalMinor = priced.totalBeforeTaxMinor + (tax.amountMinor ?? 0);
    const quote = await this.quoteModel.create({
      orgId: account.orgId,
      appId: dto.appId,
      createdBy,
      region: account.region,
      currency: account.currency,
      priceBookId: String(book._id),
      priceBookVersion: book.version,
      selection: {
        planCode: dto.planCode ?? null,
        customAmountMinor: dto.customAmountMinor ?? null,
        couponCode: coupon?.code ?? null,
      },
      lines: {
        subtotalMinor: priced.subtotalMinor,
        planDiscount: priced.planDiscount,
        coupon: priced.coupon && {
          couponId: String(coupon._id),
          ...priced.coupon,
        },
        addOns,
        totalBeforeTaxMinor: priced.totalBeforeTaxMinor,
        tax,
        totalMinor,
      },
      credits: priced.credits,
      validityDays: priced.validityDays,
      expiresAt: new Date(Date.now() + QUOTE_TTL_MS),
    });

    return {
      quoteId: String(quote._id),
      appId: quote.appId,
      region: quote.region,
      currency: quote.currency,
      priceBookVersion: quote.priceBookVersion,
      selection: quote.selection,
      subtotalMinor: priced.subtotalMinor,
      planDiscount: {
        percentBps: priced.planDiscount.percentBps,
        amountMinor: priced.planDiscount.amountMinor,
      },
      coupon: priced.coupon,
      addOns,
      totalBeforeTaxMinor: priced.totalBeforeTaxMinor,
      tax,
      totalMinor,
      credits: priced.credits,
      validityDays: priced.validityDays,
      billingProfileComplete: account.profile.complete,
      expiresAt: quote.expiresAt,
    };
  }

  /**
   * A typed or picked code the account may use now. Every rejection is the same
   * COUPON_INVALID, and rejections are rate-limited per account.
   */
  private async findUsableCoupon(account: BillingAccount, code: string) {
    const failuresKey = `billing:coupon-failures:${account.orgId}`;
    const failures = Number((await redisClient.get(failuresKey)) || 0);
    if (failures >= COUPON_FAILURE_LIMIT) {
      throw new BillingException(
        HttpStatus.TOO_MANY_REQUESTS,
        BillingErrorCode.RATE_LIMITED,
        'Too many coupon attempts. Please try again later.',
      );
    }

    const coupon = await this.couponModel.findOne({ code }).lean();
    const claim = coupon
      ? await this.couponAccountModel
          .findOne(
            { couponId: String(coupon._id), orgId: account.orgId },
            { redemptions: 1 },
          )
          .lean()
      : null;
    const result = coupon
      ? checkCouponEligibility(coupon, { ...account, claim }, new Date())
      : null;
    if (result && !('reason' in result)) return coupon;

    const count = await redisClient.incr(failuresKey);
    if (count === 1)
      await redisClient.expire(failuresKey, COUPON_FAILURE_WINDOW_S);
    Logger.log(
      `Coupon ${code} refused for ${account.orgId}: ${
        result && 'reason' in result ? result.reason : 'UNKNOWN_CODE'
      }`,
      'QuoteService',
    );
    throw couponInvalid();
  }
}
