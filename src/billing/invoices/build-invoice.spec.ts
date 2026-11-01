import { buildBillingProfile } from '../profile/billing-profile';
import { buildAdminInvoice, priceAdminInvoice } from './build-invoice';
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
