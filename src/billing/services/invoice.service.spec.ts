import { InvoiceService } from './invoice.service';

const lean = (value) => ({ lean: jest.fn().mockResolvedValue(value) });

const SUPPLIER_ENV = {
  BILLING_SUPPLIER_LEGAL_NAME: 'Hypermine Technologies Private Limited',
  BILLING_SUPPLIER_EMAIL: 'billing@hypersign.id',
  BILLING_SUPPLIER_STREET: '12 MG Road',
  BILLING_SUPPLIER_CITY: 'Bengaluru',
  BILLING_SUPPLIER_PROVINCE: 'Karnataka',
  BILLING_SUPPLIER_POSTAL_CODE: '560001',
  BILLING_SUPPLIER_COUNTRY: 'IN',
  BILLING_SUPPLIER_GSTIN: '29AAAAA0000A1Z5',
  BILLING_SUPPLIER_PAN: 'AAAAA0000A',
  BILLING_SUPPLIER_STATE_CODE: '29',
  BILLING_SAC_CODE: '998314',
  BILLING_INVOICE_PREFIX: 'HS',
};

const app = {
  appId: 'app-1',
  appName: 'Acme KYC',
  userId: 'owner-1',
  orgId: 'org-1',
  services: [{ id: 'CAVACH_API' }],
};
const org = (billing: object = {}) => ({
  _id: 'org-1',
  companyName: 'Acme',
  customerEmail: 'billing@acme.example',
  billing: {
    region: 'IN',
    address: {
      street: '4 Linking Road',
      city: 'Mumbai',
      province: 'Maharashtra',
      postalCode: '400050',
      country: 'IN',
    },
    taxIds: [{ type: 'GSTIN', number: '27ABCDE1234F1Z5' }],
    confirmedAt: new Date(),
    ...billing,
  },
});
const paidDto = {
  appId: 'app-1',
  credits: 40000,
  validityDays: 30,
  amountMinor: 4000000,
  isPaid: true,
  payment: {
    method: 'BANK_TRANSFER' as const,
    reference: 'UTR0012345678',
    paidAt: '2026-10-30',
  },
};

describe('InvoiceService.createAdmin', () => {
  const session = {
    withTransaction: jest.fn((fn) => fn()),
    endSession: jest.fn(),
  };
  const connection = { startSession: jest.fn().mockResolvedValue(session) };
  const invoiceModel = {
    findOne: jest.fn(),
    create: jest.fn(),
    updateOne: jest.fn(),
  };
  const counterModel = { findOneAndUpdate: jest.fn() };
  const onboardingModel = { findOne: jest.fn(), updateOne: jest.fn() };
  const appModel = { findOne: jest.fn() };
  const creditPlanModel = { findOneAndUpdate: jest.fn(), exists: jest.fn() };
  const priceBookModel = { findOne: jest.fn() };
  const creditService = { grantCredit: jest.fn() };
  let service: InvoiceService;

  beforeEach(() => {
    jest.clearAllMocks();
    Object.assign(process.env, SUPPLIER_ENV);
    invoiceModel.findOne.mockReturnValue(lean(null));
    invoiceModel.create.mockImplementation(async ([doc]) => [
      { toObject: () => ({ _id: 'inv-1', ...doc }) },
    ]);
    counterModel.findOneAndUpdate.mockResolvedValue({ seq: 7 });
    appModel.findOne.mockReturnValue(lean(app));
    onboardingModel.findOne.mockReturnValue(lean(org()));
    priceBookModel.findOne.mockReturnValue(
      lean({ addOns: [{ code: 'VALIDITY', title: 'Credit validity' }] }),
    );
    creditService.grantCredit.mockResolvedValue({ message: 'ok' });
    creditPlanModel.findOneAndUpdate.mockResolvedValue({ _id: 'plan-1' });
    service = new InvoiceService(
      connection as any,
      invoiceModel as any,
      counterModel as any,
      onboardingModel as any,
      appModel as any,
      creditPlanModel as any,
      priceBookModel as any,
      creditService as any,
    );
  });

  it('issues a numbered paid invoice, then grants its credits once', async () => {
    const result = await service.createAdmin(paidDto, 'sa-1', 'key-1');

    expect(counterModel.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: expect.stringMatching(/^INV\/IN\/\d{4}-\d{2}$/) },
      { $inc: { seq: 1 } },
      expect.objectContaining({ upsert: true, session }),
    );
    const stored = invoiceModel.create.mock.calls[0][0][0];
    expect(stored).toMatchObject({
      invoiceNumber: expect.stringMatching(/^HS\/IN\/\d{4}-\d{2}\/000007$/),
      series: 'IN',
      orgId: 'org-1',
      createdBy: 'sa-1',
      idempotencyKey: 'key-1',
      settlement: 'OFFLINE',
      tax: [{ type: 'IGST', rateBps: 1800, amountMinor: 720000 }],
      totals: { totalMinor: 4720000 },
      addOnLines: [{ code: 'VALIDITY', title: 'Credit validity' }],
    });
    expect(creditService.grantCredit).toHaveBeenCalledWith(
      'app-1',
      {
        amount: '40000',
        validityPeriod: 30,
        validityPeriodUnit: 'Days',
        amountDenom: 'credits',
      },
      'sa-1',
      'MANUAL_RECHARGE',
      'invoice:inv-1',
    );
    expect(creditPlanModel.findOneAndUpdate).toHaveBeenCalledWith(
      { serviceId: 'app-1', referenceId: 'invoice:inv-1' },
      { $set: { invoiceId: 'inv-1' } },
      expect.anything(),
    );
    expect(onboardingModel.updateOne).toHaveBeenCalledWith(
      { _id: 'org-1', 'billing.lockedAt': { $exists: false } },
      { $set: { 'billing.lockedAt': expect.any(Date) } },
    );
    expect(result).toMatchObject({
      paymentLink: null,
      invoice: {
        invoiceId: 'inv-1',
        status: 'PAID',
        settlement: 'OFFLINE',
        creditPlanId: 'plan-1',
        totalMinor: 4720000,
      },
    });
  });

  it('issues Free credits as a complimentary ₹0 invoice', async () => {
    await service.createAdmin(
      { appId: 'app-1', credits: 5000, validityDays: 30, amountMinor: 0 },
      'sa-1',
      'key-2',
    );
    expect(invoiceModel.create.mock.calls[0][0][0]).toMatchObject({
      settlement: 'COMPLIMENTARY',
      payment: null,
      tax: [],
      totals: { totalMinor: 0 },
    });
  });

  it('returns the first invoice on a retry with the same key, granting only if still missing', async () => {
    const first = invoiceModel.create;
    await service.createAdmin(paidDto, 'sa-1', 'key-1');
    const stored = { _id: 'inv-1', ...first.mock.calls[0][0][0] };
    jest.clearAllMocks();
    invoiceModel.findOne.mockReturnValue(
      lean({ ...stored, creditPlanId: 'plan-1' }),
    );

    const retry = await service.createAdmin(paidDto, 'sa-1', 'key-1');

    expect(invoiceModel.create).not.toHaveBeenCalled();
    expect(creditService.grantCredit).not.toHaveBeenCalled();
    expect(retry.invoice.invoiceId).toBe('inv-1');
  });

  it('refuses a reused key with a different body', async () => {
    invoiceModel.findOne.mockReturnValue(
      lean({ _id: 'inv-1', requestHash: 'something-else' }),
    );
    await expect(
      service.createAdmin(paidDto, 'sa-1', 'key-1'),
    ).rejects.toMatchObject({
      code: 'IDEMPOTENCY_KEY_REUSED',
    });
  });

  it.each([
    [
      'an incomplete profile',
      () =>
        onboardingModel.findOne.mockReturnValue(
          lean(org({ confirmedAt: undefined })),
        ),
      paidDto,
      'BILLING_PROFILE_INCOMPLETE',
    ],
    [
      'Collect payment',
      () => undefined,
      { ...paidDto, isPaid: false, payment: undefined },
      'PAYMENTS_NOT_AVAILABLE',
    ],
    [
      'an SSI app',
      () =>
        appModel.findOne.mockReturnValue(
          lean({ ...app, services: [{ id: 'SSI_API' }] }),
        ),
      paidDto,
      'APP_NOT_BILLABLE',
    ],
    [
      'missing settings',
      () => delete process.env.BILLING_SUPPLIER_GSTIN,
      paidDto,
      'BILLING_NOT_CONFIGURED',
    ],
    [
      'a paid date in the future',
      () => undefined,
      { ...paidDto, payment: { ...paidDto.payment, paidAt: '2999-01-01' } },
      'VALIDATION_FAILED',
    ],
  ])('refuses %s without issuing anything', async (_, arrange, dto, code) => {
    arrange();
    await expect(
      service.createAdmin(dto as any, 'sa-1', 'key-3'),
    ).rejects.toMatchObject({ code });
    expect(invoiceModel.create).not.toHaveBeenCalled();
    expect(creditService.grantCredit).not.toHaveBeenCalled();
  });

  it('keeps the invoice and asks for a retry when the grant fails', async () => {
    creditService.grantCredit.mockRejectedValue(new Error('redis down'));
    const error = await service
      .createAdmin(paidDto, 'sa-1', 'key-4')
      .catch((e) => e);
    expect(error.getStatus()).toBe(500);
    expect(error.getResponse().message[0]).toMatch(
      /was issued, but the credits could not be granted yet/,
    );
    expect(invoiceModel.create).toHaveBeenCalledTimes(1);
  });
});
