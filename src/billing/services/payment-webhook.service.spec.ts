import { Types } from 'mongoose';
import { BillingErrorCode } from '../billing.constants';
import { WebhookEventStatus } from '../schemas/webhook-event.schema';
import { PaymentWebhookService } from './payment-webhook.service';

const lean = (value) => ({ lean: jest.fn().mockResolvedValue(value) });
const flush = () => new Promise((done) => setImmediate(done));

const orderId = new Types.ObjectId();
const eventDocId = new Types.ObjectId();
const rawBody = Buffer.from('{}');
const paidLink = {
  type: 'payment_link.paid',
  relevant: true,
  linkId: 'plink_1',
  providerOrderIds: ['order_9'],
  orderId: null,
};
const delivery = (overrides = {}) => ({
  rawBody,
  signature: 'sig',
  eventId: 'evt_1',
  body: { event: 'payment_link.paid' },
  ...overrides,
});

describe('PaymentWebhookService', () => {
  const eventModel = {
    create: jest.fn(),
    findOneAndUpdate: jest.fn(),
    updateOne: jest.fn(),
  };
  const orderModel = { findOne: jest.fn() };
  const orders = { sync: jest.fn() };
  const razorpay = {
    id: 'razorpay',
    webhooksConfigured: jest.fn(),
    verifyWebhook: jest.fn(),
    parseWebhook: jest.fn(),
  };
  const router = {
    get: (id: string) => {
      if (id !== 'razorpay') throw new Error(`Unknown payment provider ${id}`);
      return razorpay;
    },
  };
  let service: PaymentWebhookService;

  const statusSet = () =>
    eventModel.updateOne.mock.calls
      .map(([, update]) => update.$set.status)
      .filter(Boolean);

  beforeEach(() => {
    jest.resetAllMocks();
    razorpay.webhooksConfigured.mockReturnValue(true);
    razorpay.verifyWebhook.mockReturnValue(true);
    razorpay.parseWebhook.mockReturnValue(paidLink);
    eventModel.create.mockImplementation(async (doc) => ({
      toObject: () => ({ _id: eventDocId, ...doc }),
    }));
    orderModel.findOne.mockReturnValue(lean({ _id: orderId }));
    orders.sync.mockResolvedValue(true);
    service = new PaymentWebhookService(
      eventModel as any,
      orderModel as any,
      orders as any,
      router as any,
    );
  });

  it('answers 503 and does nothing when webhooks are not configured', async () => {
    razorpay.webhooksConfigured.mockReturnValue(false);
    await expect(service.receive('razorpay', delivery())).rejects.toMatchObject(
      { status: 503 },
    );
    expect(eventModel.create).not.toHaveBeenCalled();
    expect(orders.sync).not.toHaveBeenCalled();
  });

  it('refuses a bad signature or a missing raw body', async () => {
    razorpay.verifyWebhook.mockReturnValue(false);
    await expect(service.receive('razorpay', delivery())).rejects.toMatchObject(
      {
        status: 400,
        code: BillingErrorCode.PAYMENT_VERIFICATION_FAILED,
      },
    );
    razorpay.verifyWebhook.mockReturnValue(true);
    await expect(
      service.receive('razorpay', delivery({ rawBody: undefined })),
    ).rejects.toMatchObject({ status: 400 });
    expect(orders.sync).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown provider', async () => {
    await expect(service.receive('stripe', delivery())).rejects.toMatchObject({
      status: 404,
    });
  });

  it('records the event, answers, then syncs the order behind the link', async () => {
    const result = await service.receive('razorpay', delivery());
    expect(result).toEqual({ received: true, status: 'RECEIVED' });
    expect(eventModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'razorpay',
        eventId: 'evt_1',
        type: 'payment_link.paid',
        attempts: 1,
      }),
    );
    expect(orderModel.findOne).toHaveBeenCalledWith(
      {
        provider: 'razorpay',
        $or: [
          { 'paymentLink.linkId': 'plink_1' },
          { providerOrderId: { $in: ['order_9'] } },
        ],
      },
      { _id: 1 },
    );
    await flush();
    expect(orders.sync).toHaveBeenCalledWith(String(orderId));
    expect(statusSet()).toEqual([WebhookEventStatus.PROCESSED]);
  });

  it('skips events that cannot move an order, without storing them', async () => {
    razorpay.parseWebhook.mockReturnValue({ ...paidLink, relevant: false });
    expect(await service.receive('razorpay', delivery())).toEqual({
      received: true,
      status: 'SKIPPED',
    });
    expect(eventModel.create).not.toHaveBeenCalled();
  });

  it('ignores a redelivery of an event already processed', async () => {
    eventModel.create.mockRejectedValue({ code: 11000 });
    eventModel.findOneAndUpdate.mockReturnValue(
      lean({ _id: eventDocId, status: WebhookEventStatus.PROCESSED }),
    );
    expect(await service.receive('razorpay', delivery())).toEqual({
      received: true,
      status: WebhookEventStatus.PROCESSED,
      duplicate: true,
    });
    expect(eventModel.findOneAndUpdate).toHaveBeenCalledWith(
      { provider: 'razorpay', eventId: 'evt_1' },
      { $inc: { attempts: 1 } },
      { new: true },
    );
    await flush();
    expect(orders.sync).not.toHaveBeenCalled();
  });

  it('retries a redelivery of an event that failed before', async () => {
    eventModel.create.mockRejectedValue({ code: 11000 });
    eventModel.findOneAndUpdate.mockReturnValue(
      lean({ _id: eventDocId, status: WebhookEventStatus.FAILED }),
    );
    await service.receive('razorpay', delivery());
    await flush();
    expect(orders.sync).toHaveBeenCalledWith(String(orderId));
  });

  it('keys an event without an id by its body hash', async () => {
    await service.receive('razorpay', delivery({ eventId: undefined }));
    expect(eventModel.create.mock.calls[0][0].eventId).toMatch(
      /^sha256:[0-9a-f]{64}$/,
    );
  });

  it('marks an event for an order we do not have as IGNORED', async () => {
    orderModel.findOne.mockReturnValue(lean(null));
    expect(await service.receive('razorpay', delivery())).toEqual({
      received: true,
      status: WebhookEventStatus.IGNORED,
    });
    expect(statusSet()).toEqual([WebhookEventStatus.IGNORED]);
    expect(orders.sync).not.toHaveBeenCalled();
  });

  it('falls back to our order id from the notes', async () => {
    const id = String(new Types.ObjectId());
    razorpay.parseWebhook.mockReturnValue({
      ...paidLink,
      linkId: null,
      providerOrderIds: [],
      orderId: id,
    });
    await service.receive('razorpay', delivery());
    expect(orderModel.findOne.mock.calls[0][0].$or).toEqual([
      { _id: new Types.ObjectId(id) },
    ]);
  });

  describe('process', () => {
    const wait = jest.fn();
    beforeEach(() => {
      wait.mockResolvedValue(undefined);
      (service as any).wait = wait;
    });

    it('waits for another sync holding the order, then syncs', async () => {
      orders.sync.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
      await service.process(String(eventDocId), String(orderId));
      expect(orders.sync).toHaveBeenCalledTimes(2);
      expect(wait).toHaveBeenCalledTimes(1);
      expect(statusSet()).toEqual([WebhookEventStatus.PROCESSED]);
    });

    it('gives up after a few tries while the order stays busy', async () => {
      orders.sync.mockResolvedValue(false);
      await service.process(String(eventDocId), String(orderId));
      expect(orders.sync).toHaveBeenCalledTimes(5);
      expect(statusSet()).toEqual([WebhookEventStatus.FAILED]);
    });

    it('leaves a failed sync to the reconciliation job', async () => {
      orders.sync.mockRejectedValue(new Error('Razorpay is down'));
      await service.process(String(eventDocId), String(orderId));
      expect(eventModel.updateOne).toHaveBeenCalledWith(
        { _id: String(eventDocId) },
        {
          $set: expect.objectContaining({
            status: WebhookEventStatus.FAILED,
            error: 'Razorpay is down',
          }),
        },
      );
    });
  });
});
