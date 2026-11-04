import { Types } from 'mongoose';
import { OrderStatus } from '../schemas/order.schema';
import { CouponNotAvailable } from './coupon-reservation.service';
import { OrderService } from './order.service';

const redis = { set: jest.fn(), del: jest.fn() };
// jest.mock is hoisted above `redis`, so the mock reads it lazily.
jest.mock('src/utils/redis.provider', () => ({
  redisClient: {
    set: (...args) => redis.set(...args),
    del: (...args) => redis.del(...args),
  },
}));

const lean = (value) => ({ lean: jest.fn().mockResolvedValue(value) });

const profile = {
  orgId: 'org-1',
  legalName: 'Acme',
  email: 'billing@acme.example',
  gstStateCode: '27',
  region: 'IN',
  currency: 'INR',
  complete: true,
  missingFields: [],
  source: 'SAVED',
};
const account = {
  orgId: 'org-1',
  ownerUserId: 'owner-1',
  region: 'IN',
  currency: 'INR',
  kybStatus: 'Approved',
  taxIdTypes: ['GSTIN'],
  profile,
} as any;
// ₹2,499 plan with FOUNDING8: ₹1,724.31 + IGST ₹310.38 = ₹2,034.69.
const quoteLines = {
  subtotalMinor: 249900,
  planDiscount: { percentBps: 2500, amountMinor: 62475, ruleId: 'r' },
  coupon: {
    couponId: 'coupon-1',
    code: 'FOUNDING8',
    percentBps: 800,
    amountMinor: 14994,
  },
  addOns: [],
  totalBeforeTaxMinor: 172431,
  tax: { mode: 'INCLUDED_IN_QUOTE', amountMinor: 31038, lines: [] },
  totalMinor: 203469,
};
const quoteId = new Types.ObjectId().toHexString();
const quote = (overrides = {}) => ({
  _id: quoteId,
  orgId: 'org-1',
  appId: 'app-1',
  region: 'IN',
  priceBookId: 'pb-in',
  priceBookVersion: 1,
  selection: { planCode: 'IN_2499' },
  lines: quoteLines,
  credits: 2499,
  validityDays: 30,
  expiresAt: new Date(Date.now() + 60_000),
  ...overrides,
});
const orderId = new Types.ObjectId();
const order = (overrides = {}) => ({
  _id: orderId,
  orderNumber: 'ORD-2026-000001',
  orgId: 'org-1',
  appId: 'app-1',
  appName: 'Acme KYC',
  createdBy: 'owner@acme.example',
  idempotencyKey: 'key-1',
  quoteId,
  quote: { lines: quoteLines, credits: 2499, validityDays: 30 },
  customer: profile,
  tax: [{ type: 'IGST', rateBps: 1800, amountMinor: 31038 }],
  region: 'IN',
  currency: 'INR',
  amountMinor: 203469,
  status: OrderStatus.PENDING_PAYMENT,
  provider: 'razorpay',
  providerOrderId: 'order_rzp_1',
  expiresAt: new Date(Date.now() + 60_000),
  lastSyncedAt: null,
  payment: null,
  ...overrides,
});
const payment = (overrides = {}) => ({
  paymentId: 'pay_1',
  status: 'CAPTURED',
  amountMinor: 203469,
  currency: 'INR',
  method: 'upi',
  international: false,
  errorCode: null,
  errorDescription: null,
  createdAt: new Date(),
  ...overrides,
});

describe('OrderService', () => {
  const orderModel = {
    findOne: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
    updateOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    find: jest.fn(),
  };
  const attemptModel = { bulkWrite: jest.fn() };
  const quoteModel = { findOne: jest.fn() };
  const counterModel = { findOneAndUpdate: jest.fn() };
  const accounts = { assertBillableApp: jest.fn() };
  const catalog = { getPublishedBook: jest.fn() };
  const coupons = { reserve: jest.fn(), redeem: jest.fn(), release: jest.fn() };
  const invoices = { assertConfigured: jest.fn(), issueForOrder: jest.fn() };
  const razorpay = {
    id: 'razorpay',
    isConfigured: jest.fn(),
    createOrder: jest.fn(),
    checkoutOptions: jest.fn(),
    verifyCheckout: jest.fn(),
    fetchPayments: jest.fn(),
    capture: jest.fn(),
    fetchPaymentLink: jest.fn(),
  };
  const router = { forRegion: () => razorpay, get: () => razorpay };
  let service: OrderService;

  beforeEach(() => {
    jest.resetAllMocks();
    process.env.BILLING_SUPPLIER_STATE_CODE = '29';
    redis.set.mockResolvedValue('OK');
    razorpay.isConfigured.mockReturnValue(true);
    razorpay.createOrder.mockResolvedValue({ providerOrderId: 'order_rzp_1' });
    razorpay.checkoutOptions.mockImplementation((o) => ({
      provider: 'razorpay',
      keyId: 'rzp_test_key',
      ...o,
    }));
    orderModel.findOne.mockReturnValue(lean(null));
    orderModel.create.mockImplementation(async (doc) => ({
      toObject: () => doc,
    }));
    orderModel.findOneAndUpdate.mockImplementation((filter, update) =>
      lean({ ...order(), ...update.$set }),
    );
    orderModel.updateOne.mockResolvedValue({ modifiedCount: 1 });
    quoteModel.findOne.mockReturnValue(lean(quote()));
    catalog.getPublishedBook.mockResolvedValue({ _id: 'pb-in' });
    accounts.assertBillableApp.mockResolvedValue({
      appId: 'app-1',
      appName: 'Acme KYC',
    });
    counterModel.findOneAndUpdate.mockResolvedValue({ seq: 1 });
    attemptModel.bulkWrite.mockResolvedValue({});
    invoices.issueForOrder.mockResolvedValue({
      invoice: {
        _id: 'inv-1',
        invoiceNumber: 'HS/IN/2026-27/000124',
        creditPlanId: 'plan-1',
      },
      creditsActive: 'IMMEDIATELY',
    });
    service = new OrderService(
      orderModel as any,
      attemptModel as any,
      quoteModel as any,
      counterModel as any,
      accounts as any,
      catalog as any,
      coupons as any,
      invoices as any,
      router as any,
    );
  });

  describe('create', () => {
    it('reserves the coupon, creates the Razorpay order and returns the checkout', async () => {
      const result = await service.create(
        account,
        quoteId,
        'owner@acme.example',
        'key-1',
      );

      const stored = orderModel.create.mock.calls[0][0];
      expect(stored).toMatchObject({
        orderNumber: expect.stringMatching(/^ORD-\d{4}-000001$/),
        status: OrderStatus.CREATED,
        amountMinor: 203469,
        tax: [{ type: 'IGST', rateBps: 1800, amountMinor: 31038 }],
        provider: 'razorpay',
      });
      expect(coupons.reserve).toHaveBeenCalledWith(
        expect.objectContaining({ couponId: 'coupon-1', discountMinor: 14994 }),
      );
      expect(razorpay.createOrder).toHaveBeenCalledWith({
        amountMinor: 203469,
        currency: 'INR',
        receipt: stored.orderNumber,
        notes: expect.objectContaining({ orgId: 'org-1', appId: 'app-1' }),
      });
      expect(result).toMatchObject({
        status: OrderStatus.PENDING_PAYMENT,
        totalMinor: 203469,
        checkout: {
          provider: 'razorpay',
          keyId: 'rzp_test_key',
          providerOrderId: 'order_rzp_1',
          amountMinor: 203469,
          currency: 'INR',
          prefill: { name: 'Acme', email: 'billing@acme.example' },
        },
      });
    });

    it('returns the same order for a retried key, without a second Razorpay order', async () => {
      orderModel.findOne.mockReturnValue(lean(order()));
      const result = await service.create(account, quoteId, 'u', 'key-1');
      expect(result.orderId).toBe(String(orderId));
      expect(orderModel.create).not.toHaveBeenCalled();
      expect(razorpay.createOrder).not.toHaveBeenCalled();
    });

    it('refuses a reused key for another quote', async () => {
      orderModel.findOne.mockReturnValue(lean(order({ quoteId: 'other' })));
      await expect(
        service.create(account, quoteId, 'u', 'key-1'),
      ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    });

    it.each([
      ['an expired quote', { expiresAt: new Date(Date.now() - 1) }],
      ['a quote from an older price book', { priceBookId: 'pb-old' }],
      [
        'a total that no longer matches',
        { lines: { ...quoteLines, totalMinor: 200000 } },
      ],
    ])('asks for a new quote after %s', async (_, overrides) => {
      quoteModel.findOne.mockReturnValue(lean(quote(overrides)));
      await expect(
        service.create(account, quoteId, 'u', 'key-1'),
      ).rejects.toMatchObject({ code: 'QUOTE_EXPIRED' });
      expect(orderModel.create).not.toHaveBeenCalled();
    });

    it('fails the order when the coupon is no longer available', async () => {
      coupons.reserve.mockRejectedValue(
        new CouponNotAvailable('USES_EXHAUSTED'),
      );
      await expect(
        service.create(account, quoteId, 'u', 'key-1'),
      ).rejects.toMatchObject({ code: 'COUPON_INVALID' });
      expect(orderModel.updateOne).toHaveBeenCalledWith(expect.anything(), {
        $set: { status: 'FAILED', failureReason: 'COUPON_INVALID' },
      });
      expect(razorpay.createOrder).not.toHaveBeenCalled();
    });

    it('keeps the order CREATED and answers 503 when Razorpay is down', async () => {
      razorpay.createOrder.mockRejectedValue(new Error('timeout'));
      await expect(
        service.create(account, quoteId, 'u', 'key-1'),
      ).rejects.toMatchObject({ code: 'PAYMENTS_UNAVAILABLE' });
      expect(orderModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('refuses without Razorpay keys or complete billing details', async () => {
      razorpay.isConfigured.mockReturnValue(false);
      await expect(
        service.create(account, quoteId, 'u', 'key-1'),
      ).rejects.toMatchObject({ code: 'PAYMENTS_UNAVAILABLE' });

      razorpay.isConfigured.mockReturnValue(true);
      await expect(
        service.create(
          { ...account, profile: { ...profile, complete: false } },
          quoteId,
          'u',
          'key-1',
        ),
      ).rejects.toMatchObject({ code: 'BILLING_PROFILE_INCOMPLETE' });
    });
  });

  describe('confirm', () => {
    it('refuses a checkout proof that fails verification, without syncing', async () => {
      orderModel.findOne.mockReturnValue(lean(order()));
      razorpay.verifyCheckout.mockReturnValue(false);
      await expect(
        service.confirm('org-1', String(orderId), {
          providerOrderId: 'order_rzp_1',
          paymentId: 'pay_1',
          signature: 'bad',
        }),
      ).rejects.toMatchObject({ code: 'PAYMENT_VERIFICATION_FAILED' });
      expect(razorpay.fetchPayments).not.toHaveBeenCalled();
    });

    it('checks the signature against our provider order id', async () => {
      orderModel.findOne.mockReturnValue(lean(order()));
      await expect(
        service.confirm('org-1', String(orderId), {
          providerOrderId: 'order_someone_else',
          paymentId: 'pay_1',
          signature: 'sig',
        }),
      ).rejects.toMatchObject({ code: 'PAYMENT_VERIFICATION_FAILED' });
      expect(razorpay.verifyCheckout).not.toHaveBeenCalled();
    });
  });

  describe('sync', () => {
    const syncWith = async (current, payments) => {
      orderModel.findById.mockReturnValue(lean(current));
      razorpay.fetchPayments.mockResolvedValue(payments);
      await service.sync(String(orderId));
    };

    it('fulfils a captured payment: invoice, coupon, then FULFILLED', async () => {
      await syncWith(order(), [payment()]);

      expect(orderModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: orderId, status: { $in: expect.any(Array) } },
        {
          $set: expect.objectContaining({
            status: 'PAID',
            payment: expect.objectContaining({ paymentId: 'pay_1' }),
          }),
        },
        { new: true },
      );
      expect(invoices.issueForOrder).toHaveBeenCalled();
      expect(coupons.redeem).toHaveBeenCalledWith(String(orderId));
      expect(orderModel.updateOne).toHaveBeenCalledWith(
        { _id: orderId, status: 'PAID' },
        {
          $set: expect.objectContaining({
            status: 'FULFILLED',
            invoiceNumber: 'HS/IN/2026-27/000124',
            creditPlanId: 'plan-1',
          }),
        },
      );
      expect(redis.del).toHaveBeenCalledWith(`billing:order-sync:${orderId}`);
    });

    it('holds a payment of the wrong amount for review, with no credits', async () => {
      await syncWith(order(), [payment({ amountMinor: 100 })]);
      expect(orderModel.updateOne).toHaveBeenCalledWith(expect.anything(), {
        $set: expect.objectContaining({
          status: 'NEEDS_REVIEW',
          failureReason: 'AMOUNT_MISMATCH',
        }),
      });
      expect(invoices.issueForOrder).not.toHaveBeenCalled();
    });

    it('captures an authorized payment', async () => {
      razorpay.capture.mockResolvedValue(payment());
      await syncWith(order(), [payment({ status: 'AUTHORIZED' })]);
      expect(razorpay.capture).toHaveBeenCalled();
      expect(invoices.issueForOrder).toHaveBeenCalled();
    });

    it('expires an unpaid order past its time and frees the coupon', async () => {
      await syncWith(order({ expiresAt: new Date(Date.now() - 1) }), [
        payment({
          status: 'FAILED',
          errorCode: 'BAD_REQUEST_ERROR',
          errorDescription: 'Payment declined',
        }),
      ]);
      expect(orderModel.updateOne).toHaveBeenCalledWith(
        { _id: orderId, status: 'PENDING_PAYMENT' },
        {
          $set: expect.objectContaining({
            status: 'EXPIRED',
            lastPaymentError: {
              code: 'BAD_REQUEST_ERROR',
              description: 'Payment declined',
            },
          }),
        },
      );
      expect(coupons.release).toHaveBeenCalledWith(String(orderId));
    });

    it('keeps an expired order open while a payment is still in progress', async () => {
      await syncWith(order({ expiresAt: new Date(Date.now() - 1) }), [
        payment({ status: 'CREATED' }),
      ]);
      expect(coupons.release).not.toHaveBeenCalled();
      expect(orderModel.updateOne).toHaveBeenCalledWith(
        { _id: orderId },
        { $set: expect.not.objectContaining({ status: expect.anything() }) },
      );
    });

    it('still fulfils money that arrives after the order expired', async () => {
      await syncWith(order({ status: OrderStatus.EXPIRED }), [payment()]);
      expect(invoices.issueForOrder).toHaveBeenCalled();
    });

    it('leaves the order PAID when fulfilment fails, for the job to retry', async () => {
      invoices.issueForOrder.mockRejectedValue(new Error('redis down'));
      await syncWith(order(), [payment()]);
      expect(orderModel.updateOne).not.toHaveBeenCalledWith(expect.anything(), {
        $set: expect.objectContaining({ status: 'FULFILLED' }),
      });
    });

    it('pays a link through the Razorpay order behind it', async () => {
      razorpay.fetchPaymentLink.mockResolvedValue({
        status: 'PAID',
        providerOrderId: 'order_link_1',
      });
      await syncWith(
        order({
          source: 'ADMIN',
          providerOrderId: undefined,
          paymentLink: { linkId: 'plink_1' },
        }),
        [payment()],
      );
      expect(razorpay.fetchPayments).toHaveBeenCalledWith('order_link_1');
      expect(orderModel.updateOne).toHaveBeenCalledWith(
        { _id: orderId },
        { $set: { providerOrderId: 'order_link_1' } },
      );
      expect(invoices.issueForOrder).toHaveBeenCalled();
    });

    it('expires a link Razorpay expired before anyone paid', async () => {
      razorpay.fetchPaymentLink.mockResolvedValue({
        status: 'EXPIRED',
        providerOrderId: null,
      });
      await syncWith(
        order({
          source: 'ADMIN',
          providerOrderId: undefined,
          paymentLink: { linkId: 'plink_1' },
        }),
        [],
      );
      expect(razorpay.fetchPayments).not.toHaveBeenCalled();
      expect(orderModel.updateOne).toHaveBeenCalledWith(
        { _id: orderId, status: 'PENDING_PAYMENT' },
        { $set: expect.objectContaining({ status: 'EXPIRED' }) },
      );
    });

    it('does nothing while another sync holds the order', async () => {
      redis.set.mockResolvedValue(null);
      await syncWith(order(), [payment()]);
      expect(razorpay.fetchPayments).not.toHaveBeenCalled();
    });
  });
});
