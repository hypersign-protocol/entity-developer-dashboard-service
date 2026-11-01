// Builds everything printed on an invoice (docs/payment/api-contract.md §4,
// InvoiceDocument). Pure: the service adds the number and stores it. The
// dashboard renders the PDF from this data, so nothing here is recomputed later.
import { BillingRegion } from '../billing.constants';
import { BillingProfile, GST_STATES } from '../profile/billing-profile';
import { indiaGst, TaxLine } from '../tax/india-gst';
import { Supplier } from './supplier';

export const INVOICE_TEMPLATE_VERSION = 'invoice-v1';
export const CREDITS_LINE_DESCRIPTION = 'Prepaid verification credits';
export const TAX_NOTE_INDIA = 'Tax is payable on reverse charge: No.';
export const TAX_NOTE_EXPORT =
  'Supply meant for export of services under LUT without payment of IGST.';
const EXPORT_PLACE_OF_SUPPLY = { code: '96', name: 'Other Countries' };

export type OfflinePaymentMethod =
  | 'BANK_TRANSFER'
  | 'UPI'
  | 'CHEQUE'
  | 'CARD_OUTSIDE_DASHBOARD'
  | 'OTHER_SYSTEM';

export interface AdminInvoiceInput {
  credits: number;
  validityDays: number;
  amountMinor: number; // excluding tax; 0 = complimentary
  payment?: { method: OfflinePaymentMethod; reference: string; paidAt: Date };
  profile: BillingProfile;
  supplier: Supplier;
  app: { appId: string; appName: string };
  addOnLines: { code: string; title: string }[];
  now: Date;
}

/** Tax and totals for a super-admin invoice amount (also the live preview). */
export function priceAdminInvoice(
  amountMinor: number,
  region: string,
  customerStateCode: string | null,
  supplierStateCode: string,
) {
  let tax: TaxLine[] = [];
  if (amountMinor > 0 && region === BillingRegion.IN) {
    tax = indiaGst(amountMinor, customerStateCode, supplierStateCode).lines;
  }
  const taxMinor = tax.reduce((sum, line) => sum + line.amountMinor, 0);
  return {
    tax,
    totals: {
      subtotalMinor: amountMinor,
      discountMinor: 0,
      taxableMinor: amountMinor,
      taxMinor,
      totalMinor: amountMinor + taxMinor,
    },
  };
}

export function buildAdminInvoice(input: AdminInvoiceInput) {
  const { profile, supplier, amountMinor } = input;
  const india = profile.region === BillingRegion.IN;
  const complimentary = amountMinor === 0;
  const { tax, totals } = priceAdminInvoice(
    amountMinor,
    profile.region,
    profile.gstStateCode,
    supplier.stateCode,
  );
  const paidAt = complimentary ? input.now : input.payment.paidAt;

  return {
    templateVersion: INVOICE_TEMPLATE_VERSION,
    source: 'ADMIN' as const,
    status: 'PAID' as const,
    settlement: complimentary
      ? ('COMPLIMENTARY' as const)
      : ('OFFLINE' as const),
    issuedAt: input.now,
    paidAt,
    dueAt: null,
    currency: profile.currency,
    supplier: {
      legalName: supplier.legalName,
      email: supplier.email,
      address: { ...supplier.address },
      gstin: supplier.gstin,
      pan: supplier.pan,
      cin: supplier.cin,
      lutArn: supplier.lutArn,
    },
    customer: {
      legalName: profile.legalName,
      email: profile.email,
      address: { ...profile.address },
      taxIds: profile.taxIds.map(({ type, number }) => ({ type, number })),
      gstStateCode: india ? profile.gstStateCode : null,
      region: profile.region,
    },
    placeOfSupply: india
      ? { code: profile.gstStateCode, name: GST_STATES[profile.gstStateCode] }
      : EXPORT_PLACE_OF_SUPPLY,
    app: { ...input.app },
    orderNumber: null,
    lines: [
      {
        description: CREDITS_LINE_DESCRIPTION,
        sac: supplier.sac,
        quantity: 1,
        unitPriceMinor: amountMinor,
        discountMinor: 0,
        taxableMinor: amountMinor,
      },
    ],
    addOnLines: input.addOnLines.map(({ code, title }) => ({ code, title })),
    discounts: { plan: null, coupon: null },
    tax,
    taxNote: india ? TAX_NOTE_INDIA : TAX_NOTE_EXPORT,
    totals: {
      ...totals,
      amountPaidMinor: totals.totalMinor,
      balanceDueMinor: 0,
    },
    credits: input.credits,
    validityDays: input.validityDays,
    payment: complimentary
      ? null
      : {
          method: input.payment.method,
          reference: input.payment.reference,
          provider: null,
          paymentId: null,
          paidAt,
        },
    payNowUrl: null,
    voidedAt: null,
    voidReason: null,
  };
}

export type InvoiceFields = ReturnType<typeof buildAdminInvoice>;
