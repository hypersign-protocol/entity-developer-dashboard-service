import { SERVICE_TYPES } from 'src/supported-service/services/iServiceList';
import { UserRole } from 'src/user/schema/user.schema';
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
  EdvClientKeysManager: jest.fn().mockImplementation(() => ({
    createVault: jest.fn().mockResolvedValue({
      deleteVault: jest.fn().mockResolvedValue(undefined),
    }),
  })),
}));

describe('AppAuthService deleteApp', () => {
  const kycApp = {
    appId: 'kyc-app-1',
    userId: 'owner-1',
    edvId: 'edv-1',
    kmsId: 'kms-1',
    subdomain: 'acme',
    services: [{ id: SERVICE_TYPES.CAVACH_API, dBSuffix: 'cavachDB' }],
    dependentServices: [],
  };
  const appRepository = {
    findOne: jest.fn(),
    findAppsByPipeline: jest.fn(),
    findAndDeleteServiceDB: jest.fn(),
    findOneAndDelete: jest.fn(),
  };
  const onboardModel = { deleteOne: jest.fn(), updateMany: jest.fn() };
  const webpageConfigRepo = {
    deleteMany: jest.fn(),
    findOneAndDelete: jest.fn(),
  };
  let service: AppAuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    globalThis.kmsVault = {
      getDecryptedDocument: jest.fn().mockResolvedValue({ mnemonic: 'm' }),
      deleteDocument: jest.fn().mockResolvedValue(undefined),
    };
    appRepository.findOne.mockResolvedValue(kycApp);
    appRepository.findAppsByPipeline.mockResolvedValue([]);
    appRepository.findOneAndDelete.mockResolvedValue(kycApp);
    appRepository.findAndDeleteServiceDB.mockResolvedValue(true);
    service = new AppAuthService(
      {} as any,
      appRepository as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      onboardModel as any,
      webpageConfigRepo as any,
    );
  });

  it("deletes only the app's own page configs, by serviceId", async () => {
    await service.deleteApp('kyc-app-1', {
      userId: 'owner-1',
      role: UserRole.ADMIN,
    });

    expect(webpageConfigRepo.deleteMany).toHaveBeenCalledWith({
      serviceId: 'kyc-app-1',
    });
    expect(webpageConfigRepo.findOneAndDelete).not.toHaveBeenCalled();
  });

  it('keeps the organisation and only unlinks the deleted KYC app', async () => {
    await service.deleteApp('kyc-app-1', {
      userId: 'owner-1',
      role: UserRole.ADMIN,
    });

    expect(onboardModel.deleteOne).not.toHaveBeenCalled();
    expect(onboardModel.updateMany).toHaveBeenCalledWith(
      { kycServiceId: 'kyc-app-1' },
      { $unset: { kycServiceId: '', kycSubdomain: '' } },
    );
  });

  it('keeps the linked SSI app when an admin deletes a KYC app', async () => {
    appRepository.findOne.mockResolvedValue({
      ...kycApp,
      dependentServices: ['ssi-app-1'],
    });

    await service.deleteApp('kyc-app-1', {
      userId: 'owner-1',
      role: UserRole.ADMIN,
    });

    expect(appRepository.findOneAndDelete).toHaveBeenCalledTimes(1);
    expect(appRepository.findOneAndDelete).toHaveBeenCalledWith({
      appId: 'kyc-app-1',
      userId: 'owner-1',
    });
    expect(appRepository.findOne).not.toHaveBeenCalledWith(
      expect.objectContaining({ appId: 'ssi-app-1' }),
    );
  });

  it('unlinks a deleted SSI app from its organisation', async () => {
    const ssiApp = {
      ...kycApp,
      appId: 'ssi-app-1',
      services: [{ id: SERVICE_TYPES.SSI_API, dBSuffix: 'ssiDB' }],
    };
    appRepository.findOne.mockResolvedValue(ssiApp);
    appRepository.findOneAndDelete.mockResolvedValue(ssiApp);

    await service.deleteApp('ssi-app-1', {
      userId: 'owner-1',
      role: UserRole.ADMIN,
    });

    expect(onboardModel.updateMany).toHaveBeenCalledWith(
      { ssiServiceId: 'ssi-app-1' },
      { $unset: { ssiServiceId: '', ssiSubdomain: '' } },
    );
    expect(webpageConfigRepo.deleteMany).not.toHaveBeenCalled();
  });

  it('reports a service database that could not be dropped', async () => {
    appRepository.findAndDeleteServiceDB.mockResolvedValue(false);

    const result = await service.deleteApp('kyc-app-1', {
      userId: 'owner-1',
      role: UserRole.ADMIN,
    });

    expect(result.warnings).toEqual([
      expect.stringContaining('service:cavachDB:acme'),
    ]);
  });

  it('returns no warnings when every clean-up step succeeds', async () => {
    const result = await service.deleteApp('kyc-app-1', {
      userId: 'owner-1',
      role: UserRole.ADMIN,
    });

    expect(result).toEqual({ appId: 'kyc-app-1' });
  });
});
