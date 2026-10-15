import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';
import {
  RegistrationNumberTypes,
  TaxIdTypes,
} from '../../customer-onboarding/constants/identifier-types';

type CompanyIdentifiers = {
  countryOfRegistration?: string;
  registrationNumber?: string;
  registrationNumberType?: string;
  taxIdNumber?: string;
  taxIdType?: string;
};

function getCompanyIdentifierValidationError(
  company: CompanyIdentifiers,
): string | undefined {
  const identifiers = [
    {
      label: 'registration number',
      type: company.registrationNumberType,
      number: company.registrationNumber,
      mappings: RegistrationNumberTypes,
    },
    {
      label: 'tax ID',
      type: company.taxIdType,
      number: company.taxIdNumber,
      mappings: TaxIdTypes,
    },
  ];

  let hasIdentifier = false;
  for (const identifier of identifiers) {
    const hasType =
      typeof identifier.type === 'string' && !!identifier.type.trim();
    const hasNumber =
      typeof identifier.number === 'string' && !!identifier.number.trim();
    if (!hasType && !hasNumber) continue;
    hasIdentifier = true;

    if (
      typeof identifier.type !== 'string' ||
      typeof identifier.number !== 'string' ||
      !hasType ||
      !hasNumber
    ) {
      return `${identifier.label} type and number must both be provided`;
    }
    const mapping = identifier.mappings.find(
      (item) =>
        item.code === identifier.type &&
        (item.country === company.countryOfRegistration ||
          item.country === 'XX'),
    );
    if (!mapping) {
      return `${identifier.label} type ${identifier.type} is not supported for country ${company.countryOfRegistration}`;
    }
    if (mapping.regex && !mapping.regex.test(identifier.number)) {
      return `Invalid ${identifier.label} format for country ${company.countryOfRegistration}`;
    }
  }

  if (!hasIdentifier) {
    return 'At least one registration number or tax ID must be provided';
  }
}

export function IsValidCompanyIdentifiers(
  validationOptions?: ValidationOptions,
) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isValidCompanyIdentifiers',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(_value: unknown, args: ValidationArguments) {
          return !getCompanyIdentifierValidationError(
            args.object as CompanyIdentifiers,
          );
        },
        defaultMessage(args: ValidationArguments) {
          return getCompanyIdentifierValidationError(
            args.object as CompanyIdentifiers,
          );
        },
      },
    });
  };
}
