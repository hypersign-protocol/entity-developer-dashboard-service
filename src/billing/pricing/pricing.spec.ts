import { applyBps, priceSelection, PricingBook, PricingError } from './pricing';

const rules = (prefix: string, tiers: [number, number][], maxMinor: number) =>
  tiers.flatMap(([priceMinor, percentBps], i) => [
    {
      id: `${prefix}_PLAN_${priceMinor}`,
      type: 'PLAN' as const,
      planCode: `${prefix}_${priceMinor / 100}`,
      percentBps,
      priority: 10,
    },
    {
      id: `${prefix}_RANGE_${priceMinor}`,
      type: 'AMOUNT_RANGE' as const,
      minMinor: priceMinor,
      maxMinor: i + 1 < tiers.length ? tiers[i + 1][0] - 1 : maxMinor,
      percentBps,
      priority: 0,
    },
  ]);

const book = (
  prefix: string,
  tiers: [number, number][],
  creditsPerMajorUnit: number,
  validityDays: number,
): PricingBook => {
  const maxMinor = tiers[tiers.length - 1][0];
  return {
    creditsPerMajorUnit,
    custom: { enabled: true, minMinor: tiers[0][0], maxMinor },
    plans: tiers.map(([priceMinor], i) => ({
      code: `${prefix}_${priceMinor / 100}`,
      priceMinor,
      displayOrder: i + 1,
      active: true,
    })),
    discountRules: rules(prefix, tiers, maxMinor),
    addOns: [{ code: 'VALIDITY', config: { validityDays } }],
  };
};

// The agreed model (ADR §1).
const india = book(
  'IN',
  [
    [99900, 1000],
    [249900, 2500],
    [499900, 2800],
    [999900, 3500],
  ],
  1,
  30,
);
const global = book(
  'GL',
  [
    [9900, 0],
    [19900, 4000],
    [29900, 4650],
    [49900, 5200],
    [149900, 5500],
  ],
  90,
  180,
);

describe('pricing', () => {
  it('rounds half-up', () => {
    expect(applyBps(29900, 4650)).toBe(13904); // 13903.5
    expect(applyBps(15996, 1500)).toBe(2399); // 2399.4
  });

  it('₹2,499 with FOUNDING8 costs ₹1,724.31 for 2,499 credits', () => {
    const priced = priceSelection(
      india,
      { planCode: 'IN_2499' },
      { code: 'FOUNDING8', percentBps: 800 },
    );
    expect(priced).toEqual({
      subtotalMinor: 249900,
      planDiscount: {
        percentBps: 2500,
        amountMinor: 62475,
        ruleId: 'IN_PLAN_249900',
      },
      coupon: { code: 'FOUNDING8', percentBps: 800, amountMinor: 14994 },
      totalBeforeTaxMinor: 172431,
      credits: 2499,
      validityDays: 30,
    });
  });

  it('$299 with FOUNDING15 costs $135.97 for 26,910 credits', () => {
    const priced = priceSelection(
      global,
      { planCode: 'GL_299' },
      { code: 'FOUNDING15', percentBps: 1500 },
    );
    expect(priced.planDiscount.amountMinor).toBe(13904);
    expect(priced.coupon.amountMinor).toBe(2399);
    expect(priced.totalBeforeTaxMinor).toBe(13597);
    expect(priced.credits).toBe(26910);
    expect(priced.validityDays).toBe(180);
  });

  it('$1,499 buys 134,910 credits for $674.55', () => {
    const priced = priceSelection(global, { planCode: 'GL_1499' });
    expect(priced.totalBeforeTaxMinor).toBe(67455);
    expect(priced.credits).toBe(134910);
    expect(priced.coupon).toBeNull();
  });

  it('gives a custom amount the discount of the plan below it', () => {
    expect(
      priceSelection(india, { customAmountMinor: 320000 }).planDiscount,
    ).toEqual({
      percentBps: 2500,
      amountMinor: 80000,
      ruleId: 'IN_RANGE_249900',
    });
    expect(
      priceSelection(global, { customAmountMinor: 35000 }).planDiscount
        .percentBps,
    ).toBe(4650);
    expect(
      priceSelection(india, { customAmountMinor: 999900 }).planDiscount
        .percentBps,
    ).toBe(3500);
  });

  it('caps the coupon at maxDiscountMinor', () => {
    const priced = priceSelection(
      india,
      { planCode: 'IN_9999' },
      { code: 'X', percentBps: 1000, maxDiscountMinor: 5000 },
    );
    expect(priced.coupon.amountMinor).toBe(5000);
  });

  it.each([
    [{ customAmountMinor: 99800 }],
    [{ customAmountMinor: 1000000 }],
    [{ customAmountMinor: 150050 }],
  ])('refuses custom amount %j', (selection) => {
    expect(() => priceSelection(india, selection)).toThrow(
      expect.objectContaining({ code: 'AMOUNT_OUT_OF_RANGE' }),
    );
  });

  it('refuses an unknown or inactive plan', () => {
    const withInactive = {
      ...india,
      plans: india.plans.map((p) => ({ ...p, active: p.code !== 'IN_999' })),
    };
    expect(() => priceSelection(withInactive, { planCode: 'IN_999' })).toThrow(
      PricingError,
    );
    expect(() => priceSelection(india, { planCode: 'GL_299' })).toThrow(
      PricingError,
    );
  });
});
