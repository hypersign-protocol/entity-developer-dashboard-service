import { Types } from 'mongoose';
import { OrderStatus } from '../schemas/order.schema';
import { PaymentLinkService } from './payment-link.service';

const lean = (value) => ({ lean: jest.fn().mockResolvedValue(value) });

const profile = {
  orgId: 'org-1',
  legalName: 'Acme',
  email: 'billing@acme.example',
  region: 'IN',
  currency: 'INR',
  complete: true,
};
const draft = {
  app: { appId: 'app-1', appName: 'Acme KYC' },
  org: { orgId: 'org-1', companyName: 'Acme' },
  profile,
  tax: [{ type: 'IGST', rateBps: 1800, amountMinor: 720000 }],
  totals: {
    subtotalMinor: 4000000,
    discountMinor: 0,
    taxableMinor: 4000000,
    taxMinor: 720000,
    totalMinor: 4720000,
  },
  addOnLines: [{ code: 'VALIDITY', title: 'Credit validity' }],
};
const dto = {
  appId: 'app-1',
  credits: 40000,
  validityDays: 30,
  amountMinor: 4000000,
  isPaid: false,
};
const orderId = new Types.ObjectId();

describe('PaymentLinkService', () => {
  const orderModel = {
    findOne: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
    findOneAndUpdate: jest.fn(),
    updateOne: jest.fn(),
  };
  const onboardingModel = { find: jest.fn() };
  const invoices = { paymentLinkDraft: jest.fn() };
  const orders = { nextOrderNumber: jest.fn(), sync: jest.fn() };
  const razorpay = {
    id: 'razorpay',
    isConfigured: jest.fn(),
    createPaymentLink: jest.fn(),
    cancelPaymentLink: jest.fn(),
    resendPaymentLink: jest.fn(),
  };
  const router = { forRegion: () => razorpay, get: () => razorpay };
  let service: PaymentLinkService;
  let stored;

  beforeEach(() => {
    jest.resetAllMocks();
    process.env.BILLING_PAY_ENABLED = 'true';
    invoices.paymentLinkDraft.mockResolvedValue(draft);
    orders.nextOrderNumber.mockResolvedValue('ORD-2026-000009');
    razorpay.isConfigured.mockReturnValue(true);
    razorpay.createPaymentLink.mockResolvedValue({
      linkId: 'plink_1',
      url: 'https://rzp.io/i/abc',
    });
    orderModel.findOne.mockReturnValue(lean(null));
    orderModel.create.mockImplementation(async (doc) => {
      stored = { _id: orderId, ...doc };
      return { toObject: () => stored };
    });
    orderModel.findOneAndUpdate.mockImplementation((_, update) => {
      const set = update.$set;
      return lean({
        ...stored,
        status: set.status ?? stored.status,
        paymentLink: {
          ...stored.paymentLink,
          linkId: set['paymentLink.linkId'] ?? stored.paymentLink.linkId,
          url: set['paymentLink.url'] ?? stored.paymentLink.url,
        },
      });
    });
    onboardingModel.find.mockReturnValue(lean([]));
    service = new PaymentLinkService(
      orderModel as any,
      onboardingModel as any,
      invoices as any,
      orders as any,
      router as any,
    );
  });
  afterEach(() => delete process.env.BILLING_PAY_ENABLED);

  it('creates an ADMIN order and a Razorpay link for the total with tax, no invoice', async () => {
    const result = await service.create(dto as any, 'sa-1', 'key-1');

    expect(orderModel.create.mock.calls[0][0]).toMatchObject({
      source: 'ADMIN',
      status: OrderStatus.CREATED,
      amountMinor: 4720000,
      createdBy: 'sa-1',
      quote: { credits: 40000, validityDays: 30 },
      paymentLink: { notifyByEmail: true, sentTo: 'billing@acme.example' },
    });
    expect(razorpay.createPaymentLink).toHaveBeenCalledWith(
      expect.objectContaining({
        amountMinor: 4720000,
        currency: 'INR',
        referenceId: String(orderId),
        customer: { name: 'Acme', email: 'billing@acme.example' },
        notifyByEmail: true,
      }),
    );
    expect(result).toMatchObject({
      invoice: null,
      paymentLink: {
        status: 'PENDING_PAYMENT',
        url: 'https://rzp.io/i/abc',
        totalMinor: 4720000,
      },
    });
  });

  it('only creates the link when the admin will copy it', async () => {
    await service.create(
      { ...dto, notifyByEmail: false } as any,
      'sa-1',
      'key-1',
    );
    expect(razorpay.createPaymentLink).toHaveBeenCalledWith(
      expect.objectContaining({ notifyByEmail: false }),
    );
    expect(orderModel.create.mock.calls[0][0].paymentLink.sentTo).toBeNull();
  });

  it('refuses where payments are off', async () => {
    delete process.env.BILLING_PAY_ENABLED;
    await expect(
      service.create(dto as any, 'sa-1', 'key-1'),
    ).rejects.toMatchObject({ code: 'PAYMENTS_NOT_AVAILABLE' });
    expect(orderModel.create).not.toHaveBeenCalled();
  });

  it('refuses a reused key with a different body', async () => {
    orderModel.findOne.mockReturnValue(
      lean({ _id: orderId, source: 'ADMIN', requestHash: 'other' }),
    );
    await expect(
      service.create(dto as any, 'sa-1', 'key-1'),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
  });

  it('answers 503 and keeps the order CREATED when Razorpay fails', async () => {
    razorpay.createPaymentLink.mockRejectedValue(new Error('timeout'));
    await expect(
      service.create(dto as any, 'sa-1', 'key-1'),
    ).rejects.toMatchObject({ code: 'PAYMENTS_UNAVAILABLE' });
    expect(orderModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  describe('cancel', () => {
    const pending = {
      _id: orderId,
      source: 'ADMIN',
      orgId: 'org-1',
      status: OrderStatus.PENDING_PAYMENT,
      provider: 'razorpay',
      paymentLink: { linkId: 'plink_1' },
      quote: { credits: 1, validityDays: 30, lines: { tax: {} } },
    };

    it('checks for a payment, cancels the link, then voids the order', async () => {
      orderModel.findOne.mockReturnValue(lean(pending));
      orderModel.findById.mockReturnValue(lean(pending));
      await service.cancel(String(orderId), 'sa-1', 'Paid by bank transfer');
      expect(orders.sync).toHaveBeenCalledWith(String(orderId));
      expect(razorpay.cancelPaymentLink).toHaveBeenCalledWith('plink_1');
      expect(orderModel.updateOne).toHaveBeenCalledWith(
        expect.objectContaining({ _id: orderId }),
        {
          $set: expect.objectContaining({
            status: 'CANCELLED',
            cancelledBy: 'sa-1',
            cancelReason: 'Paid by bank transfer',
          }),
        },
      );
    });

    it('refuses once the link has been paid', async () => {
      orderModel.findOne.mockReturnValue(lean(pending));
      orderModel.findById.mockReturnValue(
        lean({ ...pending, status: OrderStatus.FULFILLED }),
      );
      await expect(
        service.cancel(String(orderId), 'sa-1', 'x'),
      ).rejects.toMatchObject({ code: 'ORDER_NOT_CANCELLABLE' });
      expect(razorpay.cancelPaymentLink).not.toHaveBeenCalled();
    });
  });
});
