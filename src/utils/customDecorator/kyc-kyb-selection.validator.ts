import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

@ValidatorConstraint({ async: false })
export class ExactlyOneTrueConstraint implements ValidatorConstraintInterface {
  validate(_: any, args: ValidationArguments) {
    const obj = args.object as any;
    const { isKyc, isKyb, isKycAndKyb } = obj;

    // exactly one must be true
    const trueCount = [isKyc, isKyb, isKycAndKyb].filter(Boolean).length;
    return trueCount === 1;
  }

  defaultMessage() {
    return 'Exactly one of isKyc, isKyb, or isKycAndKyb must be true';
  }
}

export function ExactlyOneTrue(validationOptions?: ValidationOptions) {
  return function (constructor: new (...args: any[]) => any) {
    registerDecorator({
      name: 'ExactlyOneTrue',
      target: constructor,
      propertyName: '', // class-level
      options: validationOptions,
      validator: ExactlyOneTrueConstraint,
    });
  };
}
