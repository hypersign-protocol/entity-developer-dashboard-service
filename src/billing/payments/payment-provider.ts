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
  /** Every payment attempt on the order: the source of truth (no webhooks yet). */
  fetchPayments(providerOrderId: string): Promise<NormalizedPayment[]>;
  capture(payment: NormalizedPayment): Promise<NormalizedPayment>;

  // Payment links: super-admin Collect payment.
  createPaymentLink(input: {
    amountMinor: number;
    currency: string;
    referenceId: string; // our order number
    description: string;
    customer: { name: string; email: string };
    notifyByEmail: boolean; // false: the admin copies the link and sends it
    expiresAt: Date;
    notes: Record<string, string>;
  }): Promise<{ linkId: string; url: string }>;
  fetchPaymentLink(linkId: string): Promise<PaymentLinkState>;
  cancelPaymentLink(linkId: string): Promise<void>;
  resendPaymentLink(linkId: string): Promise<void>; // by email
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
