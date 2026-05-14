import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

export function IsUrlOrBase64Image(options?: ValidationOptions) {
  return function (object: any, propertyName: string) {
    registerDecorator({
      name: 'IsImageUrlOrBase64',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate(value: any) {
          if (!value) return true; // allow empty if optional

          const urlRegex = /^(https?:\/\/)[^\s]+$/i;
          const base64Regex =
            /^data:(image\/(png|jpe?g|gif|webp));base64,[A-Za-z0-9+/=]+$/;

          return urlRegex.test(value) || base64Regex.test(value);
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} must be a valid URL or Base64 encoded image`;
        },
      },
    });
  };
}
