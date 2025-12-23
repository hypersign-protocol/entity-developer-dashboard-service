import {
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

@ValidatorConstraint({ async: false })
export class SanitizeUrlValidator implements ValidatorConstraintInterface {
  validate(urls: unknown[], args: ValidationArguments): boolean {
    if (!Array.isArray(urls)) return false;
    const invalid: unknown[] = [];
    // Filter & sanitize in one pass
    const cleanedUrls = urls.map((url) => {
      if (url === '*') return '*';
      if (typeof url !== 'string' || !url.trim()) {
        invalid.push(url);
        return url;
      }
      try {
        new URL(url);
      } catch {
        invalid.push(url);
      }
      return (url as string).replace(/\/$/, '');
    });

    if (invalid.length) {
      args.constraints = invalid;
      return false;
    }

    args.object['whitelistedCors'] = Array.from(new Set(cleanedUrls));
    return true;
  }

  defaultMessage(args: ValidationArguments) {
    return `${args.property} contains invalid entries: ${args.constraints?.join(
      ', ',
    )}. Only valid URLs or '*' are allowed.`;
  }
}
export function urlSanitizer(url, endsWith) {
  switch (endsWith) {
    case true: {
      if (url.endsWith('/')) {
        return url;
      } else {
        return url + '/';
      }
    }
    case false: {
      if (url.endsWith('/')) {
        return url.slice(0, -1);
      } else {
        return url;
      }
    }
    default:
      return url;
  }
}
