import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CustomerOnboardingBasicDto } from 'src/customer-onboarding/dto/create-customer-onboarding.dto';
import { isValidPhoneNumber } from './validate-phone-no-country.decorator';

describe('isValidPhoneNumber', () => {
  it.each([
    ['DE', '+49 23456789'],
    ['DE', '+49 2345 6789'],
    ['DE', '030 12345678'],
    ['DE', '+49 1512 3456789'],
    ['FR', '01 23 45 67 89'],
    ['GB', '07123 456789'],
    ['UK', '07123456789'], // the list's non-ISO code for GB
    ['IN', '9876543210'],
    ['IN', '+91 98765 43210'],
    ['US', '(202) 555-0123'],
    ['US', '+1 202 555 0123'],
    ['AE', '050 123 4567'],
    ['XX', '+49 30 12345678'], // unknown country: international form only
    ['DE', '+91 98765 43210'], // a number from another country
  ])('accepts %s %s', (country, phone) => {
    expect(isValidPhoneNumber(phone, country)).toBe(true);
  });

  it.each([
    ['DE', '123'],
    ['IN', '12345'],
    ['IN', '98765432101234'],
    ['US', 'not a number'],
    ['XX', '030 12345678'], // national form needs a known country
    ['DE', ''],
    ['DE', undefined],
  ])('rejects %s %s', (country, phone) => {
    expect(isValidPhoneNumber(phone, country)).toBe(false);
  });
});

describe('CustomerOnboardingBasicDto phoneNumber', () => {
  const errors = (body: object) =>
    validateSync(
      plainToInstance(CustomerOnboardingBasicDto, {
        type: 'BUSINESS',
        ...body,
      }),
    ).filter((e) => ['country', 'phoneNumber'].includes(e.property));

  it('accepts a German company with a German number', () => {
    expect(errors({ country: 'DE', phoneNumber: '+49 23456789' })).toEqual([]);
  });

  it('accepts no phone number', () => {
    expect(errors({ country: 'DE' })).toEqual([]);
  });

  it('rejects an invalid number with the existing message', () => {
    const [error] = errors({ country: 'DE', phoneNumber: '123' });
    expect(error.property).toBe('phoneNumber');
    expect(Object.values(error.constraints)).toEqual([
      'Invalid phone number format for country DE',
    ]);
  });

  it('still rejects a three-letter country code', () => {
    const props = errors({ country: 'DEU', phoneNumber: '+49 23456789' }).map(
      (e) => e.property,
    );
    expect(props).toContain('country');
  });
});
