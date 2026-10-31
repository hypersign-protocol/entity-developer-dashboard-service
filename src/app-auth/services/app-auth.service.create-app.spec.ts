import { ForbiddenException } from '@nestjs/common';
import { SERVICE_TYPES } from 'src/supported-service/services/iServiceList';
import { AppAuthService } from './app-auth.service';

jest.mock('src/utils/redis.provider', () => ({
  redisClient: { del: jest.fn().mockResolvedValue(1) },
}));
jest.mock('../../edv/services/vaultWalletManager', () => ({
  VaultWalletManager: { getWallet: jest.fn().mockResolvedValue({}) },
}));
jest.mock('../../edv/services/edv.clientFactory', () => ({
  EdvClientManagerFactoryService: class {},
}));
jest.mock('src/edv/services/edv.singleton', () => ({
  EdvClientKeysManager: jest.fn(),
}));
jest.mock('@cosmjs/stargate', () => ({
  SigningStargateClient: { connectWithSigner: jest.fn().mockResolvedValue({}) },
}));

describe('AppAuthService createAnApp', () => {
  const config = { get: jest.fn() };
  const appRepository = { create: jest.fn() };
  const hidWalletService = {
    generateWallet: jest
      .fn()
      .mockResolvedValue({ mnemonic: 'm', address: 'hid1app', wallet: {} }),
  };
  const appAuthApiKeyService = {
    generateAppId: jest.fn().mockResolvedValue('app-1'),
    generateApiKey: jest
      .fn()
      .mockResolvedValue({ apiSecretKey: 'prefix.secret', apiSecret: 'hash' }),
  };
  // QUEST apps skip the vault, KMS and subdomain steps.
  const supportedServices = {
    fetchServiceById: jest
      .fn()
      .mockReturnValue({ id: SERVICE_TYPES.QUEST, domain: 'quest.example' }),
  };
  const onboardModel = { findOne: jest.fn() };
  const organisationIs = (org) =>
    onboardModel.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue(org),
    });
  const dto = { appName: 'demo', serviceIds: ['quest'] } as any;
  let service: AppAuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    appRepository.create.mockImplementation(async (app) => ({
      _doc: app,
      ...app,
    }));
    service = new AppAuthService(
      config as any,
      appRepository as any,
      hidWalletService as any,
      {} as any,
      {} as any,
      appAuthApiKeyService as any,
      supportedServices as any,
      {} as any,
      onboardModel as any,
      {} as any,
    );
  });

  it('refuses an owner without an organisation, before creating any wallet or key', async () => {
    organisationIs(null);

    await expect(service.createAnApp(dto, 'user-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    expect(onboardModel.findOne).toHaveBeenCalledWith(
      { userId: 'user-1' },
      { _id: 1 },
    );
    expect(hidWalletService.generateWallet).not.toHaveBeenCalled();
    expect(appAuthApiKeyService.generateAppId).not.toHaveBeenCalled();
    expect(appRepository.create).not.toHaveBeenCalled();
  });

  it("links the app to the owner's organisation", async () => {
    organisationIs({ _id: { toString: () => 'org-1' } });

    await service.createAnApp(dto, 'user-1');

    expect(appRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', orgId: 'org-1' }),
    );
  });

  it('ignores an orgId sent by the client', async () => {
    organisationIs({ _id: { toString: () => 'org-1' } });

    await service.createAnApp({ ...dto, orgId: 'someone-elses-org' }, 'user-1');

    expect(appRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org-1' }),
    );
  });
});
