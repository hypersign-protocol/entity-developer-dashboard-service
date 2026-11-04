import {
  buildBillingProfile,
  kybBillingDefaults,
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
    expect(kybBillingDefaults({ confirmedAt: new Date() }, company)).toEqual(
      {},
    );
    expect(
      kybBillingDefaults({ region: 'GLOBAL' }, company),
    ).not.toHaveProperty('billing.region');
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
