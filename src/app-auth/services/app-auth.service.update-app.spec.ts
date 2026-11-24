import { BadRequestException } from '@nestjs/common';
import { SERVICE_TYPES } from 'src/supported-service/services/iServiceList';
import { AppAuthService } from './app-auth.service';

jest.mock('src/utils/redis.provider', () => ({
  redisClient: { del: jest.fn(), get: jest.fn(), set: jest.fn() },
}));
jest.mock('../../edv/services/edv.clientFactory', () => ({
  EdvClientManagerFactoryService: class {},
}));

describe('AppAuthService updateAnApp — domain verification', () => {
  const user = { userId: 'owner-1' };
  const baseApp = {
    appId: 'kyc-app-1',
    userId: 'owner-1',
    env: 'dev',
    domain: 'https://acme.com',
    issuerDid: 'did:hid:acme',
    services: [{ id: SERVICE_TYPES.CAVACH_API, domain: 'x' }],
    dependentServices: [],
  };
  const appRepository = { findOneAndUpdate: jest.fn(), findOne: jest.fn() };
  let service: AppAuthService;
  let verifyDns: jest.SpyInstance;

  const writtenUpdate = () => appRepository.findOneAndUpdate.mock.calls[0][1];

  beforeEach(() => {
    jest.clearAllMocks();
    appRepository.findOneAndUpdate.mockImplementation((_q, update) => ({
      _doc: { ...baseApp, ...update },
      services: baseApp.services,
    }));
    service = new AppAuthService(
      {} as any,
      appRepository as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    verifyDns = jest
      .spyOn(service as any, 'verifyDNS01Validation')
      .mockResolvedValue({ verified: true });
    jest.spyOn(service as any, 'updateAppRedis').mockResolvedValue(undefined);
  });

  it('never writes a client-sent hasDomainVerified without verification', async () => {
    await service.updateAnApp(
      'kyc-app-1',
      { appName: 'Acme', hasDomainVerified: false } as any,
      user,
      { ...baseApp },
    );

    expect(verifyDns).not.toHaveBeenCalled();
    expect(writtenUpdate()).not.toHaveProperty('hasDomainVerified');
    expect(writtenUpdate()).not.toHaveProperty('domainLinkageCredentialString');
  });

  it('runs DNS-01 in any env and sets the flag + credential on success', async () => {
    await service.updateAnApp(
      'kyc-app-1',
      { hasDomainVerified: true } as any,
      user,
      { ...baseApp },
    );

    expect(verifyDns).toHaveBeenCalledWith(
      'https://acme.com',
      'hypersign-domain-verification.did=did:hid:acme',
    );
    expect(writtenUpdate().hasDomainVerified).toBe(true);
    expect(writtenUpdate().domainLinkageCredentialString).toEqual(
      expect.any(String),
    );
  });

  it('throws and writes nothing when DNS-01 fails', async () => {
    verifyDns.mockRejectedValue(new BadRequestException(['nope']));

    await expect(
      service.updateAnApp(
        'kyc-app-1',
        { hasDomainVerified: true, domain: 'https://somebank.com' } as any,
        user,
        { ...baseApp },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(appRepository.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('rejects a verification request with no issuer DID', async () => {
    await expect(
      service.updateAnApp(
        'kyc-app-1',
        { hasDomainVerified: true } as any,
        user,
        { ...baseApp, issuerDid: undefined },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(verifyDns).not.toHaveBeenCalled();
  });

  it('locks the domain and keeps the flag once verified, whatever the client sends', async () => {
    await service.updateAnApp(
      'kyc-app-1',
      { domain: 'https://somebank.com', hasDomainVerified: false } as any,
      user,
      {
        ...baseApp,
        hasDomainVerified: true,
        domainLinkageCredentialString: '{}',
      },
    );

    expect(verifyDns).not.toHaveBeenCalled();
    expect(writtenUpdate().domain).toBe('https://acme.com');
    expect(writtenUpdate().hasDomainVerified).toBe(true);
  });

  it('blocks going to prod on a stored flag that has no credential behind it', async () => {
    (service as any).userRepository = {
      findOne: jest.fn().mockResolvedValue({
        authenticators: [{ isTwoFactorAuthenticated: true }],
      }),
    };
    (service as any).onboardModel = {
      findOne: () => ({
        lean: () => Promise.resolve({ companyVerificationStatus: 'Approved' }),
      }),
    };

    await expect(
      service.updateAnApp(
        'kyc-app-1',
        { env: 'prod', logoUrl: 'https://acme.com/l.png' } as any,
        user,
        { ...baseApp, hasDomainVerified: true },
      ),
    ).rejects.toMatchObject({
      response: {
        message: ['You must verify your domain before going to production'],
      },
    });
  });
});
