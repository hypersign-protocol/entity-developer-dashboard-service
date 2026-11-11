// Our legal entity as printed on invoices ("Billed by"), from BILLING_SUPPLIER_*
// settings. Each invoice copies it when issued, so later changes only affect
// new invoices.
import { TaxIdTypes } from 'src/customer-onboarding/constants/identifier-types';

export interface Supplier {
  legalName: string;
  email: string;
  address: {
    street: string;
    city: string;
    province: string;
    postalCode: string;
    country: string;
  };
  gstin: string;
  pan: string; // characters 3–12 of the GSTIN
  cin: string | null;
  lutArn: string | null;
  stateCode: string;
  sac: string;
  invoicePrefix: string;
}

const env = (name: string) => process.env[name]?.trim() || '';

export function readSupplier(): Supplier {
  const gstin = env('BILLING_SUPPLIER_GSTIN').toUpperCase();
  return {
    legalName: env('BILLING_SUPPLIER_LEGAL_NAME'),
    email: env('BILLING_SUPPLIER_EMAIL'),
    address: {
      street: env('BILLING_SUPPLIER_STREET'),
      city: env('BILLING_SUPPLIER_CITY'),
      province: env('BILLING_SUPPLIER_PROVINCE'),
      postalCode: env('BILLING_SUPPLIER_POSTAL_CODE'),
      country: env('BILLING_SUPPLIER_COUNTRY'),
    },
    gstin,
    pan: gstin.slice(2, 12),
    cin: env('BILLING_SUPPLIER_CIN') || null,
    lutArn: env('BILLING_SUPPLIER_LUT_ARN') || null,
    stateCode: env('BILLING_SUPPLIER_STATE_CODE'),
    sac: env('BILLING_SAC_CODE'),
    invoicePrefix: env('BILLING_INVOICE_PREFIX'),
  };
}

const REQUIRED: [string, (s: Supplier) => string][] = [
  ['BILLING_SUPPLIER_LEGAL_NAME', (s) => s.legalName],
  ['BILLING_SUPPLIER_EMAIL', (s) => s.email],
  ['BILLING_SUPPLIER_STREET', (s) => s.address.street],
  ['BILLING_SUPPLIER_CITY', (s) => s.address.city],
  ['BILLING_SUPPLIER_PROVINCE', (s) => s.address.province],
  ['BILLING_SUPPLIER_POSTAL_CODE', (s) => s.address.postalCode],
  ['BILLING_SUPPLIER_COUNTRY', (s) => s.address.country],
  ['BILLING_SUPPLIER_GSTIN', (s) => s.gstin],
  ['BILLING_SUPPLIER_STATE_CODE', (s) => s.stateCode],
  ['BILLING_SAC_CODE', (s) => s.sac],
  ['BILLING_INVOICE_PREFIX', (s) => s.invoicePrefix],
];

const regexOf = (code: string) =>
  TaxIdTypes.find((t) => t.code === code && t.country === 'IN')?.regex;

/** Problems with the settings; empty when invoices can be issued. */
export function supplierProblems(s: Supplier): string[] {
  const problems = REQUIRED.filter(([, get]) => !get(s)).map(
    ([name]) => `${name} is not set`,
  );
  if (s.gstin && !regexOf('GSTIN')?.test(s.gstin)) {
    problems.push('BILLING_SUPPLIER_GSTIN is not a valid GSTIN');
  }
  if (s.gstin && s.stateCode && !s.gstin.startsWith(s.stateCode)) {
    problems.push(
      'BILLING_SUPPLIER_GSTIN must start with BILLING_SUPPLIER_STATE_CODE',
    );
  }
  if (s.invoicePrefix && !/^[A-Z0-9]{1,8}$/.test(s.invoicePrefix)) {
    problems.push(
      'BILLING_INVOICE_PREFIX must be 1–8 capital letters or digits',
    );
  }
  return problems;
}
