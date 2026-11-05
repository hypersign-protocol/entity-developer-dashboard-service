// Razorpay adapter: Orders API + Standard Checkout, statuses read from the API
// (https://razorpay.com/docs/api/orders/, /docs/payments/payment-gateway/web-integration/standard/).
import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import {
  CheckoutOptions,
  NormalizedPayment,
  PaymentLinkState,
  PaymentLinkStatus,
  PaymentProvider,
  PaymentProviderError,
  PaymentStatus,
} from './payment-provider';

const API = 'https://api.razorpay.com/v1';
const TIMEOUT_MS = 10_000;

const STATUS: Record<string, PaymentStatus> = {
  created: 'CREATED',
  authorized: 'AUTHORIZED',
  captured: 'CAPTURED',
  failed: 'FAILED',
  refunded: 'REFUNDED',
};

const LINK_STATUS: Record<string, PaymentLinkStatus> = {
  created: 'CREATED',
  partially_paid: 'PARTIALLY_PAID',
  paid: 'PAID',
  expired: 'EXPIRED',
  cancelled: 'CANCELLED',
};

interface RazorpayPayment {
  id: string;
  status: string;
  amount: number;
  currency: string;
  method?: string;
  international?: boolean;
  base_amount?: number; // only when currency isn't INR
  base_currency?: string;
  error_code?: string | null;
  error_description?: string | null;
  created_at: number;
}

export function normalizeRazorpayPayment(
  p: RazorpayPayment,
): NormalizedPayment {
  return {
    paymentId: p.id,
    status: STATUS[p.status] ?? 'CREATED',
    amountMinor: p.amount,
    currency: p.currency,
    method: p.method ?? null,
    international: !!p.international,
    baseAmountMinor:
      p.currency !== 'INR' && Number.isInteger(p.base_amount)
        ? p.base_amount
        : null,
    baseCurrency: p.currency !== 'INR' ? p.base_currency ?? null : null,
    errorCode: p.error_code ?? null,
    errorDescription: p.error_description ?? null,
    createdAt: new Date(p.created_at * 1000),
  };
}

/** HMAC-SHA256 of "<order id>|<payment id>" with the key secret. */
export function razorpaySignature(
  providerOrderId: string,
  paymentId: string,
  secret: string,
) {
  return createHmac('sha256', secret)
    .update(`${providerOrderId}|${paymentId}`)
    .digest('hex');
}

@Injectable()
export class RazorpayProvider implements PaymentProvider {
  readonly id = 'razorpay';

  private get keyId() {
    return process.env.RAZORPAY_KEY_ID?.trim() || '';
  }
  private get keySecret() {
    return process.env.RAZORPAY_KEY_SECRET?.trim() || '';
  }

  isConfigured() {
    return !!this.keyId && !!this.keySecret;
  }

  async createOrder(input: {
    amountMinor: number;
    currency: string;
    receipt: string;
    notes: Record<string, string>;
  }) {
    const order = await this.request<{ id: string }>('POST', '/orders', {
      amount: input.amountMinor,
      currency: input.currency,
      receipt: input.receipt.slice(0, 40),
      notes: input.notes,
      partial_payment: false,
    });
    return { providerOrderId: order.id };
  }

  checkoutOptions(order: {
    providerOrderId: string;
    amountMinor: number;
    currency: string;
  }): CheckoutOptions {
    return {
      provider: this.id,
      keyId: this.keyId,
      providerOrderId: order.providerOrderId,
      amountMinor: order.amountMinor,
      currency: order.currency,
    };
  }

  verifyCheckout(input: {
    providerOrderId: string;
    paymentId: string;
    signature: string;
  }) {
    if (!input.signature || !this.keySecret) return false;
    const expected = Buffer.from(
      razorpaySignature(input.providerOrderId, input.paymentId, this.keySecret),
    );
    const given = Buffer.from(input.signature);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  async fetchPayments(providerOrderId: string) {
    const result = await this.request<{ items: RazorpayPayment[] }>(
      'GET',
      `/orders/${encodeURIComponent(providerOrderId)}/payments`,
    );
    return (result.items || []).map(normalizeRazorpayPayment);
  }

  /** Safety net: the Dashboard's automatic capture should have done this already. */
  async capture(payment: NormalizedPayment) {
    const captured = await this.request<RazorpayPayment>(
      'POST',
      `/payments/${encodeURIComponent(payment.paymentId)}/capture`,
      { amount: payment.amountMinor, currency: payment.currency },
    );
    return normalizeRazorpayPayment(captured);
  }

  // https://razorpay.com/docs/api/payments/payment-links/
  async createPaymentLink(input: {
    amountMinor: number;
    currency: string;
    referenceId: string;
    description: string;
    customer: { name: string; email: string; contact?: string };
    notifyByEmail: boolean;
    expiresAt: Date;
    notes: Record<string, string>;
  }) {
    const link = await this.request<{ id: string; short_url: string }>(
      'POST',
      '/payment_links',
      {
        amount: input.amountMinor,
        currency: input.currency,
        accept_partial: false,
        reference_id: input.referenceId.slice(0, 40),
        description: input.description.slice(0, 2048),
        customer: input.customer,
        notify: { email: input.notifyByEmail, sms: false },
        reminder_enable: input.notifyByEmail,
        expire_by: Math.floor(input.expiresAt.getTime() / 1000),
        notes: input.notes,
      },
    );
    return { linkId: link.id, url: link.short_url };
  }

  async fetchPaymentLink(linkId: string): Promise<PaymentLinkState> {
    const link = await this.request<{ status: string; order_id?: string }>(
      'GET',
      `/payment_links/${encodeURIComponent(linkId)}`,
    );
    return {
      status: LINK_STATUS[link.status] ?? 'CREATED',
      providerOrderId: link.order_id || null,
    };
  }

  async cancelPaymentLink(linkId: string) {
    await this.request(
      'POST',
      `/payment_links/${encodeURIComponent(linkId)}/cancel`,
    );
  }

  async resendPaymentLink(linkId: string) {
    await this.request(
      'POST',
      `/payment_links/${encodeURIComponent(linkId)}/notify_by/email`,
    );
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: object,
  ): Promise<T> {
    if (!this.isConfigured()) {
      throw new PaymentProviderError(this.id, 'Razorpay keys are not set');
    }
    const auth = Buffer.from(`${this.keyId}:${this.keySecret}`).toString(
      'base64',
    );
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let response;
    try {
      response = await (globalThis as any).fetch(`${API}${path}`, {
        method,
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (error) {
      throw new PaymentProviderError(
        this.id,
        `${method} ${path} failed: ${error?.message}`,
      );
    } finally {
      clearTimeout(timer);
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new PaymentProviderError(
        this.id,
        `${method} ${path} answered ${response.status}: ${
          data?.error?.description || 'no description'
        }`,
        response.status,
      );
    }
    return data as T;
  }
}
