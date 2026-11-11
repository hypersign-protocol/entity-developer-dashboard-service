import { Test, TestingModule } from '@nestjs/testing';
import { AppAuthController } from './app-auth.controller';
import { AppAuthService } from '../services/app-auth.service';

const mockApp = {
  appName: 'new fyre app',
  appId: '3977ed2d3c26824d77c08c24aa7f22dbee81',
  edvId: 'hs:studio-api:app:3977ed2d3c26824d77c08c24aa7f22dbee81',
  walletAddress: 'hid1yam5kyrcyvrpah750zfhsjuqg5u2lfc3th2wul',
  whitelistedCors: ['*', 'http://locahost:8080'],
  logoUrl: '',
  subdomain: 'ent_5f9e3e0',
  tenantUrl: 'http://ent_5f9e3e0.localhost:8080',
};
const findAppResp = [
  {
    totalCount: 1,
    data: [mockApp],
  },
];

const createAppResp = {
  appName: 'new fyre app',
  appId: '3977ed2d3c26824d77c08c24aa7f22dbee81',
  edvId: 'hs:studio-api:app:3977ed2d3c26824d77c08c24aa7f22dbee81',
  kmsId: 'hs:doc:vnc7vkyvhfmcr3hsp450cxtyunlcnappu4m2ef3kmgi',
  walletAddress: 'hid1yam5kyrcyvrpah750zfhsjuqg5u2lfc3th2wul',
  whitelistedCors: ['*', 'http://locahost:8080'],
  logoUrl: '',
  subdomain: 'ent_5f9e3e0',
  apiSecretKey:
    'db1ee5a1282b2f03da1c1b6c2dc6e.66bff8a7785a6e171cde95c4f9f9f7e926ca76b3688d9622e320062c4749aca1d569de5fffc5bfd6773e57542b4677d4d',
  tenantUrl: 'http://ent_5f9e3e0.localhost:8080/',
};

describe('AppAuthController', () => {
  let appAuthcontroller: AppAuthController;
  let spyAppAuthService: AppAuthService;
  beforeEach(async () => {
    const AppAuthProvider = {
      provide: AppAuthService,
      useFactory: () => ({
        getAllApps: jest.fn().mockResolvedValue(findAppResp),
        getAppById: jest.fn().mockResolvedValue(mockApp),
        createAnApp: jest.fn().mockResolvedValue(createAppResp),
        updateAnApp: jest.fn().mockResolvedValue(mockApp),
        deleteApp: jest.fn().mockResolvedValue(mockApp),
        reGenerateAppSecretKey: jest.fn().mockResolvedValue(mockApp),
      }),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AppAuthController],
      providers: [AppAuthProvider],
    })
      // Auto-mock constructor dependencies these smoke tests don't exercise.
      .useMocker(() => ({}))
      .compile();

    appAuthcontroller = module.get<AppAuthController>(AppAuthController);
    spyAppAuthService = module.get<AppAuthService>(AppAuthService);
  });

  it('should be defined', () => {
    expect(appAuthcontroller).toBeDefined();
  });
});
