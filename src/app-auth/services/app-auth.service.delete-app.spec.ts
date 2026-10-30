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
  const onboardModel = { deleteOne: jest.fn() };
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
});
