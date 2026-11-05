import { Logger } from '@nestjs/common';
import { Types } from 'mongoose';
import { redisClient } from 'src/utils/redis.provider';
import { InterestedService } from '../constants/enum';
import { CustomerOnboardingService } from './customer-onboarding.service';

jest.mock('src/utils/redis.provider', () => {
  const store = new Map<string, string>();
  return {
    redisClient: {
      store,
      set: jest.fn(async (key: string, value: string, ...args: any[]) => {
        if (args.includes('NX') && store.has(key)) return null;
        store.set(key, value);
        return 'OK';
      }),
      get: jest.fn(async (key: string) => store.get(key) ?? null),
      del: jest.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
      eval: jest.fn(async (script: string, _keys: number, ...args: any[]) => {
        const lockKey = args[0];
        if (script.includes("'pexpire'")) {
          return store.get(lockKey) === args[1] ? 1 : 0;
        }
        if (script.includes("'del'")) {
          if (store.get(lockKey) !== args[1]) return 0;
          store.delete(lockKey);
          return 1;
        }
        if (store.get(lockKey) !== args[2]) return 0;
        store.set(args[1], args[3]);
        return 'OK';
      }),
    },
  };
});
jest.mock('src/app-auth/services/app-auth.service', () => ({
  AppAuthService: class {},
  GRANT_TYPES: {
    access_service_kyc: 'access_service_kyc',
    access_service_kyb: 'access_service_kyb',
    access_service_ssi: 'access_service_ssi',
  },
}));
jest.mock('src/credits/services/credits.service', () => ({
  CreditService: class {},
}));
jest.mock('src/webpage-config/services/webpage-config.service', () => ({
  WebpageConfigService: class {},
}));
jest.mock('src/utils/utils', () => ({
  ...jest.requireActual('src/utils/utils'),
  evaluateAccessPolicy: jest.fn(() => []),
  getAccessListForModule: jest.fn(() => []),
  generateHash: jest.fn((value: string) => `hash:${value}`),
  sanitizeUrl: jest.fn((value: string) => `${value}/`),
}));

const ONBOARDING_ID = '665f17f9c2b4f5a6d7e8f901';
const WIDGET_ID = '665f17f9c2b4f5a6d7e8f9aa';
const STEPS_THROUGH_KYC_WIDGET = [
  'GIVE_DASHBOARD_ACCESS',
  'CREATE_TEAM_ROLE',
  'CREATE_SSI_SERVICE',
  'CREDIT_SSI_SERVICE',
  'CREATE_DID',
  'REGISTER_DID',
  'CREATE_KYC_SERVICE',
  'SETUP_KYC_WIDGET',
];

describe('CustomerOnboardingService retry', () => {
  const redisStore: Map<string, string> = (redisClient as any).store;
  const redisSet = redisClient.set as unknown as jest.Mock;

  // In-memory stand-ins that keep state between a failed run and its retry.
  const setup = ({
    onboarding = {},
    widgetConfigs = [] as any[],
    pageExists = false,
  } = {}) => {
    const doc: any = {
      _id: new Types.ObjectId(ONBOARDING_ID),
      __v: 0,
      companyName: 'Acme',
      userId: 'user-1',
      domain: 'acme.test',
      customerEmail: 'customer@acme.test',
      interestedService: [InterestedService.KYC],
      onboardingStatus: 'INITIATED',
      logs: [],
      ...onboarding,
    };
    const onboardingRepository = {
      findCustomerOnboardingById: jest.fn(async () =>
        JSON.parse(JSON.stringify(doc)),
      ),
      updateCustomerOnboardingDetails: jest.fn(
        async (filter: any, update: any) => {
          if (filter.__v !== undefined && filter.__v !== doc.__v) return null;
          if (doc.onboardingStatus === filter.onboardingStatus?.$ne) {
            return null;
          }
          for (const [key, value] of Object.entries(update.$set || {})) {
            if (value !== undefined) doc[key] = value;
          }
          doc.__v += update.$inc?.__v || 0;
          return JSON.parse(JSON.stringify(doc));
        },
      ),
    };
    const app = (appId: string) => ({
      appId,
      subdomain: `${appId}-subdomain`,
      appName: 'Acme',
      whitelistedCors: ['https://acme.test'],
    });
    const appAuthService = {
      createAnApp: jest.fn(async (dto: any) => app(`${dto.serviceIds[0]}-app`)),
      storeDataInRedis: jest.fn(),
      getAccessToken: jest.fn(async (payload: any) => ({
        access_token: `token:${payload.grantType}`,
      })),
    };
    const webPageConfig = {
      fetchParticularWebpage: jest.fn(async () => pageExists),
      storeWebPageConfigDetial: jest.fn(),
    };
    const mailService = { addAJob: jest.fn() };
    const externalRequest = jest.fn(async (url: string, options: any) => {
      if (url.includes('did/create')) {
        return { did: 'did:hid:1', metaData: { didDocument: {} } };
      }
      if (url.includes('e-kyc') && url.includes('/all')) {
        return { data: { widgetConfigs } };
      }
      if (url.includes('e-kyc') && options.method === 'POST') {
        widgetConfigs.push({ _id: WIDGET_ID });
        return { data: { _id: WIDGET_ID } };
      }
      if (url.includes('e-kyb') && options.method === 'GET')
        return { data: {} };
      return {};
    });
    const service: any = new CustomerOnboardingService(
      onboardingRepository as any,
      {
        findOne: jest.fn(async () => ({
          email: 'owner@acme.test',
          name: 'Owner',
          accessList: [],
        })),
        findOneUpdate: jest.fn(async () => ({ accessList: [] })),
        find: jest.fn(async () => [{ email: 'admin@hypersign.test' }]),
      } as any,
      mailService as any,
      appAuthService as any,
      {} as any,
      {
        get: jest.fn((key: string) =>
          key.endsWith('DOMAIN') ? `https://${key}` : 'https://config.test',
        ),
      } as any,
      { findOne: jest.fn(async ({ appId }: any) => app(appId)) } as any,
      { findOne: jest.fn(async () => ({ id: 'role' })) } as any,
      webPageConfig as any,
      { grantCredit: jest.fn() } as any,
      {} as any,
    );
    service.makeExternalRequest = externalRequest;
    return {
      doc,
      webPageConfig,
      mailService,
      appAuthService,
      externalRequest,
      run: () =>
        service
          .processCustomerOnboarding(ONBOARDING_ID, 'user-1')
          .catch((error: any) => error),
      failureEmails: () =>
        mailService.addAJob.mock.calls
          .map(([mail]: any[]) => mail.subject as string)
          .filter((subject: string) => subject.startsWith('L1 Support')),
      linkedWidgetIds: () =>
        webPageConfig.storeWebPageConfigDetial.mock.calls.find(
          ([, dto]: any[]) => dto.pageType === 'kyc',
        )?.[1].linkedWidgetConfigIds,
    };
  };

  const interruptedAfterKycWidget = () => ({
    onboardingStatus: 'PROCESSING',
    ssiServiceId: 'ssi-app',
    ssiSubdomain: 'ssi-subdomain',
    kycServiceId: 'kyc-app',
    kycSubdomain: 'kyc-subdomain',
    businessId: 'did:hid:1',
    logs: STEPS_THROUGH_KYC_WIDGET.map((step, index) => ({
      step,
      status: 'SUCCESS',
      time: new Date(1700000000000 + index * 1000).toISOString(),
    })),
  });

  beforeAll(() => {
    (['log', 'debug', 'warn', 'error'] as const).forEach((level) =>
      jest.spyOn(Logger, level).mockImplementation(() => undefined),
    );
  });

  beforeEach(() => {
    redisStore.clear();
  });

  describe('KYC verifier page widget link', () => {
    it('links the widget created in the same run', async () => {
      const onboarding = setup();

      await onboarding.run();

      expect(onboarding.doc.onboardingStatus).toBe('APPROVED');
      expect(onboarding.linkedWidgetIds()).toEqual([WIDGET_ID]);
    });

    it('recovers the widget when the page step itself is retried', async () => {
      const onboarding = setup();
      onboarding.webPageConfig.storeWebPageConfigDetial.mockRejectedValueOnce(
        new Error('page store is down'),
      );

      await onboarding.run();
      expect(onboarding.doc.onboardingStatus).toBe('FAILED');

      onboarding.webPageConfig.storeWebPageConfigDetial.mockClear();
      await onboarding.run();

      expect(onboarding.doc.onboardingStatus).toBe('APPROVED');
      expect(onboarding.linkedWidgetIds()).toEqual([WIDGET_ID]);
    });

    it('recovers the widget when the retry starts at SETUP_KYB_WIDGET', async () => {
      const onboarding = setup({
        onboarding: {
          interestedService: [InterestedService.KYC, InterestedService.KYB],
        },
      });
      const respond = onboarding.externalRequest.getMockImplementation();
      onboarding.externalRequest.mockImplementation(
        async (url: string, options: any) => {
          if (url.includes('e-kyb') && options.method === 'POST') {
            throw new Error('KYB widget service is down');
          }
          return respond(url, options);
        },
      );

      await onboarding.run();
      expect(onboarding.doc.onboardingStatus).toBe('FAILED');

      onboarding.externalRequest.mockImplementation(respond);
      await onboarding.run();

      expect(onboarding.doc.onboardingStatus).toBe('APPROVED');
      expect(onboarding.linkedWidgetIds()).toEqual([WIDGET_ID]);
    });

    it('recovers the widget with a KYC token after an interruption', async () => {
      const onboarding = setup({
        onboarding: interruptedAfterKycWidget(),
        widgetConfigs: [{ _id: WIDGET_ID }],
      });

      await onboarding.run();

      expect(onboarding.doc.onboardingStatus).toBe('APPROVED');
      expect(onboarding.linkedWidgetIds()).toEqual([WIDGET_ID]);
      const [, listRequest] = onboarding.externalRequest.mock.calls.find(
        ([url]: any[]) => url.includes('e-kyc') && url.includes('/all'),
      );
      expect(listRequest.headers['x-kyc-access-token']).toBe(
        'token:access_service_kyc',
      );
    });

    it('fails the step instead of linking a widget that does not exist', async () => {
      const onboarding = setup({ onboarding: interruptedAfterKycWidget() });

      const result = await onboarding.run();

      expect(result.getStatus()).toBe(500);
      expect(onboarding.doc.onboardingStatus).toBe('FAILED');
      expect(
        onboarding.webPageConfig.storeWebPageConfigDetial,
      ).not.toHaveBeenCalled();
      expect(
        onboarding.doc.logs.find(
          (log: any) => log.step === 'CONFIGURE_KYC_VERIFIER_PAGE',
        ).status,
      ).toBe('FAILED');
    });

    it('skips the lookup when the page already exists', async () => {
      const onboarding = setup({
        onboarding: interruptedAfterKycWidget(),
        pageExists: true,
      });

      await onboarding.run();

      expect(onboarding.doc.onboardingStatus).toBe('APPROVED');
      expect(onboarding.externalRequest).not.toHaveBeenCalled();
    });
  });

  describe('super admin failure emails', () => {
    const failingPage = () => {
      const onboarding = setup({
        onboarding: interruptedAfterKycWidget(),
        widgetConfigs: [{ _id: WIDGET_ID }],
      });
      onboarding.webPageConfig.storeWebPageConfigDetial.mockRejectedValue(
        new Error('page store is down'),
      );
      return onboarding;
    };

    it('emails once when the same step keeps failing', async () => {
      const onboarding = failingPage();

      await onboarding.run();
      await onboarding.run();
      await onboarding.run();

      expect(onboarding.failureEmails()).toHaveLength(1);
      expect(redisSet).toHaveBeenCalledWith(
        `customer-onboarding:failure-notified:${ONBOARDING_ID}:CONFIGURE_KYC_VERIFIER_PAGE`,
        '1',
        'EX',
        3600,
        'NX',
      );
    });

    it('still emails when a different step fails', async () => {
      const onboarding = setup({
        onboarding: {
          ...interruptedAfterKycWidget(),
          interestedService: [InterestedService.KYC, InterestedService.KYB],
        },
        widgetConfigs: [{ _id: WIDGET_ID }],
      });
      const storePage = onboarding.webPageConfig.storeWebPageConfigDetial;

      storePage.mockRejectedValueOnce(new Error('KYC page failed'));
      await onboarding.run();
      storePage.mockResolvedValueOnce(undefined);
      storePage.mockRejectedValueOnce(new Error('KYB page failed'));
      await onboarding.run();

      expect(onboarding.failureEmails()).toEqual([
        expect.stringContaining('CONFIGURE KYC VERIFIER PAGE'),
        expect.stringContaining('CONFIGURE KYB VERIFIER PAGE'),
      ]);
    });

    it('still emails when Redis cannot throttle', async () => {
      const onboarding = failingPage();
      const defaultSet = redisSet.getMockImplementation();
      redisSet.mockImplementation(async (key: string, ...args: any[]) => {
        if (key.includes('failure-notified')) throw new Error('redis is down');
        return defaultSet(key, ...args);
      });

      await onboarding.run();
      await onboarding.run();
      redisSet.mockImplementation(defaultSet);

      expect(onboarding.failureEmails()).toHaveLength(2);
    });

    it('lets the next failure email when queueing the mail failed', async () => {
      const onboarding = failingPage();
      onboarding.mailService.addAJob.mockRejectedValueOnce(
        new Error('mail queue is down'),
      );

      await onboarding.run();
      await onboarding.run();

      expect(onboarding.mailService.addAJob).toHaveBeenCalledTimes(2);
      expect(onboarding.failureEmails()).toHaveLength(2);
    });
  });
});
