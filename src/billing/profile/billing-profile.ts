// Billing profile rules (ADR §4.1), kept pure so onboarding and billing share them.
import { TaxIdTypes } from 'src/customer-onboarding/constants/identifier-types';
import {
  BillingCurrency,
  BillingRegion,
  REGION_CURRENCY,
} from '../billing.constants';

const INDIA = ['IN', 'IND', 'INDIA'];

/** Country → billing region (ADR §4.0). `null` when unknown. */
export function regionFromCountry(country?: string): BillingRegion | null {
  const value = country?.trim().toUpperCase();
  if (!value) return null;
  return INDIA.includes(value) ? BillingRegion.IN : BillingRegion.GLOBAL;
}

// GST state codes: 01–38 and 97 (Other Territory).
const GST_STATE_CODES = new Set([
  ...Array.from({ length: 38 }, (_, i) => String(i + 1).padStart(2, '0')),
  '97',
]);
export const isGstStateCode = (code?: string) =>
  !!code && GST_STATE_CODES.has(code);

/** The first two digits of a GSTIN are the registrant's state code. */
export function gstStateFromTaxIds(taxIds: TaxIdValue[] = []): string | null {
  const gstin = taxIds.find((t) => t.type === 'GSTIN')?.number;
  const code = gstin?.slice(0, 2);
  return isGstStateCode(code) ? code : null;
}

export interface TaxIdValue {
  type: string;
  number: string;
}

/** Null when valid, otherwise the reason. Uses the existing TaxIdTypes regexes. */
export function taxIdProblem({ type, number }: TaxIdValue): string | null {
  const known = TaxIdTypes.filter((t) => t.code === type);
  if (!known.length) return `Unknown tax ID type ${type}`;
  const patterns = known.map((t) => t.regex).filter(Boolean);
  if (patterns.length && !patterns.some((re) => re.test(number))) {
    return `Not a valid ${type}`;
  }
  return null;
}

export const normaliseTaxIds = (taxIds: TaxIdValue[] = []): TaxIdValue[] =>
  taxIds.map((t) => ({
    type: t.type.trim().toUpperCase(),
    number: t.number.replace(/\s+/g, '').toUpperCase(),
  }));

export interface StoredBilling {
  region?: string;
  currency?: string;
  legalName?: string;
  email?: string;
  address?: {
    street?: string;
    city?: string;
    province?: string;
    postalCode?: string;
    country?: string;
  };
  gstStateCode?: string;
  taxIds?: TaxIdValue[];
  confirmedAt?: Date;
  lockedAt?: Date;
}

export interface ProfileSource {
  _id: unknown;
  companyName?: string;
  customerEmail?: string;
  country?: string;
  billing?: StoredBilling;
}

const ADDRESS_FIELDS = [
  'street',
  'city',
  'province',
  'postalCode',
  'country',
] as const;

/** The BillingProfile object of docs/payment/api-contract.md §2. */
export function buildBillingProfile(org: ProfileSource) {
  const billing = org.billing || {};
  const region = (billing.region ||
    regionFromCountry(billing.address?.country) ||
    regionFromCountry(org.country) ||
    BillingRegion.GLOBAL) as BillingRegion;
  const taxIds = billing.taxIds || [];
  const address = billing.address
    ? Object.fromEntries(
        ADDRESS_FIELDS.map((f) => [f, billing.address[f] ?? null]),
      )
    : null;
  const profile = {
    orgId: String(org._id),
    legalName: billing.legalName || org.companyName || null,
    email: billing.email || org.customerEmail || null,
    address,
    gstStateCode:
      region === BillingRegion.IN
        ? billing.gstStateCode || gstStateFromTaxIds(taxIds)
        : null,
    taxIds: taxIds.map(({ type, number }) => ({ type, number })),
    region,
    currency: (billing.currency || REGION_CURRENCY[region]) as BillingCurrency,
    source: billing.confirmedAt ? 'SAVED' : 'PREFILLED',
    locked: !!billing.lockedAt,
    lockedAt: billing.lockedAt || null,
  };

  const missingFields: string[] = [];
  if (!profile.legalName) missingFields.push('legalName');
  if (!profile.email) missingFields.push('email');
  ADDRESS_FIELDS.forEach((f) => {
    if (!address?.[f]) missingFields.push(`address.${f}`);
  });
  if (region === BillingRegion.IN && !profile.gstStateCode) {
    missingFields.push('gstStateCode');
  }
  return {
    ...profile,
    // Invoices need confirmed details, not only prefilled ones.
    complete: missingFields.length === 0 && profile.source === 'SAVED',
    missingFields,
  };
}

export type BillingProfile = ReturnType<typeof buildBillingProfile>;

/**
 * $set fields copying a KYB submission into an unconfirmed billing profile, so
 * most accounts are prefilled without asking the ID Service. Never touches a
 * profile the customer has saved, and never changes a stored region.
 */
export function kybBillingDefaults(
  existing: StoredBilling | undefined,
  company: {
    name?: string;
    countryOfRegistration?: string;
    taxIdType?: string;
    taxIdNumber?: string;
    address?: StoredBilling['address'];
  },
): Record<string, unknown> {
  if (!company || existing?.confirmedAt) return {};
  const set: Record<string, unknown> = {};
  if (company.name) set['billing.legalName'] = company.name;
  const address = company.address;
  if (address && ADDRESS_FIELDS.every((f) => address[f])) {
    set['billing.address'] = Object.fromEntries(
      ADDRESS_FIELDS.map((f) => [f, String(address[f]).trim()]),
    );
  }
  if (company.taxIdType && company.taxIdNumber) {
    const [taxId] = normaliseTaxIds([
      { type: company.taxIdType, number: company.taxIdNumber },
    ]);
    if (!taxIdProblem(taxId)) {
      set['billing.taxIds'] = [taxId];
      const state = gstStateFromTaxIds([taxId]);
      if (state) set['billing.gstStateCode'] = state;
    }
  }
  if (!existing?.region) {
    const region =
      regionFromCountry(company.countryOfRegistration) ||
      regionFromCountry(address?.country);
    if (region) {
      set['billing.region'] = region;
      set['billing.currency'] = REGION_CURRENCY[region];
    }
  }
  return set;
}
