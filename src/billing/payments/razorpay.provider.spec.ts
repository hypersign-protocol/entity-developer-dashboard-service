import {
  normalizeRazorpayPayment,
  parseRazorpayWebhook,
  RazorpayProvider,
  razorpaySignature,
  razorpayWebhookSignature,
} from './razorpay.provider';

describe('RazorpayProvider', () => {
  const provider = new RazorpayProvider();
  beforeEach(() => {
    process.env.RAZORPAY_KEY_ID = 'rzp_test_key';
    process.env.RAZORPAY_KEY_SECRET = 'secret';
  });
  afterEach(() => {
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
  });

  it('accepts the checkout signature for our order id only', () => {
    const signature = razorpaySignature('order_1', 'pay_1', 'secret');
    expect(
      provider.verifyCheckout({
        providerOrderId: 'order_1',
        paymentId: 'pay_1',
        signature,
      }),
    ).toBe(true);
    expect(
      provider.verifyCheckout({
        providerOrderId: 'order_2',
        paymentId: 'pay_1',
        signature,
      }),
    ).toBe(false);
    expect(
      provider.verifyCheckout({
        providerOrderId: 'order_1',
        paymentId: 'pay_1',
        signature: 'short',
      }),
    ).toBe(false);
  });

  it('is not configured without both keys', () => {
    expect(provider.isConfigured()).toBe(true);
    delete process.env.RAZORPAY_KEY_SECRET;
    expect(provider.isConfigured()).toBe(false);
  });

  it('normalises a payment', () => {
    expect(
      normalizeRazorpayPayment({
        id: 'pay_1',
        status: 'failed',
        amount: 203469,
        currency: 'INR',
        method: 'upi',
        error_code: 'BAD_REQUEST_ERROR',
        error_description: 'Payment was declined',
        created_at: 1762000000,
      }),
    ).toEqual({
      paymentId: 'pay_1',
      status: 'FAILED',
      amountMinor: 203469,
      currency: 'INR',
      method: 'upi',
      international: false,
      baseAmountMinor: null,
      baseCurrency: null,
      errorCode: 'BAD_REQUEST_ERROR',
      errorDescription: 'Payment was declined',
      createdAt: new Date(1762000000 * 1000),
    });
  });

  it('keeps the INR amount Razorpay converted a USD payment to', () => {
    expect(
      normalizeRazorpayPayment({
        id: 'pay_2',
        status: 'captured',
        amount: 19900,
        currency: 'USD',
        method: 'card',
        international: true,
        base_amount: 1671600,
        base_currency: 'INR',
        created_at: 1762000000,
      }),
    ).toMatchObject({
      amountMinor: 19900,
      currency: 'USD',
      international: true,
      baseAmountMinor: 1671600,
      baseCurrency: 'INR',
    });
  });

  it('creates an order with basic auth, and reports API errors', async () => {
    const fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'order_1' }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: { description: 'amount too low' } }),
      });
    (globalThis as any).fetch = fetch;
    const input = {
      amountMinor: 203469,
      currency: 'INR',
      receipt: 'ORD-2026-000123',
      notes: { orderId: 'o1' },
    };

    await expect(provider.createOrder(input)).resolves.toEqual({
      providerOrderId: 'order_1',
    });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://api.razorpay.com/v1/orders');
    expect(init.headers.Authorization).toBe(
      `Basic ${Buffer.from('rzp_test_key:secret').toString('base64')}`,
    );
    expect(JSON.parse(init.body)).toMatchObject({
      amount: 203469,
      currency: 'INR',
      receipt: 'ORD-2026-000123',
    });
    await expect(provider.createOrder(input)).rejects.toThrow(
      /400: amount too low/,
    );
  });

  describe('webhooks', () => {
    const raw = Buffer.from('{"event":"payment_link.paid","payload":{}}');
    afterEach(() => delete process.env.RAZORPAY_WEBHOOK_SECRET);

    it('is optional: off without a webhook secret', () => {
      expect(provider.webhooksConfigured()).toBe(false);
      expect(
        provider.verifyWebhook(raw, razorpayWebhookSignature(raw, '')),
      ).toBe(false);
      process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec';
      expect(provider.webhooksConfigured()).toBe(true);
    });

    it('accepts only a signature over the exact body with the webhook secret', () => {
      process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec';
      const signature = razorpayWebhookSignature(raw, 'whsec');
      expect(provider.verifyWebhook(raw, signature)).toBe(true);
      // re-serialised JSON, the API key secret, or nothing: refused
      expect(
        provider.verifyWebhook(
          Buffer.from(JSON.stringify(JSON.parse(raw.toString()), null, 1)),
          signature,
        ),
      ).toBe(false);
      expect(
        provider.verifyWebhook(raw, razorpayWebhookSignature(raw, 'secret')),
      ).toBe(false);
      expect(provider.verifyWebhook(raw, '')).toBe(false);
    });

    it('finds the link, the Razorpay order and our order id in payment_link.paid', () => {
      expect(
        parseRazorpayWebhook({
          event: 'payment_link.paid',
          payload: {
            payment_link: {
              entity: {
                id: 'plink_1',
                order_id: 'order_9',
                notes: { orderId: 'abc' },
              },
            },
            order: { entity: { id: 'order_9', notes: [] } },
            payment: { entity: { id: 'pay_1', order_id: 'order_9' } },
          },
        }),
      ).toEqual({
        type: 'payment_link.paid',
        relevant: true,
        linkId: 'plink_1',
        providerOrderIds: ['order_9'],
        orderId: 'abc',
      });
    });

    it('reads a checkout payment.captured by its order', () => {
      expect(
        parseRazorpayWebhook({
          event: 'payment.captured',
          payload: {
            payment: { entity: { id: 'pay_1', order_id: 'order_3' } },
          },
        }),
      ).toMatchObject({
        relevant: true,
        linkId: null,
        providerOrderIds: ['order_3'],
        orderId: null,
      });
    });

    it('marks events that cannot move an order as not relevant', () => {
      expect(
        parseRazorpayWebhook({ event: 'settlement.processed', payload: {} })
          .relevant,
      ).toBe(false);
      expect(parseRazorpayWebhook(null).relevant).toBe(false);
    });
  });
});
