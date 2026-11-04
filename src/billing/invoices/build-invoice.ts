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

/** Who, where and the tax note: the same for every kind of invoice. */
function parties(profile: BillingProfile, supplier: Supplier) {
  const india = profile.region === BillingRegion.IN;
  return {
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
    taxNote: india ? TAX_NOTE_INDIA : TAX_NOTE_EXPORT,
  };
}

export function buildAdminInvoice(input: AdminInvoiceInput) {
  const { profile, supplier, amountMinor } = input;
  const complimentary = amountMinor === 0;
  const { tax, totals } = priceAdminInvoice(
    amountMinor,
    profile.region,
    profile.gstStateCode,
    supplier.stateCode,
  );
  const paidAt = complimentary ? input.now : input.payment.paidAt;
  const {
    supplier: billedBy,
    customer,
    placeOfSupply,
    taxNote,
  } = parties(profile, supplier);

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
    supplier: billedBy,
    customer,
    placeOfSupply,
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
    taxNote,
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

/** Collect payment, paid by payment link: a super-admin invoice settled by the gateway. */
export function buildLinkPaidInvoice(
  input: Omit<AdminInvoiceInput, 'payment'> & {
    payment: {
      provider: string;
      paymentId: string;
      method: string | null;
      paidAt: Date;
    };
    orderNumber: string;
  },
) {
  const { payment, orderNumber, ...rest } = input;
  const invoice = buildAdminInvoice({
    ...rest,
    payment: {
      method: null,
      reference: payment.paymentId,
      paidAt: payment.paidAt,
    },
  });
  return {
    ...invoice,
    settlement: 'GATEWAY' as const,
    orderNumber,
    payment: {
      method: payment.method,
      reference: payment.paymentId,
      provider: payment.provider,
      paymentId: payment.paymentId,
      paidAt: payment.paidAt,
    },
  };
}

/** A claimed free-credit promotion: complimentary, issued to the customer's own claim. */
export function buildPromotionInvoice(
  input: Omit<AdminInvoiceInput, 'amountMinor' | 'payment'>,
) {
  return {
    ...buildAdminInvoice({ ...input, amountMinor: 0 }),
    source: 'PROMOTION' as const,
  };
}

export interface SelfServeInvoiceInput {
  orderNumber: string;
  lines: {
    subtotalMinor: number;
    planDiscount: { percentBps: number; amountMinor: number };
    coupon: { code: string; percentBps: number; amountMinor: number } | null;
    addOns: { code: string; title: string }[];
    totalBeforeTaxMinor: number;
  };
  tax: TaxLine[]; // worked out when the order was created
  credits: number;
  validityDays: number;
  payment: {
    provider: string;
    paymentId: string;
    method: string | null;
    paidAt: Date;
  };
  profile: BillingProfile; // as stored on the order
  supplier: Supplier;
  app: { appId: string; appName: string };
  now: Date;
}

/** A paid self-serve top-up: the quote's prices, discounts and coupon. */
export function buildSelfServeInvoice(input: SelfServeInvoiceInput) {
  const { lines, supplier } = input;
  const discountMinor =
    lines.planDiscount.amountMinor + (lines.coupon?.amountMinor ?? 0);
  const taxMinor = input.tax.reduce((sum, line) => sum + line.amountMinor, 0);
  const totalMinor = lines.totalBeforeTaxMinor + taxMinor;
  const {
    supplier: billedBy,
    customer,
    placeOfSupply,
    taxNote,
  } = parties(input.profile, supplier);

  return {
    templateVersion: INVOICE_TEMPLATE_VERSION,
    source: 'SELF_SERVE' as const,
    status: 'PAID' as const,
    settlement: 'GATEWAY' as const,
    issuedAt: input.now,
    paidAt: input.payment.paidAt,
    dueAt: null,
    currency: input.profile.currency,
    supplier: billedBy,
    customer,
    placeOfSupply,
    app: { ...input.app },
    orderNumber: input.orderNumber,
    lines: [
      {
        description: CREDITS_LINE_DESCRIPTION,
        sac: supplier.sac,
        quantity: 1,
        unitPriceMinor: lines.subtotalMinor,
        discountMinor,
        taxableMinor: lines.totalBeforeTaxMinor,
      },
    ],
    addOnLines: lines.addOns.map(({ code, title }) => ({ code, title })),
    discounts: {
      plan: lines.planDiscount.amountMinor
        ? {
            percentBps: lines.planDiscount.percentBps,
            amountMinor: lines.planDiscount.amountMinor,
          }
        : null,
      coupon: lines.coupon
        ? {
            code: lines.coupon.code,
            percentBps: lines.coupon.percentBps,
            amountMinor: lines.coupon.amountMinor,
          }
        : null,
    },
    tax: input.tax.map(({ type, rateBps, amountMinor }) => ({
      type,
      rateBps,
      amountMinor,
    })),
    taxNote,
    totals: {
      subtotalMinor: lines.subtotalMinor,
      discountMinor,
      taxableMinor: lines.totalBeforeTaxMinor,
      taxMinor,
      totalMinor,
      amountPaidMinor: totalMinor,
      balanceDueMinor: 0,
    },
    credits: input.credits,
    validityDays: input.validityDays,
    payment: {
      method: input.payment.method,
      reference: input.payment.paymentId,
      provider: input.payment.provider,
      paymentId: input.payment.paymentId,
      paidAt: input.payment.paidAt,
    },
    payNowUrl: null,
    voidedAt: null,
    voidReason: null,
  };
}

export type InvoiceFields =
  | ReturnType<typeof buildAdminInvoice>
  | ReturnType<typeof buildLinkPaidInvoice>
  | ReturnType<typeof buildPromotionInvoice>
  | ReturnType<typeof buildSelfServeInvoice>;
