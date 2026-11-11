import { BillingException } from '../billing.exception';
import { BillingAccount } from './billing-account.service';
import { QuoteService } from './quote.service';

const redis = { get: jest.fn(), incr: jest.fn(), expire: jest.fn() };
// jest.mock is hoisted above `redis`, so the mock reads it lazily.
jest.mock('src/utils/redis.provider', () => ({
  redisClient: {
    get: (...args) => redis.get(...args),
    incr: (...args) => redis.incr(...args),
    expire: (...args) => redis.expire(...args),
  },
}));

const lean = (value) => ({ lean: jest.fn().mockResolvedValue(value) });

const indiaBook = {
  _id: 'pb-in',
  version: 1,
  region: 'IN',
  creditsPerMajorUnit: 1,
  custom: { enabled: true, minMinor: 99900, maxMinor: 999900 },
  plans: [
    { code: 'IN_2499', priceMinor: 249900, displayOrder: 1, active: true },
  ],
  discountRules: [
    {
      id: 'r',
      type: 'PLAN',
      planCode: 'IN_2499',
      percentBps: 2500,
      priority: 10,
    },
  ],
  addOns: [
    {
      code: 'VALIDITY',
      title: 'Credit validity',
      priceMinor: 0,
      config: { validityDays: 30 },
    },
  ],
};
const globalBook = {
  ...indiaBook,
  _id: 'pb-gl',
  region: 'GLOBAL',
  creditsPerMajorUnit: 90,
  custom: { enabled: true, minMinor: 9900, maxMinor: 149900 },
  plans: [{ code: 'GL_299', priceMinor: 29900, displayOrder: 1, active: true }],
  discountRules: [
    {
      id: 'g',
      type: 'PLAN',
      planCode: 'GL_299',
      percentBps: 4650,
      priority: 10,
    },
  ],
  addOns: [
    {
      code: 'VALIDITY',
      title: 'Credit validity',
      priceMinor: 0,
      config: { validityDays: 180 },
    },
  ],
};
const founding8 = {
  _id: 'c-8',
  code: 'FOUNDING8',
  region: 'IN',
  status: 'ACTIVE',
  percentBps: 800,
  eligibility: {
    requiresKybApproved: true,
    requiresTaxId: ['GSTIN', 'PAN'],
    withinDaysOfKybApproval: 180,
  },
  limits: { maxAccounts: 500, maxRedemptionsPerAccount: 3 },
  accountCount: 0,
  redemptionCount: 0,
};

const account = (overrides: Partial<BillingAccount> = {}): BillingAccount => ({
  orgId: 'org-1',
  ownerUserId: 'user-1',
  region: 'IN' as any,
  currency: 'INR' as any,
  kybStatus: 'Approved',
  kybApprovedAt: new Date(),
  taxIdTypes: ['GSTIN'],
  profile: { gstStateCode: '27', complete: true } as any,
  ...overrides,
});

describe('QuoteService', () => {
  const quoteModel = { create: jest.fn() };
  const couponModel = { findOne: jest.fn() };
  const couponAccountModel = { findOne: jest.fn() };
  const catalog = { getPublishedBook: jest.fn() };
  let service: QuoteService;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.BILLING_SUPPLIER_STATE_CODE = '29';
    redis.get.mockResolvedValue(null);
    redis.incr.mockResolvedValue(1);
    catalog.getPublishedBook.mockResolvedValue(indiaBook);
    couponModel.findOne.mockReturnValue(lean(founding8));
    couponAccountModel.findOne.mockReturnValue(lean(null));
    quoteModel.create.mockImplementation(async (doc) => ({
      _id: 'q-1',
      ...doc,
    }));
    service = new QuoteService(
      quoteModel as any,
      couponModel as any,
      couponAccountModel as any,
      catalog as any,
    );
  });

  it('prices ₹2,499 with FOUNDING8 and IGST to ₹2,034.69', async () => {
    const quote = await service.create(
      account(),
      { appId: 'app-1', planCode: 'IN_2499', couponCode: 'FOUNDING8' },
      'ops@acme.example',
    );
    expect(quote).toMatchObject({
      quoteId: 'q-1',
      currency: 'INR',
      subtotalMinor: 249900,
      planDiscount: { percentBps: 2500, amountMinor: 62475 },
      coupon: { code: 'FOUNDING8', percentBps: 800, amountMinor: 14994 },
      totalBeforeTaxMinor: 172431,
      tax: {
        mode: 'INCLUDED_IN_QUOTE',
        amountMinor: 31038,
        lines: [{ type: 'IGST', rateBps: 1800, amountMinor: 31038 }],
      },
      totalMinor: 203469,
      credits: 2499,
      validityDays: 30,
      billingProfileComplete: true,
      selection: {
        planCode: 'IN_2499',
        customAmountMinor: null,
        couponCode: 'FOUNDING8',
      },
    });
    expect(quoteModel.create.mock.calls[0][0]).toMatchObject({
      orgId: 'org-1',
      createdBy: 'ops@acme.example',
      priceBookVersion: 1,
      lines: { coupon: { couponId: 'c-8' } },
    });
  });

  it('splits CGST + SGST for a customer in our state', async () => {
    const quote = await service.create(
      account({ profile: { gstStateCode: '29', complete: true } as any }),
      { appId: 'app-1', planCode: 'IN_2499' },
      'u',
    );
    expect(quote.tax.lines.map((l) => l.type)).toEqual(['CGST', 'SGST']);
    expect(quote.totalMinor).toBe(187425 + quote.tax.amountMinor);
  });

  it('charges no tax for Global', async () => {
    catalog.getPublishedBook.mockResolvedValue(globalBook);
    const quote = await service.create(
      account({ region: 'GLOBAL' as any, currency: 'USD' as any }),
      { appId: 'app-1', planCode: 'GL_299' },
      'u',
    );
    expect(quote).toMatchObject({
      totalBeforeTaxMinor: 15996,
      tax: { mode: 'NONE', amountMinor: 0, lines: [] },
      totalMinor: 15996,
      credits: 26910,
      validityDays: 180,
    });
  });

  it.each([
    [
      'an unknown code',
      () => couponModel.findOne.mockReturnValue(lean(null)),
      {},
    ],
    ['an ineligible account', () => undefined, { taxIdTypes: [] }],
    [
      'a used-up coupon',
      () =>
        couponAccountModel.findOne.mockReturnValue(lean({ redemptions: 3 })),
      {},
    ],
  ])(
    'refuses %s with COUPON_INVALID and counts the failure',
    async (_, arrange, overrides: Partial<BillingAccount> = {}) => {
      arrange();
      await expect(
        service.create(
          account(overrides),
          { appId: 'app-1', planCode: 'IN_2499', couponCode: 'NOPE' },
          'u',
        ),
      ).rejects.toMatchObject({ code: 'COUPON_INVALID' });
      expect(redis.incr).toHaveBeenCalledWith('billing:coupon-failures:org-1');
      expect(redis.expire).toHaveBeenCalledWith(
        'billing:coupon-failures:org-1',
        600,
      );
      expect(quoteModel.create).not.toHaveBeenCalled();
    },
  );

  it('blocks coupon attempts after 10 failures', async () => {
    redis.get.mockResolvedValue('10');
    const error = await service
      .create(
        account(),
        { appId: 'app-1', planCode: 'IN_2499', couponCode: 'FOUNDING8' },
        'u',
      )
      .catch((e) => e);
    expect(error).toBeInstanceOf(BillingException);
    expect(error.getStatus()).toBe(429);
    expect(error.code).toBe('RATE_LIMITED');
    expect(couponModel.findOne).not.toHaveBeenCalled();
  });

  it('maps an out-of-range custom amount to AMOUNT_OUT_OF_RANGE with the limits', async () => {
    const error = await service
      .create(account(), { appId: 'app-1', customAmountMinor: 5000 }, 'u')
      .catch((e) => e);
    expect(error.code).toBe('AMOUNT_OUT_OF_RANGE');
    expect(error.getResponse().details).toEqual({
      minMinor: 99900,
      maxMinor: 999900,
    });
  });
});
