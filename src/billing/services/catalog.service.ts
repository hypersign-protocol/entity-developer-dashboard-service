import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  BillingErrorCode,
  BillingRegion,
  isPayEnabled,
  REGION_TAX_MODE,
} from '../billing.constants';
import { BillingException } from '../billing.exception';
import {
  priceSelection,
  PricingBook,
  validityDaysOf,
} from '../pricing/pricing';
import {
  DiscountRuleType,
  PriceBook,
  PriceBookDocument,
  PriceBookStatus,
} from '../schemas/price-book.schema';
import { Coupon, CouponDocument, CouponStatus } from '../schemas/coupon.schema';
import { BillingAccount } from './billing-account.service';

export type PublishedPriceBook = PriceBook & { _id: unknown } & PricingBook;

@Injectable()
export class CatalogService {
  constructor(
    @InjectModel(PriceBook.name)
    private readonly priceBookModel: Model<PriceBookDocument>,
    @InjectModel(Coupon.name)
    private readonly couponModel: Model<CouponDocument>,
  ) {}

  async getPublishedBook(region: BillingRegion): Promise<PublishedPriceBook> {
    const book = await this.priceBookModel
      .findOne({ region, status: PriceBookStatus.PUBLISHED })
      .lean();
    if (!book) {
      Logger.error(`No published price book for ${region}`, 'CatalogService');
      throw new BillingException(
        HttpStatus.SERVICE_UNAVAILABLE,
        BillingErrorCode.BILLING_DISABLED,
        'Billing is not available for your region yet.',
      );
    }
    return book as PublishedPriceBook;
  }

  /** GET /billing/catalog (docs/payment/api-contract.md §3.1). */
  async getCatalog(account: BillingAccount) {
    const book = await this.getPublishedBook(account.region);
    const hasCoupons = await this.couponModel.exists({
      region: account.region,
      status: CouponStatus.ACTIVE,
    });

    const plans = book.plans
      .filter((plan) => plan.active)
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map((plan) => {
        const priced = priceSelection(book, { planCode: plan.code });
        return {
          code: plan.code,
          priceMinor: plan.priceMinor,
          discountBps: priced.planDiscount.percentBps,
          discountMinor: priced.planDiscount.amountMinor,
          totalBeforeTaxMinor: priced.totalBeforeTaxMinor,
          credits: priced.credits,
          displayOrder: plan.displayOrder,
        };
      });

    return {
      priceBookId: String(book._id),
      version: book.version,
      region: book.region,
      currency: book.currency,
      creditsPerMajorUnit: book.creditsPerMajorUnit,
      validityDays: validityDaysOf(book),
      taxMode: REGION_TAX_MODE[account.region],
      features: { coupons: !!hasCoupons, pay: isPayEnabled(account.region) },
      plans,
      custom: {
        enabled: book.custom.enabled,
        minMinor: book.custom.minMinor,
        maxMinor: book.custom.maxMinor,
        discountRanges: book.discountRules
          .filter((rule) => rule.type === DiscountRuleType.AMOUNT_RANGE)
          .sort((a, b) => (a.minMinor ?? 0) - (b.minMinor ?? 0))
          .map((rule) => ({
            minMinor: rule.minMinor,
            maxMinor: rule.maxMinor,
            discountBps: rule.percentBps,
          })),
      },
      addOns: book.addOns.map((addOn) => ({
        code: addOn.code,
        title: addOn.title,
        shortTitle: addOn.shortTitle,
        description: addOn.description,
        icon: addOn.icon,
        priceMinor: addOn.priceMinor,
        included: addOn.included,
      })),
      calculatorFlowIds: book.calculatorFlowIds,
    };
  }
}
