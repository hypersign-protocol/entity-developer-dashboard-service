import { RequestIdMiddleware } from './request-id.middleware';

describe('RequestIdMiddleware', () => {
  it('generates its own request ID and does not trust a caller value', () => {
    const request = {
      headers: { 'x-request-id': 'caller-controlled' },
    } as any;
    const response = { setHeader: jest.fn() } as any;
    const next = jest.fn();

    new RequestIdMiddleware().use(request, response, next);

    expect(request.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(request.requestId).not.toBe('caller-controlled');
    expect(response.setHeader).toHaveBeenCalledWith(
      'x-request-id',
      request.requestId,
    );
    expect(next).toHaveBeenCalledTimes(1);
  });
});
