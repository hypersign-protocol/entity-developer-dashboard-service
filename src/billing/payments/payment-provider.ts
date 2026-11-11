// The gateway-neutral side of payments (ADR §6). Domain code only sees these
// types; provider fields stay inside each adapter.

export type PaymentStatus =
  | 'CREATED'
  | 'AUTHORIZED'
  | 'CAPTURED'
  | 'FAILED'
  | 'REFUNDED';

export interface NormalizedPayment {
  paymentId: string;
  status: PaymentStatus;
  amountMinor: number;
  currency: string;
  method: string | null; // card, upi, netbanking, wallet, …
  international: boolean;
  // Non-INR payments: what the provider converted the amount to, at its rate
  // when the payment was created. Fees and settlement use it.
  baseAmountMinor: number | null;
  baseCurrency: string | null;
  errorCode: string | null;
  errorDescription: string | null;
  createdAt: Date;
}

export interface ProviderOrder {
  providerOrderId: string;
}

/** What the dashboard needs to open the provider's checkout. */
export interface CheckoutOptions {
  provider: string;
  keyId: string;
  providerOrderId: string;
  amountMinor: number;
  currency: string;
}

export type PaymentLinkStatus =
  | 'CREATED'
  | 'PARTIALLY_PAID'
  | 'PAID'
  | 'EXPIRED'
  | 'CANCELLED';

export interface PaymentLinkState {
  status: PaymentLinkStatus;
  /** The provider order behind the link, once someone started paying. */
  providerOrderId: string | null;
}

/**
 * What a webhook says, reduced to what finds our order. The event is only a
 * hint that something changed: sync() still reads the provider's API.
 */
export interface PaymentWebhookEvent {
  type: string; // the provider's event name, e.g. payment_link.paid
  /** False for events that can't change an order: acknowledged and dropped. */
  relevant: boolean;
  linkId: string | null;
  providerOrderIds: string[];
  /** Our order id from the notes we attached, when the payload carries them. */
  orderId: string | null;
}

export interface PaymentProvider {
  readonly id: string;
  /** False when its keys are missing: Pay then answers 503 PAYMENTS_UNAVAILABLE. */
  isConfigured(): boolean;
  createOrder(input: {
    amountMinor: number;
    currency: string;
    receipt: string; // our order number
    notes: Record<string, string>;
  }): Promise<ProviderOrder>;
  checkoutOptions(order: {
    providerOrderId: string;
    amountMinor: number;
    currency: string;
  }): CheckoutOptions;
  /** Checks the proof the checkout hands back to the browser. */
  verifyCheckout(input: {
    providerOrderId: string; // ours, never the one the browser sends
    paymentId: string;
    signature: string;
  }): boolean;
  /** Every payment attempt on the order: the source of truth, webhooks or not. */
  fetchPayments(providerOrderId: string): Promise<NormalizedPayment[]>;
  capture(payment: NormalizedPayment): Promise<NormalizedPayment>;

  // Payment links: super-admin Collect payment.
  createPaymentLink(input: {
    amountMinor: number;
    currency: string;
    referenceId: string; // our order id: unique per provider account
    description: string;
    customer: { name: string; email: string; contact?: string };
    notifyByEmail: boolean; // false: the admin copies the link and sends it
    expiresAt: Date;
    notes: Record<string, string>;
  }): Promise<{ linkId: string; url: string }>;
  fetchPaymentLink(linkId: string): Promise<PaymentLinkState>;
  cancelPaymentLink(linkId: string): Promise<void>;
  resendPaymentLink(linkId: string): Promise<void>; // by email

  // Webhooks: optional. Without a webhook secret, polling and the job still run.
  webhooksConfigured(): boolean;
  /** Checks the signature over the exact bytes received. */
  verifyWebhook(rawBody: Buffer, signature: string): boolean;
  parseWebhook(body: unknown): PaymentWebhookEvent;
}

export class PaymentProviderError extends Error {
  constructor(
    readonly provider: string,
    message: string,
    readonly httpStatus?: number,
  ) {
    super(message);
  }
}
