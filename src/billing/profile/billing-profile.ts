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

// GST state codes and names (25 and 28 are legacy codes still accepted).
export const GST_STATES: Record<string, string> = {
  '01': 'Jammu and Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '25': 'Daman and Diu',
  '26': 'Dadra and Nagar Haveli and Daman and Diu',
  '27': 'Maharashtra',
  '28': 'Andhra Pradesh (old)',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
  '38': 'Ladakh',
  '97': 'Other Territory',
};
export const isGstStateCode = (code?: string) => !!code && code in GST_STATES;

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

// Upper-cased code → the code as written in TaxIdTypes. Most codes are upper
// case, but not all ('Partita IVA', 'e-TIN'), so the type is matched without
// regard to case and stored as the official code.
const TAX_ID_CODES = new Map(
  TaxIdTypes.map(({ code }) => [code.toUpperCase(), code]),
);

export const normaliseTaxIds = (taxIds: TaxIdValue[] = []): TaxIdValue[] =>
  taxIds.map((t) => {
    const type = t.type.trim();
    return {
      type: TAX_ID_CODES.get(type.toUpperCase()) ?? type.toUpperCase(),
      number: t.number.replace(/\s+/g, '').toUpperCase(),
    };
  });

/** A tax ID given as a person's, not the company's. Only the end of it is kept. */
export interface PersonalTaxId {
  type: string; // PAN (India, in PAN format) or OTHER
  last4: string;
}

export interface StoredBilling {
  region?: string;
  currency?: string;
  legalName?: string;
  email?: string;
  phone?: string; // international form, e.g. +4930123456
  address?: {
    street?: string;
    city?: string;
    province?: string;
    postalCode?: string;
    country?: string;
  };
  gstStateCode?: string;
  taxIds?: TaxIdValue[];
  personalTaxId?: PersonalTaxId;
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

const OTHER_TAX_ID = 'OTHER';
const PERSONAL_TAX_ID_VISIBLE = 4;

const ADDRESS_FIELDS = [
  'street',
  'city',
  'province',
  'postalCode',
  'country',
] as const;

const maskPersonalTaxId = ({ type, last4 }: PersonalTaxId) =>
  `${type === 'PAN' ? 'XXXXXX' : 'XXXX'}${last4}`;

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
    phone: billing.phone || null,
    address,
    gstStateCode:
      region === BillingRegion.IN
        ? billing.gstStateCode || gstStateFromTaxIds(taxIds)
        : null,
    taxIds: taxIds.map(({ type, number }) => ({ type, number })),
    personalTaxId: billing.personalTaxId
      ? {
          type: billing.personalTaxId.type,
          number: maskPersonalTaxId(billing.personalTaxId),
        }
      : null,
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
 * What paying online needs beyond a complete profile: Razorpay wants the
 * customer's phone for international payments, so Global needs one.
 */
export function paymentMissingFields(profile: BillingProfile): string[] {
  return profile.region === BillingRegion.GLOBAL && !profile.phone
    ? ['phone']
    : [];
}

/** A GSTIN is an Indian registration, so it only fits the IN region. */
export const hasGstin = (taxIds: TaxIdValue[] = []) =>
  taxIds.some((t) => t.type === 'GSTIN');

/**
 * $set fields copying a KYB submission into an unconfirmed billing profile, so
 * most accounts are prefilled without asking the ID Service. Never touches a
 * profile the customer has saved.
 *
 * The region follows the billing address country (ADR §4.0): it is set from
 * the copied address, and only when no address is copied does it fall back to
 * the country of registration, and then only if no region is stored yet.
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
  if (!company) return {};
  const taxIdSet = kybTaxIdSet(company);
  if (existing?.confirmedAt) {
    // A saved profile only gains a company tax ID it doesn't have yet, and
    // never a GSTIN outside India.
    if (existing.lockedAt || existing.taxIds?.length) return {};
    const gstinMismatch =
      hasGstin(taxIdSet['billing.taxIds'] as TaxIdValue[]) &&
      existing.region !== BillingRegion.IN;
    return gstinMismatch ? {} : taxIdSet;
  }
  const set: Record<string, unknown> = { ...taxIdSet };
  if (company.name) set['billing.legalName'] = company.name;
  const address = company.address;
  const copiesAddress = address && ADDRESS_FIELDS.every((f) => address[f]);
  if (copiesAddress) {
    set['billing.address'] = Object.fromEntries(
      ADDRESS_FIELDS.map((f) => [f, String(address[f]).trim()]),
    );
  }
  const region = existing?.lockedAt
    ? null
    : copiesAddress
    ? regionFromCountry(address.country)
    : existing?.region
    ? null
    : regionFromCountry(company.countryOfRegistration);
  if (region) {
    set['billing.region'] = region;
    set['billing.currency'] = REGION_CURRENCY[region];
  }
  if (
    hasGstin(set['billing.taxIds'] as TaxIdValue[]) &&
    (region || existing?.region) === BillingRegion.GLOBAL
  ) {
    // An address outside India: the customer adds the right tax ID themselves.
    delete set['billing.taxIds'];
    delete set['billing.gstStateCode'];
  }
  return set;
}

/** The company tax ID's fields. OTHER is a personal one, see kybPersonalTaxId. */
function kybTaxIdSet(company: {
  taxIdType?: string;
  taxIdNumber?: string;
}): Record<string, unknown> {
  if (!company.taxIdType || !company.taxIdNumber) return {};
  const [taxId] = normaliseTaxIds([
    { type: company.taxIdType, number: company.taxIdNumber },
  ]);
  if (taxId.type === OTHER_TAX_ID || taxIdProblem(taxId)) return {};
  const state = gstStateFromTaxIds([taxId]);
  return {
    'billing.taxIds': [taxId],
    ...(state && { 'billing.gstStateCode': state }),
  };
}

/**
 * The personal tax ID in a KYB submission, for a business not registered for
 * tax. Null otherwise, including a number too short to mask.
 */
export function kybPersonalTaxId(company: {
  countryOfRegistration?: string;
  taxIdType?: string;
  taxIdNumber?: string;
}): PersonalTaxId | null {
  if (!company?.taxIdType || !company.taxIdNumber) return null;
  const [{ type, number }] = normaliseTaxIds([
    { type: company.taxIdType, number: company.taxIdNumber },
  ]);
  if (type !== OTHER_TAX_ID || number.length <= PERSONAL_TAX_ID_VISIBLE) {
    return null;
  }
  const isPan =
    regionFromCountry(company.countryOfRegistration) === BillingRegion.IN &&
    !taxIdProblem({ type: 'PAN', number });
  return {
    type: isPan ? 'PAN' : OTHER_TAX_ID,
    last4: number.slice(-PERSONAL_TAX_ID_VISIBLE),
  };
}

/**
 * $set fields saving a prefilled profile when KYB is approved, so a verified
 * customer doesn't have to confirm it. Empty when the profile was already saved
 * or anything is missing; those customers still use the billing form.
 */
export function kybApprovedBillingUpdate(
  org: ProfileSource,
): Record<string, unknown> {
  if (org.billing?.confirmedAt) return {};
  const profile = buildBillingProfile(org);
  if (profile.missingFields.length) return {};
  return {
    // Values that may only be fallbacks are stored, so they stay as confirmed.
    'billing.legalName': profile.legalName.trim(),
    'billing.email': profile.email.trim().toLowerCase(),
    'billing.region': profile.region,
    'billing.currency': profile.currency,
    ...(profile.gstStateCode && {
      'billing.gstStateCode': profile.gstStateCode,
    }),
    'billing.confirmedAt': new Date(),
  };
}
