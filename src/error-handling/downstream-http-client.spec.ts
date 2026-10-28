import { HttpStatus, Logger } from '@nestjs/common';
import {
  DownstreamOperation,
  DownstreamService,
  DownstreamServiceException,
  PublicErrorCode,
} from './downstream-error';
import { requestDownstreamJson } from './downstream-http-client';

describe('requestDownstreamJson', () => {
  const fetchMock = jest.fn();
  const baseOptions = {
    url: 'https://internal.example.test/resource',
    init: { method: 'POST' },
    service: DownstreamService.KYC_SERVICE,
    operation: DownstreamOperation.KYC_AUTH_EXCHANGE,
    requestId: '9bdad5e2-9366-45ee-8f40-d1b9cf9dd658',
    timeoutMs: 100,
  };

  beforeAll(() => {
    jest.spyOn(Logger, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger, 'warn').mockImplementation(() => undefined);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = fetchMock as any;
  });

  const jsonResponse = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });

  it('returns a valid successful response and forwards the request ID', async () => {
    fetchMock.mockImplementation(async (_url, init) => {
      expect(new Headers(init.headers).get('x-request-id')).toBe(
        baseOptions.requestId,
      );
      return jsonResponse({ data: { token: 'safe' } });
    });

    await expect(
      requestDownstreamJson({
        ...baseOptions,
        validateResponse: (body: any) => typeof body?.data?.token === 'string',
      }),
    ).resolves.toEqual({ data: { token: 'safe' } });
  });

  it('maps an allowlisted company validation error without returning raw details', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          success: false,
          error: {
            businessCode: PublicErrorCode.INVALID_COMPANY_DETAILS,
            details: [
              'Company field registrationNumber is required by the widget configuration',
            ],
          },
        },
        400,
      ),
    );

    const error = await requestDownstreamJson({
      ...baseOptions,
      operation: DownstreamOperation.KYC_COMPANY_UPSERT,
    }).catch((caught) => caught as DownstreamServiceException);

    expect(error).toBeInstanceOf(DownstreamServiceException);
    expect(error.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    expect(error.code).toBe(PublicErrorCode.INVALID_COMPANY_DETAILS);
    expect(error.getResponse()).not.toEqual(
      expect.objectContaining({
        message: expect.arrayContaining([
          expect.stringContaining('registrationNumber'),
        ]),
      }),
    );
  });

  it('maps an allowlisted company duplicate to a stable conflict', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          error: {
            businessCode: PublicErrorCode.COMPANY_ALREADY_EXISTS,
            details: [
              'Company with registration number private-value already exists',
            ],
          },
        },
        409,
      ),
    );

    const error = await requestDownstreamJson({
      ...baseOptions,
      operation: DownstreamOperation.KYC_COMPANY_UPSERT,
    }).catch((caught) => caught as DownstreamServiceException);

    expect(error.getStatus()).toBe(HttpStatus.CONFLICT);
    expect(error.code).toBe(PublicErrorCode.COMPANY_ALREADY_EXISTS);
    expect(JSON.stringify(error.getResponse())).not.toContain('private-value');
  });

  it('maps an allowlisted document validation failure without exposing parser details', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          error: {
            businessCode: PublicErrorCode.INVALID_DOCUMENT,
            details: [
              'Invalid file. Only PDF or image files(jpg, jpeg, png, gif) are allowed.',
            ],
          },
        },
        400,
      ),
    );

    const error = await requestDownstreamJson({
      ...baseOptions,
      operation: DownstreamOperation.KYC_DOCUMENT_UPLOAD,
    }).catch((caught) => caught as DownstreamServiceException);

    expect(error.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    expect(error.code).toBe(PublicErrorCode.INVALID_DOCUMENT);
    expect(error.publicMessage).toBe('The document is invalid or unsupported.');
  });

  it('does not mistake an internal downstream 400 for a client error', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          success: false,
          error: {
            details: [
              'MongoServerSelectionError: connect ECONNREFUSED mongo.internal:27017',
            ],
          },
        },
        400,
      ),
    );

    const error = await requestDownstreamJson({
      ...baseOptions,
      operation: DownstreamOperation.KYC_COMPANY_UPSERT,
    }).catch((caught) => caught as DownstreamServiceException);

    expect(error.getStatus()).toBe(HttpStatus.BAD_GATEWAY);
    expect(error.code).toBe(PublicErrorCode.UPSTREAM_ERROR);
    expect(JSON.stringify(error.getResponse())).not.toContain('mongo.internal');
  });

  it('does not trust a recognized message when the stable business code is absent', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          error: {
            details: [
              'Company field registrationNumber is required by the widget configuration',
            ],
          },
        },
        400,
      ),
    );

    const error = await requestDownstreamJson({
      ...baseOptions,
      operation: DownstreamOperation.KYC_COMPANY_UPSERT,
    }).catch((caught) => caught as DownstreamServiceException);

    expect(error.getStatus()).toBe(HttpStatus.BAD_GATEWAY);
    expect(error.code).toBe(PublicErrorCode.UPSTREAM_ERROR);
  });

  it('does not expose an SSI conflict that requires internal reconciliation', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          statusCode: 409,
          message: ['Duplicate key error'],
          error: 'Conflict',
        },
        409,
      ),
    );

    const error = await requestDownstreamJson({
      ...baseOptions,
      service: DownstreamService.ENTITY_API,
      operation: DownstreamOperation.SSI_DID_CREATE,
    }).catch((caught) => caught as DownstreamServiceException);

    expect(error.getStatus()).toBe(HttpStatus.BAD_GATEWAY);
    expect(error.code).toBe(PublicErrorCode.UPSTREAM_ERROR);
    expect(JSON.stringify(error.getResponse())).not.toContain('Duplicate key');
  });

  it.each([401, 403, 500])(
    'sanitizes downstream HTTP %s responses',
    async (status) => {
      fetchMock.mockResolvedValue(
        jsonResponse(
          {
            error: {
              details: [
                'Bearer eyJhbGciOi.secret.signature failed for service.internal',
              ],
            },
          },
          status,
        ),
      );

      const error = await requestDownstreamJson(baseOptions).catch(
        (caught) => caught as DownstreamServiceException,
      );

      expect(error.getStatus()).toBe(HttpStatus.BAD_GATEWAY);
      expect(error.code).toBe(PublicErrorCode.UPSTREAM_ERROR);
      expect(JSON.stringify(error.getResponse())).not.toContain('secret');
      expect(JSON.stringify(error.getResponse())).not.toContain(
        'service.internal',
      );
    },
  );

  it('maps a connection failure to service unavailable', async () => {
    const cause = new Error('connect ECONNREFUSED dependency.internal:443');
    fetchMock.mockRejectedValue(cause);

    const error = await requestDownstreamJson(baseOptions).catch(
      (caught) => caught as DownstreamServiceException,
    );

    expect(error.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    expect(error.code).toBe(PublicErrorCode.SERVICE_UNAVAILABLE);
    expect(error.originalCause).toBe(cause);
    expect(JSON.stringify(error.getResponse())).not.toContain(
      'dependency.internal',
    );
    expect(JSON.stringify(error)).not.toContain('dependency.internal');
    expect(Logger.error).toHaveBeenCalledWith(
      expect.stringContaining('downstream_request_failed'),
      undefined,
      'DownstreamHttpClient',
    );
  });

  it.each([429, 503])(
    'maps downstream HTTP %s to service unavailable',
    async (status) => {
      fetchMock.mockResolvedValue(
        jsonResponse({ message: ['internal capacity detail'] }, status),
      );

      const error = await requestDownstreamJson(baseOptions).catch(
        (caught) => caught as DownstreamServiceException,
      );

      expect(error.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
      expect(error.code).toBe(PublicErrorCode.SERVICE_UNAVAILABLE);
      expect(JSON.stringify(error.getResponse())).not.toContain('capacity');
    },
  );

  it('maps a timeout to gateway timeout', async () => {
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
          );
        }),
    );

    const error = await requestDownstreamJson({
      ...baseOptions,
      timeoutMs: 5,
    }).catch((caught) => caught as DownstreamServiceException);

    expect(error.getStatus()).toBe(HttpStatus.GATEWAY_TIMEOUT);
    expect(error.code).toBe(PublicErrorCode.SERVICE_TIMEOUT);
  });

  it('preserves downstream gateway timeout semantics without exposing its body', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { message: ['upstream.internal timed out with token=private'] },
        504,
      ),
    );

    const error = await requestDownstreamJson(baseOptions).catch(
      (caught) => caught as DownstreamServiceException,
    );

    expect(error.getStatus()).toBe(HttpStatus.GATEWAY_TIMEOUT);
    expect(error.code).toBe(PublicErrorCode.SERVICE_TIMEOUT);
    expect(JSON.stringify(error.getResponse())).not.toContain('private');
    expect(JSON.stringify(error.getResponse())).not.toContain(
      'upstream.internal',
    );
  });

  it('maps malformed JSON and invalid success shapes to bad gateway', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('<html>gateway error</html>', { status: 200 }),
    );
    const malformed = await requestDownstreamJson(baseOptions).catch(
      (caught) => caught as DownstreamServiceException,
    );
    expect(malformed.getStatus()).toBe(HttpStatus.BAD_GATEWAY);
    expect(JSON.stringify(malformed.getResponse())).not.toContain('<html>');
    expect(
      JSON.stringify((Logger.error as jest.Mock).mock.calls),
    ).not.toContain('<html>');

    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true }));
    const invalidShape = await requestDownstreamJson({
      ...baseOptions,
      validateResponse: (body: any) => typeof body?.data?.token === 'string',
    }).catch((caught) => caught as DownstreamServiceException);
    expect(invalidShape.getStatus()).toBe(HttpStatus.BAD_GATEWAY);
    expect(invalidShape.code).toBe(PublicErrorCode.UPSTREAM_ERROR);
  });
});
