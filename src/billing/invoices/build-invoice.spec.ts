import { buildBillingProfile } from '../profile/billing-profile';
import { indiaGst } from '../tax/india-gst';
import {
  buildAdminInvoice,
  buildLinkPaidInvoice,
  buildSelfServeInvoice,
  priceAdminInvoice,
} from './build-invoice';
import { Supplier, supplierProblems } from './supplier';

const supplier: Supplier = {
  legalName: 'Hypermine Technologies Private Limited',
  email: 'billing@hypersign.id',
  address: {
    street: '12 MG Road',
    city: 'Bengaluru',
    province: 'Karnataka',
    postalCode: '560001',
    country: 'IN',
  },
  gstin: '29AAAAA0000A1Z5',
  pan: 'AAAAA0000A',
  cin: null,
  lutArn: null,
  stateCode: '29',
  sac: '998314',
  invoicePrefix: 'HS',
};

const profile = (region: 'IN' | 'GLOBAL', gstStateCode?: string) =>
  buildBillingProfile({
    _id: 'org-1',
    companyName: 'Acme',
    customerEmail: 'billing@acme.example',
    billing: {
      region,
      address: {
        street: '4 Linking Road',
        city: 'Mumbai',
        province: 'Maharashtra',
        postalCode: '400050',
        country: region === 'IN' ? 'IN' : 'GB',
      },
      taxIds:
        region === 'IN'
          ? [{ type: 'GSTIN', number: `${gstStateCode}ABCDE1234F1Z5` }]
          : [],
      confirmedAt: new Date(),
    },
  });

const base = {
  credits: 40000,
  validityDays: 30,
  supplier,
  app: { appId: 'app-1', appName: 'Acme KYC' },
  addOnLines: [{ code: 'VALIDITY', title: 'Credit validity' }],
  now: new Date('2026-11-01T09:00:00Z'),
};
const paid = {
  method: 'BANK_TRANSFER' as const,
  reference: 'UTR0012345678',
  paidAt: new Date('2026-10-30T00:00:00Z'),
};

describe('buildAdminInvoice', () => {
  it('issues an already-paid Indian invoice with IGST across states', () => {
    const invoice = buildAdminInvoice({
      ...base,
      amountMinor: 4000000,
      payment: paid,
      profile: profile('IN', '27'),
    });
    expect(invoice).toMatchObject({
      templateVersion: 'invoice-v1',
      status: 'PAID',
      settlement: 'OFFLINE',
      currency: 'INR',
      paidAt: paid.paidAt,
      placeOfSupply: { code: '27', name: 'Maharashtra' },
      customer: {
        legalName: 'Acme',
        gstStateCode: '27',
        taxIds: [{ type: 'GSTIN', number: '27ABCDE1234F1Z5' }],
      },
      supplier: { gstin: '29AAAAA0000A1Z5' },
      lines: [
        {
          description: 'Prepaid verification credits',
          sac: '998314',
          quantity: 1,
          unitPriceMinor: 4000000,
          taxableMinor: 4000000,
        },
      ],
      tax: [{ type: 'IGST', rateBps: 1800, amountMinor: 720000 }],
      taxNote: 'Tax is payable on reverse charge: No.',
      totals: {
        subtotalMinor: 4000000,
        taxableMinor: 4000000,
        taxMinor: 720000,
        totalMinor: 4720000,
        amountPaidMinor: 4720000,
        balanceDueMinor: 0,
      },
      payment: {
        method: 'BANK_TRANSFER',
        reference: 'UTR0012345678',
        provider: null,
      },
      credits: 40000,
      validityDays: 30,
    });
  });

  it('splits CGST and SGST for a customer in Karnataka', () => {
    const invoice = buildAdminInvoice({
      ...base,
      amountMinor: 4000000,
      payment: paid,
      profile: profile('IN', '29'),
    });
    expect(invoice.tax).toEqual([
      { type: 'CGST', rateBps: 900, amountMinor: 360000 },
      { type: 'SGST', rateBps: 900, amountMinor: 360000 },
    ]);
  });

  it('issues a complimentary invoice with nothing to pay', () => {
    const invoice = buildAdminInvoice({
      ...base,
      amountMinor: 0,
      profile: profile('IN', '27'),
    });
    expect(invoice).toMatchObject({
      settlement: 'COMPLIMENTARY',
      paidAt: base.now,
      tax: [],
      payment: null,
      totals: { totalMinor: 0, amountPaidMinor: 0, taxMinor: 0 },
    });
  });

  it('charges no tax for Global and marks it an export', () => {
    const invoice = buildAdminInvoice({
      ...base,
      amountMinor: 50000,
      payment: paid,
      profile: profile('GLOBAL'),
    });
    expect(invoice).toMatchObject({
      currency: 'USD',
      tax: [],
      placeOfSupply: { code: '96', name: 'Other Countries' },
      taxNote:
        'Supply meant for export of services under LUT without payment of IGST.',
      customer: { gstStateCode: null },
      totals: { totalMinor: 50000 },
    });
  });

  it('prices the live preview the same way', () => {
    expect(priceAdminInvoice(4000000, 'IN', '27', '29').totals.totalMinor).toBe(
      4720000,
    );
    expect(priceAdminInvoice(0, 'IN', '27', '29').tax).toEqual([]);
  });
});

describe('supplierProblems', () => {
  it('accepts consistent settings', () => {
    expect(supplierProblems(supplier)).toEqual([]);
  });

  it('reports missing and inconsistent settings', () => {
    expect(
      supplierProblems({
        ...supplier,
        legalName: '',
        stateCode: '27',
        pan: 'BBBBB0000B',
      }),
    ).toEqual([
      'BILLING_SUPPLIER_LEGAL_NAME is not set',
      'BILLING_SUPPLIER_GSTIN must start with BILLING_SUPPLIER_STATE_CODE',
      'BILLING_SUPPLIER_PAN must match characters 3–12 of the GSTIN',
    ]);
  });
});

describe('buildSelfServeInvoice', () => {
  // ₹2,499 plan, 25% plan discount, FOUNDING8: the shared fixture.
  const lines = {
    subtotalMinor: 249900,
    planDiscount: { percentBps: 2500, amountMinor: 62475 },
    coupon: { code: 'FOUNDING8', percentBps: 800, amountMinor: 14994 },
    addOns: [{ code: 'VALIDITY', title: 'Credit validity' }],
    totalBeforeTaxMinor: 172431,
  };
  const input = (gstStateCode: string) => ({
    orderNumber: 'ORD-2026-000123',
    lines,
    tax: indiaGst(172431, gstStateCode, '29').lines,
    credits: 2499,
    validityDays: 30,
    payment: {
      provider: 'razorpay',
      paymentId: 'pay_123',
      method: 'upi',
      paidAt: new Date('2026-11-01T08:59:00Z'),
    },
    profile: profile('IN', gstStateCode),
    supplier,
    app: base.app,
    now: base.now,
  });

  it('prints the quote: discounts, coupon, IGST and the gateway payment', () => {
    const invoice = buildSelfServeInvoice(input('27'));
    expect(invoice).toMatchObject({
      source: 'SELF_SERVE',
      status: 'PAID',
      settlement: 'GATEWAY',
      orderNumber: 'ORD-2026-000123',
      lines: [
        {
          unitPriceMinor: 249900,
          discountMinor: 77469,
          taxableMinor: 172431,
        },
      ],
      discounts: {
        plan: { percentBps: 2500, amountMinor: 62475 },
        coupon: { code: 'FOUNDING8', percentBps: 800, amountMinor: 14994 },
      },
      tax: [{ type: 'IGST', rateBps: 1800, amountMinor: 31038 }],
      placeOfSupply: { code: '27', name: 'Maharashtra' },
      totals: {
        subtotalMinor: 249900,
        discountMinor: 77469,
        taxableMinor: 172431,
        taxMinor: 31038,
        totalMinor: 203469,
        amountPaidMinor: 203469,
        balanceDueMinor: 0,
      },
      payment: {
        method: 'upi',
        reference: 'pay_123',
        provider: 'razorpay',
        paymentId: 'pay_123',
      },
      addOnLines: [{ code: 'VALIDITY', title: 'Credit validity' }],
    });
  });

  it('splits CGST and SGST in our state, and omits an empty plan discount', () => {
    const invoice = buildSelfServeInvoice({
      ...input('29'),
      lines: {
        ...lines,
        planDiscount: { percentBps: 0, amountMinor: 0 },
        coupon: null,
      },
    });
    expect(invoice.tax.map((t) => t.type)).toEqual(['CGST', 'SGST']);
    expect(invoice.discounts).toEqual({ plan: null, coupon: null });
  });
});

describe('buildLinkPaidInvoice', () => {
  it('is a super-admin invoice settled by the gateway', () => {
    const invoice = buildLinkPaidInvoice({
      ...base,
      amountMinor: 4000000,
      profile: profile('IN', '27'),
      orderNumber: 'ORD-2026-000009',
      payment: {
        provider: 'razorpay',
        paymentId: 'pay_9',
        method: 'netbanking',
        paidAt: new Date('2026-11-05T10:00:00Z'),
      },
    });
    expect(invoice).toMatchObject({
      source: 'ADMIN',
      status: 'PAID',
      settlement: 'GATEWAY',
      orderNumber: 'ORD-2026-000009',
      tax: [{ type: 'IGST', rateBps: 1800, amountMinor: 720000 }],
      totals: { totalMinor: 4720000, balanceDueMinor: 0 },
      paidAt: new Date('2026-11-05T10:00:00Z'),
      payment: {
        method: 'netbanking',
        reference: 'pay_9',
        provider: 'razorpay',
        paymentId: 'pay_9',
      },
    });
  });
});
