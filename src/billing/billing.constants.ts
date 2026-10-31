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

// India: the quote carries the final GST. Global: tax is added at checkout.
export enum TaxMode {
  INCLUDED_IN_QUOTE = 'INCLUDED_IN_QUOTE',
  CALCULATED_AT_CHECKOUT = 'CALCULATED_AT_CHECKOUT',
}

export const REGION_TAX_MODE: Record<BillingRegion, TaxMode> = {
  [BillingRegion.IN]: TaxMode.INCLUDED_IN_QUOTE,
  [BillingRegion.GLOBAL]: TaxMode.CALCULATED_AT_CHECKOUT,
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
}

/** Regions with billing switched on, from BILLING_ENABLED_REGIONS (e.g. "IN,GLOBAL"). Off by default. */
export function isBillingEnabled(region: BillingRegion): boolean {
  return (process.env.BILLING_ENABLED_REGIONS || '')
    .split(',')
    .map((r) => r.trim().toUpperCase())
    .includes(region);
}

/** Pay stays off until a payment gateway is connected (stage 2). */
export function isPayEnabled(): boolean {
  return process.env.BILLING_PAY_ENABLED === 'true';
}
