import { BillingErrorCode } from '../billing.constants';
import { BillingProfileService } from './billing-profile.service';

const lean = (value: unknown) => ({ lean: jest.fn().mockResolvedValue(value) });

describe('BillingProfileService region from the billing country', () => {
  const orgId = '665f17f9c2b4f5a6d7e8f900';
  const onboardingModel = {
    findOne: jest.fn(),
    findById: jest.fn(),
    findOneAndUpdate: jest.fn(),
  };
  const orderModel = { find: jest.fn() };
  let service: BillingProfileService;

  const inAddress = {
    street: '12 MG Road',
    city: 'Bengaluru',
    province: 'Karnataka',
    postalCode: '560001',
    country: 'IN',
  };
  const usAddress = {
    street: '1 Market St',
    city: 'San Francisco',
    province: 'CA',
    postalCode: '94105',
    country: 'US',
  };
  const dto = (overrides: Record<string, unknown> = {}) =>
    ({
      legalName: 'Acme',
      email: 'billing@acme.test',
      address: inAddress,
      gstStateCode: '29',
      taxIds: [],
      ...overrides,
    } as any);

  const givenOrg = (billing: Record<string, unknown> = {}) =>
    onboardingModel.findOne.mockReturnValue(
      lean({ _id: orgId, companyName: 'Acme', billing }),
    );
  const givenOpenOrders = (orders: { orderNumber: string }[]) =>
    orderModel.find.mockReturnValue({
      limit: jest.fn().mockReturnValue(lean(orders)),
    });
  const savedSet = () => onboardingModel.findOneAndUpdate.mock.calls[0][1].$set;

  beforeEach(() => {
    jest.clearAllMocks();
    onboardingModel.findOneAndUpdate.mockImplementation((_filter, update) =>
      lean({ _id: orgId, billing: update.$set }),
    );
    givenOpenOrders([]);
    service = new BillingProfileService(
      onboardingModel as any,
      orderModel as any,
    );
  });

  it('moves the region to the new billing country before any invoice', async () => {
    givenOrg({ region: 'IN', currency: 'INR', confirmedAt: new Date() });

    await service.save('user-1', dto({ address: usAddress }));

    expect(savedSet()).toMatchObject({
      'billing.region': 'GLOBAL',
      'billing.currency': 'USD',
    });
    expect(orderModel.find).toHaveBeenCalledWith(
      { orgId, status: { $in: expect.any(Array) } },
      { orderNumber: 1 },
    );
  });

  it('sets the region from the country on a first save', async () => {
    givenOrg();

    await service.save('user-1', dto());

    expect(savedSet()).toMatchObject({
      'billing.region': 'IN',
      'billing.currency': 'INR',
    });
    // No stored region, so nothing priced yet to check.
    expect(orderModel.find).not.toHaveBeenCalled();
  });

  it('refuses a country in another region while an order is open', async () => {
    givenOrg({ region: 'IN', confirmedAt: new Date() });
    givenOpenOrders([{ orderNumber: 'ORD-2026-000123' }]);

    await expect(
      service.save('user-1', dto({ address: usAddress })),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: BillingErrorCode.REGION_CHANGE_BLOCKED,
      }),
    });
    expect(onboardingModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('refuses a country in another region once invoiced', async () => {
    givenOrg({ region: 'IN', lockedAt: new Date(), confirmedAt: new Date() });

    await expect(
      service.save('user-1', dto({ address: usAddress })),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: BillingErrorCode.BILLING_PROFILE_LOCKED,
      }),
    });
    expect(onboardingModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('allows other changes to an invoiced profile in the same region', async () => {
    givenOrg({ region: 'IN', lockedAt: new Date(), confirmedAt: new Date() });

    await service.save(
      'user-1',
      dto({ address: { ...inAddress, city: 'Mysuru' } }),
    );

    expect(savedSet()).toMatchObject({ 'billing.region': 'IN' });
    expect(orderModel.find).not.toHaveBeenCalled();
  });

  it('takes the GST state from the province when none is sent', async () => {
    givenOrg();

    await service.save(
      'user-1',
      dto({
        gstStateCode: undefined,
        address: { ...inAddress, province: 'West Bengal' },
      }),
    );

    expect(savedSet()).toMatchObject({ 'billing.gstStateCode': '19' });
  });

  it('prefers the GSTIN state over the province', async () => {
    givenOrg();

    await service.save(
      'user-1',
      dto({
        gstStateCode: undefined,
        address: { ...inAddress, province: 'West Bengal' },
        taxIds: [{ type: 'GSTIN', number: '29ABCDE1234F1Z5' }],
      }),
    );

    expect(savedSet()).toMatchObject({ 'billing.gstStateCode': '29' });
  });

  it('refuses a GSTIN with a billing address outside India', async () => {
    givenOrg();

    await expect(
      service.save(
        'user-1',
        dto({
          address: usAddress,
          taxIds: [{ type: 'GSTIN', number: '29ABCDE1234F1Z5' }],
        }),
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: BillingErrorCode.VALIDATION_FAILED,
        details: {
          fields: {
            'taxIds[0].number':
              'A GSTIN can only be used with a billing address in India',
          },
        },
      }),
    });
  });

  it('lets a super admin change the region of an invoiced profile', async () => {
    onboardingModel.findById.mockReturnValue(
      lean({
        _id: orgId,
        billing: {
          region: 'IN',
          lockedAt: new Date(),
          confirmedAt: new Date(),
        },
      }),
    );

    await service.adminUpdate(
      orgId,
      dto({ address: usAddress, reason: 'Moved to the US entity' }),
      'admin-1',
    );

    expect(savedSet()).toMatchObject({
      'billing.region': 'GLOBAL',
      'billing.currency': 'USD',
    });
    // Open orders still block it, for a super admin too.
    expect(orderModel.find).toHaveBeenCalled();
  });

  it("keeps a super admin's explicit region over the country", async () => {
    onboardingModel.findById.mockReturnValue(
      lean({ _id: orgId, billing: { region: 'IN' } }),
    );

    await service.adminUpdate(
      orgId,
      dto({ region: 'IN', address: usAddress, reason: 'Indian entity' }),
      'admin-1',
    );

    expect(savedSet()).toMatchObject({ 'billing.region': 'IN' });
  });
});
