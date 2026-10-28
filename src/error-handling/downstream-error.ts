import { HttpException, HttpStatus } from '@nestjs/common';

export enum DownstreamService {
  ENTITY_API = 'ENTITY_API',
  KYC_SERVICE = 'KYC_SERVICE',
}

export enum DownstreamOperation {
  SSI_DID_CREATE = 'SSI_DID_CREATE',
  SSI_DID_RESOLVE = 'SSI_DID_RESOLVE',
  SSI_DID_REGISTER = 'SSI_DID_REGISTER',
  SSI_ISSUE_DID_JWT = 'SSI_ISSUE_DID_JWT',
  KYC_AUTH_EXCHANGE = 'KYC_AUTH_EXCHANGE',
  KYC_DOCUMENT_UPLOAD = 'KYC_DOCUMENT_UPLOAD',
  KYC_DOCUMENT_DELETE = 'KYC_DOCUMENT_DELETE',
  KYC_COMPANY_FETCH = 'KYC_COMPANY_FETCH',
  KYC_COMPANY_UPSERT = 'KYC_COMPANY_UPSERT',
  KYC_WIDGET_CREATE = 'KYC_WIDGET_CREATE',
  KYB_WIDGET_CREATE = 'KYB_WIDGET_CREATE',
}

export enum DownstreamErrorCategory {
  BUSINESS_ERROR = 'BUSINESS_ERROR',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  AUTHENTICATION_ERROR = 'AUTHENTICATION_ERROR',
  AUTHORIZATION_ERROR = 'AUTHORIZATION_ERROR',
  RESOURCE_NOT_FOUND = 'RESOURCE_NOT_FOUND',
  DOWNSTREAM_UNAVAILABLE = 'DOWNSTREAM_UNAVAILABLE',
  DOWNSTREAM_TIMEOUT = 'DOWNSTREAM_TIMEOUT',
  DOWNSTREAM_BAD_RESPONSE = 'DOWNSTREAM_BAD_RESPONSE',
  DOWNSTREAM_REJECTED = 'DOWNSTREAM_REJECTED',
}

export enum PublicErrorCode {
  INVALID_COMPANY_DETAILS = 'INVALID_COMPANY_DETAILS',
  COMPANY_ALREADY_EXISTS = 'COMPANY_ALREADY_EXISTS',
  INVALID_DOCUMENT = 'INVALID_DOCUMENT',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  SERVICE_TIMEOUT = 'SERVICE_TIMEOUT',
  UPSTREAM_ERROR = 'UPSTREAM_ERROR',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

export interface DownstreamErrorDiagnostic {
  service: DownstreamService;
  operation: DownstreamOperation;
  category: DownstreamErrorCategory;
  requestId: string;
  downstreamRequestId?: string;
  downstreamStatus?: number;
  method: string;
  diagnosticMessage?: string;
}

export interface DownstreamServiceExceptionOptions {
  status: HttpStatus;
  code: PublicErrorCode;
  publicMessage: string;
  diagnostic: DownstreamErrorDiagnostic;
  cause?: unknown;
}

function statusLabel(status: number): string {
  const enumName = HttpStatus[status];
  if (typeof enumName !== 'string') return 'Error';
  return enumName
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/**
 * A downstream failure whose serialized response is deliberately safe.
 * Technical context lives only in `diagnostic`; `message` is always public.
 */
export class DownstreamServiceException extends HttpException {
  readonly code: PublicErrorCode;
  readonly publicMessage: string;
  readonly diagnostic: Readonly<DownstreamErrorDiagnostic>;
  readonly originalCause?: unknown;

  constructor(options: DownstreamServiceExceptionOptions) {
    super(
      {
        statusCode: options.status,
        message: [options.publicMessage],
        error: statusLabel(options.status),
        code: options.code,
        requestId: options.diagnostic.requestId,
      },
      options.status,
    );
    this.name = DownstreamServiceException.name;
    this.message = options.publicMessage;
    this.code = options.code;
    this.publicMessage = options.publicMessage;
    this.diagnostic = Object.freeze({ ...options.diagnostic });
    Object.defineProperty(this, 'diagnostic', { enumerable: false });
    Object.defineProperty(this, 'originalCause', {
      value: options.cause,
      enumerable: false,
      configurable: false,
      writable: false,
    });
  }
}

const MAX_DIAGNOSTIC_LENGTH = 1000;

/** Redacts common credentials and personal identifiers before internal logging. */
export function sanitizeDiagnosticText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text = String(value)
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [redacted]')
    .replace(
      /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
      '[jwt-redacted]',
    )
    .replace(
      /([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi,
      '$1[credentials-redacted]@',
    )
    .replace(
      /["']?(password|passwd|pwd|secret|token|access[_-]?token|refresh[_-]?token|client[_-]?secret|api[_-]?key|authorization|cookie|set-cookie)["']?\s*[:=]\s*["'][^"']*["']/gi,
      '$1=[redacted]',
    )
    .replace(
      /\b(password|passwd|pwd|secret|token|access[_-]?token|refresh[_-]?token|client[_-]?secret|api[_-]?key|authorization|cookie|set-cookie)\s*[:=]\s*[^\s,;}&]+/gi,
      '$1=[redacted]',
    )
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email-redacted]')
    .replace(/\b\d{4}\s?\d{4}\s?\d{4}\b/g, '[identifier-redacted]');
  return text.length > MAX_DIAGNOSTIC_LENGTH
    ? `${text.slice(0, MAX_DIAGNOSTIC_LENGTH)}…`
    : text;
}
