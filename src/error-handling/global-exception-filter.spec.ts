import {
  ArgumentsHost,
  BadRequestException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { AllExceptionsFilter } from 'src/utils/utils';
import {
  DownstreamErrorCategory,
  DownstreamOperation,
  DownstreamService,
  DownstreamServiceException,
  PublicErrorCode,
  sanitizeDiagnosticText,
} from './downstream-error';

describe('AllExceptionsFilter safe boundary', () => {
  beforeAll(() => {
    jest.spyOn(Logger, 'error').mockImplementation(() => undefined);
  });

  function host(requestId = 'req-safe-1') {
    const status = jest.fn().mockReturnThis();
    const json = jest.fn();
    const response = { status, json };
    const request = { url: '/api/v1/test', requestId };
    const argumentsHost = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => request,
      }),
    } as unknown as ArgumentsHost;
    return { argumentsHost, response };
  }

  it('redacts credentials from internal diagnostics', () => {
    const sanitized = sanitizeDiagnosticText(
      'password=secret "access_token":"json-secret" cookie=session-value Bearer eyJabc.def.ghi mongodb://user:pass@mongo.internal/db user@example.com',
    );
    expect(sanitized).not.toContain('secret');
    expect(sanitized).not.toContain('eyJabc');
    expect(sanitized).not.toContain('user:pass');
    expect(sanitized).not.toContain('user@example.com');
    expect(sanitized).not.toContain('json-secret');
    expect(sanitized).not.toContain('session-value');
  });

  it('sanitizes an unexpected exception', () => {
    const { argumentsHost, response } = host();

    new AllExceptionsFilter().catch(
      new Error('password=secret mongo.internal:27017'),
      argumentsHost,
    );

    expect(response.status).toHaveBeenCalledWith(
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
    const body = response.json.mock.calls[0][0];
    expect(body.code).toBe(PublicErrorCode.INTERNAL_ERROR);
    expect(body.requestId).toBe('req-safe-1');
    expect(JSON.stringify(body)).not.toContain('secret');
    expect(JSON.stringify(body)).not.toContain('mongo.internal');
  });

  it('preserves an existing intentional client error and adds requestId', () => {
    const { argumentsHost, response } = host();

    new AllExceptionsFilter().catch(
      new BadRequestException(['Company name is required']),
      argumentsHost,
    );

    const body = response.json.mock.calls[0][0];
    expect(response.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(body.message).toEqual(['Company name is required']);
    expect(body.requestId).toBe('req-safe-1');
  });

  it('serializes only the approved public downstream response', () => {
    const { argumentsHost, response } = host();
    const exception = new DownstreamServiceException({
      status: HttpStatus.BAD_GATEWAY,
      code: PublicErrorCode.UPSTREAM_ERROR,
      publicMessage: 'A required service returned an invalid response.',
      diagnostic: {
        service: DownstreamService.ENTITY_API,
        operation: DownstreamOperation.SSI_DID_CREATE,
        category: DownstreamErrorCategory.DOWNSTREAM_BAD_RESPONSE,
        requestId: 'req-safe-1',
        method: 'POST',
        diagnosticMessage: 'private technical detail',
      },
    });

    new AllExceptionsFilter().catch(exception, argumentsHost);

    const body = response.json.mock.calls[0][0];
    expect(response.status).toHaveBeenCalledWith(HttpStatus.BAD_GATEWAY);
    expect(body.code).toBe(PublicErrorCode.UPSTREAM_ERROR);
    expect(JSON.stringify(body)).not.toContain('private technical detail');
  });
});
