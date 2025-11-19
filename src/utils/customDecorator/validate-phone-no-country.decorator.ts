import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { PhoneRegexMap } from 'src/customer-onboarding/constants/enum';

@ValidatorConstraint({ async: false })
export class IsPhoneNumberByCountryConstraint
  implements ValidatorConstraintInterface
{
  validate(_: any, args: ValidationArguments) {
    const obj = args.object as any;
    const country = obj.country;
    const phone = obj.phoneNumber;
    if (!country || !phone) return false;
    const regex = PhoneRegexMap[country];
    if (!regex) return false;
    return regex.test(phone);
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
