// Pure pricing (ADR §4.4). Integers only: money in minor units, percentages in
// basis points. Each step rounds half-up to a whole minor unit, and a coupon
// applies after the plan discount.

export interface PricingPlan {
  code: string;
  priceMinor: number;
  displayOrder: number;
  active: boolean;
}

export interface PricingRule {
  id: string;
  type: 'PLAN' | 'AMOUNT_RANGE';
  planCode?: string;
  minMinor?: number;
  maxMinor?: number;
  percentBps: number;
  priority: number;
}

export interface PricingBook {
  creditsPerMajorUnit: number;
  custom: { enabled: boolean; minMinor: number; maxMinor: number };
  plans: PricingPlan[];
  discountRules: PricingRule[];
  addOns: { code: string; config?: { validityDays?: number } }[];
}

export type PricingSelection =
  | { planCode: string; customAmountMinor?: undefined }
  | { planCode?: undefined; customAmountMinor: number };

export interface PricingCoupon {
  code: string;
  percentBps: number;
  maxDiscountMinor?: number;
}

export interface PricedSelection {
  subtotalMinor: number;
  planDiscount: {
    percentBps: number;
    amountMinor: number;
    ruleId: string | null;
  };
  coupon: { code: string; percentBps: number; amountMinor: number } | null;
  totalBeforeTaxMinor: number;
  credits: number;
  validityDays: number;
}

export class PricingError extends Error {
  constructor(
    readonly code: 'PLAN_NOT_FOUND' | 'AMOUNT_OUT_OF_RANGE',
    message: string,
  ) {
    super(message);
  }
}

/** amount × bps / 10000, rounded half-up. */
export const applyBps = (amountMinor: number, bps: number): number =>
  Math.floor((amountMinor * bps + 5000) / 10000);

/** Highest-priority rule matching the selection; the first one wins a tie. */
export function findDiscountRule(
  book: PricingBook,
  subtotalMinor: number,
  planCode?: string,
): PricingRule | null {
  let best: PricingRule | null = null;
  for (const rule of book.discountRules) {
    const matches =
      rule.type === 'PLAN'
        ? !!planCode && rule.planCode === planCode
        : subtotalMinor >= (rule.minMinor ?? 0) &&
          subtotalMinor <= (rule.maxMinor ?? Number.MAX_SAFE_INTEGER);
    if (matches && (!best || rule.priority > best.priority)) best = rule;
  }
  return best;
}

export function validityDaysOf(book: PricingBook): number {
  const days = book.addOns.find((a) => a.code === 'VALIDITY')?.config
    ?.validityDays;
  if (!Number.isSafeInteger(days) || days <= 0) {
    throw new Error('Price book has no VALIDITY add-on with validityDays');
  }
  return days;
}

export function priceSelection(
  book: PricingBook,
  selection: PricingSelection,
  coupon?: PricingCoupon | null,
): PricedSelection {
  let subtotalMinor: number;
  let planCode: string | undefined;
  if (selection.planCode !== undefined) {
    const plan = book.plans.find(
      (p) => p.active && p.code === selection.planCode,
    );
    if (!plan) {
      throw new PricingError(
        'PLAN_NOT_FOUND',
        'This plan is no longer available.',
      );
    }
    subtotalMinor = plan.priceMinor;
    planCode = plan.code;
  } else {
    const amount = selection.customAmountMinor;
    const { enabled, minMinor, maxMinor } = book.custom;
    if (
      !enabled ||
      !Number.isSafeInteger(amount) ||
      amount % 100 !== 0 ||
      amount < minMinor ||
      amount > maxMinor
    ) {
      throw new PricingError(
        'AMOUNT_OUT_OF_RANGE',
        'Enter a whole amount within the allowed range.',
      );
    }
    subtotalMinor = amount;
  }

  const rule = findDiscountRule(book, subtotalMinor, planCode);
  const planDiscountMinor = rule ? applyBps(subtotalMinor, rule.percentBps) : 0;
  const afterPlan = subtotalMinor - planDiscountMinor;

  let couponLine: PricedSelection['coupon'] = null;
  if (coupon) {
    let amountMinor = applyBps(afterPlan, coupon.percentBps);
    if (
      coupon.maxDiscountMinor !== undefined &&
      coupon.maxDiscountMinor !== null
    ) {
      amountMinor = Math.min(amountMinor, coupon.maxDiscountMinor);
    }
    couponLine = {
      code: coupon.code,
      percentBps: coupon.percentBps,
      amountMinor,
    };
  }

  return {
    subtotalMinor,
    planDiscount: {
      percentBps: rule?.percentBps ?? 0,
      amountMinor: planDiscountMinor,
      ruleId: rule?.id ?? null,
    },
    coupon: couponLine,
    totalBeforeTaxMinor: afterPlan - (couponLine?.amountMinor ?? 0),
    // Credits follow the price before any discount.
    credits: Math.floor((subtotalMinor * book.creditsPerMajorUnit) / 100),
    validityDays: validityDaysOf(book),
  };
}
