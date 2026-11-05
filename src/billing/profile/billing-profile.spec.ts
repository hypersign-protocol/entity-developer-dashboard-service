import {
  buildBillingProfile,
  kybApprovedBillingUpdate,
  kybBillingDefaults,
  kybPersonalTaxId,
  paymentMissingFields,
  taxIdProblem,
} from './billing-profile';

const address = {
  street: '12 MG Road',
  city: 'Bengaluru',
  province: 'Karnataka',
  postalCode: '560001',
  country: 'IN',
};

describe('buildBillingProfile', () => {
  it('prefills from onboarding and lists what is missing', () => {
    const profile = buildBillingProfile({
      _id: 'org-1',
      companyName: 'Acme',
      customerEmail: 'ops@acme.example',
      country: 'IND',
    });
    expect(profile).toMatchObject({
      orgId: 'org-1',
      legalName: 'Acme',
      email: 'ops@acme.example',
      address: null,
      region: 'IN',
      currency: 'INR',
      source: 'PREFILLED',
      complete: false,
      locked: false,
    });
    expect(profile.missingFields).toEqual([
      'address.street',
      'address.city',
      'address.province',
      'address.postalCode',
      'address.country',
      'gstStateCode',
    ]);
  });

  it('takes the GST state from the GSTIN and is complete once saved', () => {
    const profile = buildBillingProfile({
      _id: 'org-1',
      companyName: 'Acme',
      customerEmail: 'ops@acme.example',
      billing: {
        region: 'IN',
        address,
        taxIds: [{ type: 'GSTIN', number: '29ABCDE1234F1Z5' }],
        confirmedAt: new Date(),
      },
    });
    expect(profile.gstStateCode).toBe('29');
    expect(profile.complete).toBe(true);
    expect(profile.missingFields).toEqual([]);
  });

  it('needs no GST state outside India', () => {
    const profile = buildBillingProfile({
      _id: 'org-2',
      companyName: 'Globex',
      customerEmail: 'a@globex.example',
      billing: {
        address: { ...address, country: 'GB' },
        confirmedAt: new Date(),
      },
    });
    expect(profile).toMatchObject({
      region: 'GLOBAL',
      currency: 'USD',
      gstStateCode: null,
      complete: true,
    });
  });
});

describe('paymentMissingFields', () => {
  const saved = (region: 'IN' | 'GLOBAL', phone?: string) =>
    buildBillingProfile({
      _id: 'org-1',
      billing: {
        region,
        legalName: 'Acme',
        email: 'billing@acme.example',
        phone,
        address: { ...address, country: region === 'IN' ? 'IN' : 'DE' },
        gstStateCode: region === 'IN' ? '29' : undefined,
        confirmedAt: new Date(),
      },
    });

  it('asks Global customers for a phone before paying online', () => {
    expect(saved('GLOBAL').complete).toBe(true); // invoices don't need it
    expect(paymentMissingFields(saved('GLOBAL'))).toEqual(['phone']);
    expect(paymentMissingFields(saved('GLOBAL', '+493012345678'))).toEqual([]);
    expect(saved('GLOBAL', '+493012345678').phone).toBe('+493012345678');
  });

  it('does not need a phone for India', () => {
    expect(paymentMissingFields(saved('IN'))).toEqual([]);
  });
});

describe('taxIdProblem', () => {
  it('checks numbers against the known regexes', () => {
    expect(
      taxIdProblem({ type: 'GSTIN', number: '29ABCDE1234F1Z5' }),
    ).toBeNull();
    expect(taxIdProblem({ type: 'PAN', number: 'ABCDE1234F' })).toBeNull();
    expect(taxIdProblem({ type: 'GSTIN', number: '29ABC' })).toBe(
      'Not a valid GSTIN',
    );
    expect(taxIdProblem({ type: 'NOPE', number: '1' })).toBe(
      'Unknown tax ID type NOPE',
    );
  });
});

describe('kybBillingDefaults', () => {
  const company = {
    name: 'Acme Private Limited',
    countryOfRegistration: 'IN',
    taxIdType: 'gstin',
    taxIdNumber: '29abcde1234f1z5',
    address,
  };

  it('copies the KYB company into an empty profile', () => {
    expect(kybBillingDefaults(undefined, company)).toEqual({
      'billing.legalName': 'Acme Private Limited',
      'billing.address': address,
      'billing.taxIds': [{ type: 'GSTIN', number: '29ABCDE1234F1Z5' }],
      'billing.gstStateCode': '29',
      'billing.region': 'IN',
      'billing.currency': 'INR',
    });
  });

  it('never overwrites a saved profile or a stored region', () => {
    expect(
      kybBillingDefaults(
        {
          confirmedAt: new Date(),
          taxIds: [{ type: 'PAN', number: 'ABCDE1234F' }],
        },
        company,
      ),
    ).toEqual({});
    expect(
      kybBillingDefaults({ region: 'GLOBAL' }, company),
    ).not.toHaveProperty('billing.region');
  });

  it('adds only a missing company tax ID to a saved profile', () => {
    expect(
      kybBillingDefaults({ confirmedAt: new Date(), taxIds: [] }, company),
    ).toEqual({
      'billing.taxIds': [{ type: 'GSTIN', number: '29ABCDE1234F1Z5' }],
      'billing.gstStateCode': '29',
    });
    expect(
      kybBillingDefaults(
        { confirmedAt: new Date(), lockedAt: new Date() },
        company,
      ),
    ).toEqual({});
  });

  it('never copies a personal tax ID into taxIds', () => {
    const personal = {
      ...company,
      taxIdType: 'OTHER',
      taxIdNumber: 'ABCDE1234F',
    };
    expect(kybBillingDefaults(undefined, personal)).not.toHaveProperty([
      'billing.taxIds',
    ]);
    expect(kybBillingDefaults({ confirmedAt: new Date() }, personal)).toEqual(
      {},
    );
  });

  it('skips an invalid tax ID and an incomplete address', () => {
    const set = kybBillingDefaults(undefined, {
      ...company,
      taxIdNumber: 'bad',
      address: { ...address, postalCode: '' },
    });
    expect(set).not.toHaveProperty(['billing.taxIds']);
    expect(set).not.toHaveProperty(['billing.address']);
  });
});

describe('kybApprovedBillingUpdate', () => {
  const address = {
    street: '12 MG Road',
    city: 'Bengaluru',
    province: 'Karnataka',
    postalCode: '560001',
    country: 'IN',
  };
  const org = {
    _id: 'org-1',
    companyName: 'Acme',
    customerEmail: 'Billing@Acme.Example',
    billing: { region: 'IN', currency: 'INR', address, gstStateCode: '29' },
  };

  it('saves complete prefilled details, storing the fallbacks', () => {
    const set = kybApprovedBillingUpdate(org);
    expect(set).toEqual({
      'billing.legalName': 'Acme',
      'billing.email': 'billing@acme.example',
      'billing.region': 'IN',
      'billing.currency': 'INR',
      'billing.gstStateCode': '29',
      'billing.confirmedAt': expect.any(Date),
    });
    const saved = buildBillingProfile({
      ...org,
      billing: { ...org.billing, confirmedAt: new Date() },
    });
    expect(saved.complete).toBe(true);
  });

  it('leaves a profile the customer already saved', () => {
    expect(
      kybApprovedBillingUpdate({
        ...org,
        billing: { ...org.billing, confirmedAt: new Date() },
      }),
    ).toEqual({});
  });

  it('leaves incomplete details for the billing form', () => {
    expect(
      kybApprovedBillingUpdate({
        ...org,
        billing: { ...org.billing, address: { ...address, postalCode: '' } },
      }),
    ).toEqual({});
    expect(
      kybApprovedBillingUpdate({
        ...org,
        billing: { ...org.billing, gstStateCode: undefined },
      }),
    ).toEqual({});
    expect(kybApprovedBillingUpdate({ ...org, billing: undefined })).toEqual(
      {},
    );
  });

  it('needs no state code outside India', () => {
    const set = kybApprovedBillingUpdate({
      ...org,
      billing: {
        region: 'GLOBAL',
        currency: 'USD',
        address: { ...address, country: 'US' },
      },
    });
    expect(set).toMatchObject({ 'billing.region': 'GLOBAL' });
    expect(set).not.toHaveProperty(['billing.gstStateCode']);
  });
});

describe('kybPersonalTaxId', () => {
  const personal = (countryOfRegistration: string, taxIdNumber: string) =>
    kybPersonalTaxId({
      countryOfRegistration,
      taxIdType: 'OTHER',
      taxIdNumber,
    });

  it('keeps only the type and the last 4 characters', () => {
    expect(personal('IN', 'abcde 1234f')).toEqual({
      type: 'PAN',
      last4: '234F',
    });
  });

  it('marks anything but an Indian PAN as OTHER', () => {
    expect(personal('IN', '123456789012')).toEqual({
      type: 'OTHER',
      last4: '9012',
    });
    expect(personal('US', 'ABCDE1234F')).toEqual({
      type: 'OTHER',
      last4: '234F',
    });
  });

  it('ignores company tax IDs and numbers too short to mask', () => {
    expect(
      kybPersonalTaxId({
        countryOfRegistration: 'IN',
        taxIdType: 'PAN',
        taxIdNumber: 'ABCDE1234F',
      }),
    ).toBeNull();
    expect(personal('US', '1234')).toBeNull();
    expect(kybPersonalTaxId({ countryOfRegistration: 'US' })).toBeNull();
  });

  it('shows only the masked number on the profile', () => {
    const built = buildBillingProfile({
      _id: 'org-1',
      billing: { personalTaxId: { type: 'PAN', last4: '234F' } },
    });
    expect(built.personalTaxId).toEqual({
      type: 'PAN',
      number: 'XXXXXX234F',
    });
    expect(built.taxIds).toEqual([]);
  });
});
