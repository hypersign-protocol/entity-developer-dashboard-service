import { HttpException, HttpStatus, ValidationPipe } from '@nestjs/common';
import { ValidationError } from 'class-validator';
import { BillingErrorCode } from './billing.constants';
import { PricingError } from './pricing/pricing';

const STATUS_TEXT: Partial<Record<HttpStatus, string>> = {
  [HttpStatus.BAD_REQUEST]: 'Bad Request',
  [HttpStatus.FORBIDDEN]: 'Forbidden',
  [HttpStatus.NOT_FOUND]: 'Not Found',
  [HttpStatus.CONFLICT]: 'Conflict',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'Unprocessable Entity',
  [HttpStatus.TOO_MANY_REQUESTS]: 'Too Many Requests',
  [HttpStatus.SERVICE_UNAVAILABLE]: 'Service Unavailable',
};

/**
 * The service's usual error body ({ statusCode, message: [...], error }) plus
 * the billing additions `code` and optional `details`.
 */
export class BillingException extends HttpException {
  constructor(
    status: HttpStatus,
    readonly code: BillingErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(
      {
        statusCode: status,
        error: STATUS_TEXT[status] || 'Error',
        code,
        message: [message],
        ...(details && { details }),
      },
      status,
    );
  }
}

const collectFieldErrors = (
  errors: ValidationError[],
  prefix = '',
  fields: Record<string, string> = {},
) => {
  for (const error of errors) {
    const path = prefix ? `${prefix}.${error.property}` : error.property;
    const first = error.constraints && Object.values(error.constraints)[0];
    if (first) fields[path] = first;
    if (error.children?.length)
      collectFieldErrors(error.children, path, fields);
  }
  return fields;
};

/** ValidationPipe whose errors carry code VALIDATION_FAILED and details.fields. */
export const billingValidationPipe = () =>
  new ValidationPipe({
    transform: true,
    whitelist: true,
    exceptionFactory: (errors) =>
      new BillingException(
        HttpStatus.BAD_REQUEST,
        BillingErrorCode.VALIDATION_FAILED,
        'The request is not valid.',
        { fields: collectFieldErrors(errors) },
      ),
  });

/** 422 for a selection the price book can't price. */
export const pricingException = (
  error: PricingError,
  custom: { minMinor: number; maxMinor: number },
) =>
  new BillingException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    BillingErrorCode[error.code],
    error.message,
    error.code === 'AMOUNT_OUT_OF_RANGE'
      ? { minMinor: custom.minMinor, maxMinor: custom.maxMinor }
      : undefined,
  );
