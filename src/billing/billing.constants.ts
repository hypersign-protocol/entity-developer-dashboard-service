export enum BillingRegion {
  IN = 'IN',
  GLOBAL = 'GLOBAL',
}

export enum BillingCurrency {
  INR = 'INR',
  USD = 'USD',
}

export const REGION_CURRENCY: Record<BillingRegion, BillingCurrency> = {
  [BillingRegion.IN]: BillingCurrency.INR,
  [BillingRegion.GLOBAL]: BillingCurrency.USD,
};

// India: the quote carries the final GST. Global: no tax is charged.
// CALCULATED_AT_CHECKOUT is kept for a gateway that adds tax on its page.
export enum TaxMode {
  INCLUDED_IN_QUOTE = 'INCLUDED_IN_QUOTE',
  NONE = 'NONE',
  CALCULATED_AT_CHECKOUT = 'CALCULATED_AT_CHECKOUT',
}

export const REGION_TAX_MODE: Record<BillingRegion, TaxMode> = {
  [BillingRegion.IN]: TaxMode.INCLUDED_IN_QUOTE,
  [BillingRegion.GLOBAL]: TaxMode.NONE,
};

// Machine-readable error codes (docs/payment/api-contract.md §1.5).
export enum BillingErrorCode {
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  APP_NOT_FOUND = 'APP_NOT_FOUND',
  APP_NOT_BILLABLE = 'APP_NOT_BILLABLE',
  ONBOARDING_NOT_FOUND = 'ONBOARDING_NOT_FOUND',
  BILLING_DISABLED = 'BILLING_DISABLED',
  PLAN_NOT_FOUND = 'PLAN_NOT_FOUND',
  AMOUNT_OUT_OF_RANGE = 'AMOUNT_OUT_OF_RANGE',
  COUPON_INVALID = 'COUPON_INVALID',
  BILLING_PROFILE_LOCKED = 'BILLING_PROFILE_LOCKED',
  RATE_LIMITED = 'RATE_LIMITED',
  INVOICE_NOT_FOUND = 'INVOICE_NOT_FOUND',
  BILLING_PROFILE_INCOMPLETE = 'BILLING_PROFILE_INCOMPLETE',
  PAYMENTS_NOT_AVAILABLE = 'PAYMENTS_NOT_AVAILABLE',
  IDEMPOTENCY_KEY_REUSED = 'IDEMPOTENCY_KEY_REUSED',
  BILLING_NOT_CONFIGURED = 'BILLING_NOT_CONFIGURED',
  USE_INVOICES = 'USE_INVOICES',
  PAYMENTS_UNAVAILABLE = 'PAYMENTS_UNAVAILABLE',
  QUOTE_EXPIRED = 'QUOTE_EXPIRED',
  ORDER_NOT_FOUND = 'ORDER_NOT_FOUND',
  ORDER_NOT_PAYABLE = 'ORDER_NOT_PAYABLE',
  ORDER_NOT_CANCELLABLE = 'ORDER_NOT_CANCELLABLE',
  PAYMENT_VERIFICATION_FAILED = 'PAYMENT_VERIFICATION_FAILED',
}

/** Once true, ID Service credits can only be granted through invoices (POST /app/:appId/credits returns 409). */
export function invoicedGrantsOnly(): boolean {
  return process.env.BILLING_INVOICED_GRANTS === 'true';
}

/** Regions with billing switched on, from BILLING_ENABLED_REGIONS (e.g. "IN,GLOBAL"). Off by default. */
export function isBillingEnabled(region: BillingRegion): boolean {
  return (process.env.BILLING_ENABLED_REGIONS || '')
    .split(',')
    .map((r) => r.trim().toUpperCase())
    .includes(region);
}

// Online payment per region. Phase 1: India only, through Razorpay.
export const PAY_PROVIDER: Partial<Record<BillingRegion, string>> = {
  [BillingRegion.IN]: 'razorpay',
};

/** Pay is offered when BILLING_PAY_ENABLED=true and the region has a provider. */
export function isPayEnabled(region: BillingRegion): boolean {
  return process.env.BILLING_PAY_ENABLED === 'true' && !!PAY_PROVIDER[region];
}
