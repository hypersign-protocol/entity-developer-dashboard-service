import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Types } from 'mongoose';
import { SERVICE_TYPES } from 'src/supported-service/services/iServiceList';
import { GRANT_TYPES } from 'src/app-auth/services/app-auth.service';
import { PageType } from '../dto/create-webpage-config.dto';
import { WebpageConfigService } from './webpage-config.service';

const counters = new Map<string, number>();
jest.mock('src/utils/redis.provider', () => ({
  redisClient: {
    incr: jest.fn(async (key: string) => {
      const next = (counters.get(key) || 0) + 1;
      counters.set(key, next);
      return next;
    }),
    expire: jest.fn().mockResolvedValue(1),
    sadd: jest.fn().mockResolvedValue(1),
    smembers: jest.fn().mockResolvedValue([]),
    del: jest.fn().mockResolvedValue(1),
  },
}));
jest.mock('src/app-auth/services/app-auth.service', () => ({
  AppAuthService: class {},
  GRANT_TYPES: {
    access_service_kyc: 'access_service_kyc',
    access_service_kyb: 'access_service_kyb',
    access_service_ssi: 'access_service_ssi',
  },
}));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { redisClient } = require('src/utils/redis.provider');

const DAY_MS = 24 * 60 * 60 * 1000;

describe('WebpageConfigService verifier tokens', () => {
  const pageId = new Types.ObjectId().toString();
  const kycApp = {
    appId: 'kyc-app',
    appName: 'Acme KYC',
    subdomain: 'acme',
    services: [{ id: SERVICE_TYPES.CAVACH_API }],
    dependentServices: ['ssi-app'],
  };
  const ssiApp = {
    appId: 'ssi-app',
    appName: 'Acme SSI',
    subdomain: 'acme-ssi',
    services: [{ id: SERVICE_TYPES.SSI_API }],
  };
  const page = (overrides = {}) => ({
    _id: new Types.ObjectId(pageId),
    serviceId: 'kyc-app',
    pageType: PageType.KYC,
    expiryDate: new Date(Date.now() + 30 * DAY_MS),
    ...overrides,
  });

  const appRepository = { findOne: jest.fn() };
  const webPageConfigRepo = {
    findAWebpageConfig: jest.fn(),
    findOneAndUpdate: jest.fn(),
    findOneAndDelete: jest.fn(),
  };
  const appAuthService = {
    storeDataInRedis: jest.fn().mockResolvedValue(undefined),
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    getAccessToken: jest.fn(async (payload, time?: number, unit?: string) => ({
      access_token: `jwt:${payload.appId}:${payload.sessionId}`,
    })),
  };
  let service: WebpageConfigService;

  beforeEach(() => {
    jest.clearAllMocks();
    counters.clear();
    appRepository.findOne.mockImplementation(async ({ appId }) =>
      appId === 'kyc-app' ? kycApp : appId === 'ssi-app' ? ssiApp : null,
    );
    webPageConfigRepo.findAWebpageConfig.mockResolvedValue(page());
    service = new WebpageConfigService(
      appRepository as any,
      appAuthService as any,
      webPageConfigRepo as any,
      { get: jest.fn() } as any,
    );
  });

  it('issues tokens for the app the page belongs to when no appId is sent', async () => {
    const result = await service.generateWebpageConfigTokens(
      pageId,
      undefined,
      undefined,
      '1.1.1.1',
    );

    expect(result.kycAccessToken).toMatch(/^jwt:kyc-app:/);
    expect(result.ssiAccessToken).toMatch(/^jwt:ssi-app:/);
    expect(result).not.toHaveProperty('kybAccessToken');
  });

  it('rejects an appId that does not match the page (cross-tenant minting)', async () => {
    await expect(
      service.generateWebpageConfigTokens(pageId, 'victim-app'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(appAuthService.getAccessToken).not.toHaveBeenCalled();
  });

  it('accepts a matching appId from older verifier page builds', async () => {
    await expect(
      service.generateWebpageConfigTokens(pageId, 'kyc-app'),
    ).resolves.toHaveProperty('kycAccessToken');
  });

  it('refuses tokens for a disabled page', async () => {
    webPageConfigRepo.findAWebpageConfig.mockResolvedValue(
      page({ isActive: false }),
    );
    await expect(
      service.generateWebpageConfigTokens(pageId),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses tokens for an expired page', async () => {
    webPageConfigRepo.findAWebpageConfig.mockResolvedValue(
      page({ expiryDate: new Date(Date.now() - 1000) }),
    );
    await expect(
      service.generateWebpageConfigTokens(pageId),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('gives every request its own random session, never hash(appId)', async () => {
    await service.generateWebpageConfigTokens(pageId);
    await service.generateWebpageConfigTokens(pageId);

    const sessionIds = appAuthService.storeDataInRedis.mock.calls.map(
      (call) => call[3],
    );
    expect(new Set(sessionIds).size).toBe(4);
    const { createHash } = jest.requireActual('crypto');
    const sharedKey = createHash('sha256').update('kyc-app').digest('hex');
    expect(sessionIds).not.toContain(sharedKey);
    expect(redisClient.sadd).toHaveBeenCalledWith(
      `verifier:sessions:${pageId}`,
      sessionIds[0],
      sessionIds[1],
    );
  });

  it('stores sessions with the verifier TTL (30 min for KYC), not a week', async () => {
    await service.generateWebpageConfigTokens(pageId);
    for (const call of appAuthService.storeDataInRedis.mock.calls) {
      expect(call[6]).toBe(30 * 60);
    }
    expect(appAuthService.getAccessToken.mock.calls[0][1]).toBe(30 * 60);
    expect(appAuthService.getAccessToken.mock.calls[0][2]).toBe('s');
  });

  it('caps session and JWT lifetime at the page expiry', async () => {
    webPageConfigRepo.findAWebpageConfig.mockResolvedValue(
      page({ expiryDate: new Date(Date.now() + 5 * 60 * 1000) }),
    );
    await service.generateWebpageConfigTokens(pageId);
    const ttl = appAuthService.storeDataInRedis.mock.calls[0][6];
    expect(ttl).toBeLessThanOrEqual(5 * 60);
    expect(ttl).toBeGreaterThan(4 * 60);
  });

  it('issues a KYB token with the KYB grant and 60 min TTL for KYB pages', async () => {
    webPageConfigRepo.findAWebpageConfig.mockResolvedValue(
      page({ pageType: PageType.KYB }),
    );
    const result = await service.generateWebpageConfigTokens(pageId);
    expect(result.kybAccessToken).toBeDefined();
    expect(appAuthService.storeDataInRedis.mock.calls[0][0]).toBe(
      GRANT_TYPES.access_service_kyb,
    );
    expect(appAuthService.storeDataInRedis.mock.calls[0][6]).toBe(60 * 60);
  });

  it('rejects businessId on KYB pages and passes it through on KYC pages', async () => {
    const businessId = new Types.ObjectId().toString();
    await service.generateWebpageConfigTokens(pageId, undefined, businessId);
    expect(appAuthService.getAccessToken.mock.calls[1][0].businessId).toBe(
      businessId,
    );

    webPageConfigRepo.findAWebpageConfig.mockResolvedValue(
      page({ pageType: PageType.KYB }),
    );
    await expect(
      service.generateWebpageConfigTokens(pageId, undefined, businessId),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a page linked to an app that is not a KYC service', async () => {
    appRepository.findOne.mockImplementation(async ({ appId }) =>
      appId === 'kyc-app'
        ? { ...kycApp, services: [{ id: 'SSI_API' }] }
        : ssiApp,
    );
    await expect(
      service.generateWebpageConfigTokens(pageId),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rate-limits a single IP on a page', async () => {
    for (let i = 0; i < 10; i++) {
      await service.generateWebpageConfigTokens(
        pageId,
        undefined,
        undefined,
        '9.9.9.9',
      );
    }
    await expect(
      service.generateWebpageConfigTokens(
        pageId,
        undefined,
        undefined,
        '9.9.9.9',
      ),
    ).rejects.toBeInstanceOf(ThrottlerException);
    // Another visitor is unaffected.
    await expect(
      service.generateWebpageConfigTokens(
        pageId,
        undefined,
        undefined,
        '8.8.8.8',
      ),
    ).resolves.toBeDefined();
  });

  it('enforces the per-page daily token limit', async () => {
    webPageConfigRepo.findAWebpageConfig.mockResolvedValue(
      page({ dailyTokenLimit: 2 }),
    );
    await service.generateWebpageConfigTokens(
      pageId,
      undefined,
      undefined,
      'a',
    );
    await service.generateWebpageConfigTokens(
      pageId,
      undefined,
      undefined,
      'b',
    );
    await expect(
      service.generateWebpageConfigTokens(pageId, undefined, undefined, 'c'),
    ).rejects.toBeInstanceOf(ThrottlerException);
  });

  describe('page management', () => {
    it('scopes updates by serviceId and revokes sessions when disabled', async () => {
      appRepository.findOne.mockResolvedValue(kycApp);
      webPageConfigRepo.findOneAndUpdate.mockResolvedValue(
        page({ isActive: false }),
      );
      redisClient.smembers.mockResolvedValueOnce(['s1']);

      await service.updateWebPageConfiguration(
        pageId,
        { isActive: false },
        'kyc-app',
      );

      expect(webPageConfigRepo.findOneAndUpdate.mock.calls[0][0]).toEqual({
        _id: new Types.ObjectId(pageId),
        serviceId: 'kyc-app',
      });
      expect(redisClient.del).toHaveBeenCalledWith('s1');
    });

    it('public config fetch refuses a disabled page', async () => {
      webPageConfigRepo.findAWebpageConfig.mockResolvedValue(
        page({ isActive: false }),
      );
      await expect(
        service.fetchAWebPageConfigurationDetail(pageId),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('public config fetch still 404s for an unknown page', async () => {
      webPageConfigRepo.findAWebpageConfig.mockResolvedValue(null);
      await expect(
        service.fetchAWebPageConfigurationDetail(pageId),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
