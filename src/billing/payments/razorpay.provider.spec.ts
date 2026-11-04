import {
  normalizeRazorpayPayment,
  RazorpayProvider,
  razorpaySignature,
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
      errorCode: 'BAD_REQUEST_ERROR',
      errorDescription: 'Payment was declined',
      createdAt: new Date(1762000000 * 1000),
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
});
