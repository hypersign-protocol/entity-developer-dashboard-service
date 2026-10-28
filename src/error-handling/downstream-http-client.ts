import { HttpStatus, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  DownstreamErrorCategory,
  DownstreamOperation,
  DownstreamService,
  DownstreamServiceException,
  PublicErrorCode,
  sanitizeDiagnosticText,
} from './downstream-error';

const MAX_RESPONSE_BYTES = 1024 * 1024;

type ResponseValidator = (payload: unknown) => boolean;

export interface DownstreamRequestOptions {
  url: string;
  init: RequestInit;
  service: DownstreamService;
  operation: DownstreamOperation;
  requestId?: string;
  timeoutMs: number;
  validateResponse?: ResponseValidator;
}

interface PublicMapping {
  status: HttpStatus;
  code: PublicErrorCode;
  message: string;
  category: DownstreamErrorCategory;
}

function extractMessages(payload: any): string[] {
  const value =
    payload?.error?.details ?? payload?.message ?? payload?.error ?? undefined;
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === 'string' && value.trim()) return [value];
  return [];
}

function extractBusinessCode(payload: any): string | undefined {
  const value = payload?.error?.businessCode ?? payload?.businessCode;
  return typeof value === 'string' ? value : undefined;
}

function allowedBusinessMapping(
  operation: DownstreamOperation,
  status: number,
  businessCode?: string,
): PublicMapping | undefined {
  if (
    operation === DownstreamOperation.KYC_COMPANY_UPSERT &&
    status === HttpStatus.CONFLICT &&
    businessCode === PublicErrorCode.COMPANY_ALREADY_EXISTS
  ) {
    return {
      status: HttpStatus.CONFLICT,
      code: PublicErrorCode.COMPANY_ALREADY_EXISTS,
      message: 'A company with the same registration details already exists.',
      category: DownstreamErrorCategory.BUSINESS_ERROR,
    };
  }

  if (
    operation === DownstreamOperation.KYC_COMPANY_UPSERT &&
    status === HttpStatus.BAD_REQUEST &&
    businessCode === PublicErrorCode.INVALID_COMPANY_DETAILS
  ) {
    return {
      status: HttpStatus.BAD_REQUEST,
      code: PublicErrorCode.INVALID_COMPANY_DETAILS,
      message:
        'The company information does not meet the verification requirements. Review the fields and documents and try again.',
      category: DownstreamErrorCategory.VALIDATION_ERROR,
    };
  }

  if (
    operation === DownstreamOperation.KYC_DOCUMENT_UPLOAD &&
    status === HttpStatus.BAD_REQUEST &&
    businessCode === PublicErrorCode.INVALID_DOCUMENT
  ) {
    return {
      status: HttpStatus.BAD_REQUEST,
      code: PublicErrorCode.INVALID_DOCUMENT,
      message: 'The document is invalid or unsupported.',
      category: DownstreamErrorCategory.VALIDATION_ERROR,
    };
  }

  return undefined;
}

function failureMapping(status: number): PublicMapping {
  if (
    status === HttpStatus.REQUEST_TIMEOUT ||
    status === HttpStatus.GATEWAY_TIMEOUT
  ) {
    return timeoutMapping();
  }
  if (
    status === HttpStatus.TOO_MANY_REQUESTS ||
    status === HttpStatus.SERVICE_UNAVAILABLE
  ) {
    return unavailableMapping();
  }
  if (status === HttpStatus.UNAUTHORIZED) {
    return {
      status: HttpStatus.BAD_GATEWAY,
      code: PublicErrorCode.UPSTREAM_ERROR,
      message:
        'A required service could not complete the request. Please try again later.',
      category: DownstreamErrorCategory.AUTHENTICATION_ERROR,
    };
  }
  if (status === HttpStatus.FORBIDDEN) {
    return {
      status: HttpStatus.BAD_GATEWAY,
      code: PublicErrorCode.UPSTREAM_ERROR,
      message:
        'A required service could not complete the request. Please try again later.',
      category: DownstreamErrorCategory.AUTHORIZATION_ERROR,
    };
  }
  if (status === HttpStatus.NOT_FOUND) {
    return {
      status: HttpStatus.BAD_GATEWAY,
      code: PublicErrorCode.UPSTREAM_ERROR,
      message:
        'A required service returned an inconsistent result. Please try again later.',
      category: DownstreamErrorCategory.RESOURCE_NOT_FOUND,
    };
  }
  return {
    status: HttpStatus.BAD_GATEWAY,
    code: PublicErrorCode.UPSTREAM_ERROR,
    message:
      'A required service could not complete the request. Please try again later.',
    category:
      status >= 500
        ? DownstreamErrorCategory.DOWNSTREAM_BAD_RESPONSE
        : DownstreamErrorCategory.DOWNSTREAM_REJECTED,
  };
}

function timeoutMapping(): PublicMapping {
  return {
    status: HttpStatus.GATEWAY_TIMEOUT,
    code: PublicErrorCode.SERVICE_TIMEOUT,
    message:
      'A required service took too long to respond. Please try again later.',
    category: DownstreamErrorCategory.DOWNSTREAM_TIMEOUT,
  };
}

function unavailableMapping(): PublicMapping {
  return {
    status: HttpStatus.SERVICE_UNAVAILABLE,
    code: PublicErrorCode.SERVICE_UNAVAILABLE,
    message:
      'A required service is temporarily unavailable. Please try again later.',
    category: DownstreamErrorCategory.DOWNSTREAM_UNAVAILABLE,
  };
}

function badResponseMapping(): PublicMapping {
  return {
    status: HttpStatus.BAD_GATEWAY,
    code: PublicErrorCode.UPSTREAM_ERROR,
    message:
      'A required service returned an invalid response. Please try again later.',
    category: DownstreamErrorCategory.DOWNSTREAM_BAD_RESPONSE,
  };
}

async function readResponseText(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new Error('Downstream response exceeded the maximum allowed size');
  }
  if (!response.body) return '';

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let text = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error('Downstream response exceeded the maximum allowed size');
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

function createException(
  mapping: PublicMapping,
  diagnostic: {
    service: DownstreamService;
    operation: DownstreamOperation;
    requestId: string;
    method: string;
    downstreamStatus?: number;
    downstreamRequestId?: string;
    diagnosticMessage?: string;
  },
  cause?: unknown,
): DownstreamServiceException {
  return new DownstreamServiceException({
    status: mapping.status,
    code: mapping.code,
    publicMessage: mapping.message,
    diagnostic: {
      ...diagnostic,
      category: mapping.category,
      diagnosticMessage: sanitizeDiagnosticText(diagnostic.diagnosticMessage),
    },
    cause,
  });
}

function logFailure(exception: DownstreamServiceException): void {
  const diagnostic = exception.diagnostic;
  const logEntry = JSON.stringify({
    event: 'downstream_request_failed',
    requestId: diagnostic.requestId,
    downstreamRequestId: diagnostic.downstreamRequestId,
    service: diagnostic.service,
    operation: diagnostic.operation,
    method: diagnostic.method,
    downstreamStatus: diagnostic.downstreamStatus,
    category: diagnostic.category,
    publicCode: exception.code,
    diagnosticMessage: diagnostic.diagnosticMessage,
  });
  if (
    diagnostic.category === DownstreamErrorCategory.BUSINESS_ERROR ||
    diagnostic.category === DownstreamErrorCategory.VALIDATION_ERROR
  ) {
    Logger.warn(logEntry, 'DownstreamHttpClient');
  } else {
    Logger.error(logEntry, undefined, 'DownstreamHttpClient');
  }
}

export async function requestDownstreamJson<T = any>(
  options: DownstreamRequestOptions,
): Promise<T> {
  const requestId = options.requestId || randomUUID();
  const method = options.init.method || 'GET';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  const headers = new Headers(options.init.headers || {});
  headers.set('x-request-id', requestId);

  try {
    const response = await fetch(options.url, {
      ...options.init,
      headers,
      signal: controller.signal,
    });
    let text: string;
    try {
      text = await readResponseText(response);
    } catch (error: any) {
      const exception = createException(
        controller.signal.aborted ? timeoutMapping() : badResponseMapping(),
        {
          service: options.service,
          operation: options.operation,
          requestId,
          method,
          downstreamStatus: response.status,
          downstreamRequestId:
            response.headers.get('x-request-id') || undefined,
          diagnosticMessage: error?.message,
        },
        error,
      );
      logFailure(exception);
      throw exception;
    }

    let payload: any = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch (error: any) {
        const exception = createException(
          badResponseMapping(),
          {
            service: options.service,
            operation: options.operation,
            requestId,
            method,
            downstreamStatus: response.status,
            downstreamRequestId:
              response.headers.get('x-request-id') || undefined,
            diagnosticMessage: `Downstream response was not valid JSON; response body omitted (${text.length} characters)`,
          },
          error,
        );
        logFailure(exception);
        throw exception;
      }
    }

    if (!response.ok) {
      const messages = extractMessages(payload);
      const businessCode = extractBusinessCode(payload);
      const mapping =
        allowedBusinessMapping(
          options.operation,
          response.status,
          businessCode,
        ) || failureMapping(response.status);
      const exception = createException(mapping, {
        service: options.service,
        operation: options.operation,
        requestId,
        method,
        downstreamStatus: response.status,
        downstreamRequestId: response.headers.get('x-request-id') || undefined,
        diagnosticMessage:
          messages.join('; ') ||
          `Downstream error response body omitted (${text.length} characters)`,
      });
      logFailure(exception);
      throw exception;
    }

    if (options.validateResponse && !options.validateResponse(payload)) {
      const exception = createException(badResponseMapping(), {
        service: options.service,
        operation: options.operation,
        requestId,
        method,
        downstreamStatus: response.status,
        downstreamRequestId: response.headers.get('x-request-id') || undefined,
        diagnosticMessage: 'Successful response failed schema validation',
      });
      logFailure(exception);
      throw exception;
    }

    return payload as T;
  } catch (error: any) {
    if (error instanceof DownstreamServiceException) throw error;
    const mapping = controller.signal.aborted
      ? timeoutMapping()
      : unavailableMapping();
    const exception = createException(
      mapping,
      {
        service: options.service,
        operation: options.operation,
        requestId,
        method,
        diagnosticMessage: error?.message || String(error),
      },
      error,
    );
    logFailure(exception);
    throw exception;
  } finally {
    clearTimeout(timeout);
  }
}
