import {
  isPhoneNumber,
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

// CountryCode entries that aren't ISO 3166-1 alpha-2.
const REGION_ALIASES: Record<string, string> = { UK: 'GB' };

/** libphonenumber, via class-validator: see the constraint below. */
export function isValidPhoneNumber(phone: unknown, country?: string) {
  if (typeof phone !== 'string' || !phone.trim()) return false;
  const number = phone.trim();
  // +<code> names its own country; a national number is read in the selected
  // one. An unknown country (XX) only accepts the + form.
  if (number.startsWith('+')) return isPhoneNumber(number);
  if (!country) return false;
  return isPhoneNumber(number, (REGION_ALIASES[country] ?? country) as any);
}

/**
 * Validates phoneNumber with libphonenumber (bundled with class-validator), for
 * every country. A number in national format ("030 12345678") is read in the
 * selected country; one starting with +<code> ("+49 30 12345678") is read on
 * its own, so a company can give a number from another country. Spaces,
 * dashes and brackets are allowed.
 */
@ValidatorConstraint({ async: false })
export class IsPhoneNumberByCountryConstraint
  implements ValidatorConstraintInterface
{
  validate(_: any, args: ValidationArguments) {
    const obj = args.object as any;
    return isValidPhoneNumber(obj.phoneNumber, obj.country);
  }

  defaultMessage(args: ValidationArguments) {
    const obj = args.object as any;
    return `Invalid phone number format for country ${obj.country}`;
  }
}

export function IsPhoneNumberByCountry(validationOptions?: ValidationOptions) {
  return function (target: any, propertyName: string) {
    registerDecorator({
      target: target.constructor,
      propertyName,
      options: validationOptions,
      validator: IsPhoneNumberByCountryConstraint,
    });
  };
}
