import { KybVerificationEnum } from '../constants/identifier-types';
import { OnboardingStep, StepStatus } from '../constants/enum';
import { WebhookVerificationType } from '../dto/company-verification-webhook.dto';
import { CustomerOnboardingService } from './customer-onboarding.service';

jest.mock('src/app-auth/services/app-auth.service', () => ({
  AppAuthService: class {},
  GRANT_TYPES: {
    access_service_kyc: 'access_service_kyc',
    access_service_kyb: 'access_service_kyb',
    access_service_ssi: 'access_service_ssi',
  },
}));
jest.mock('src/utils/utils', () => ({
  evaluateAccessPolicy: jest.fn(),
  generateHash: jest.fn(),
  getAccessListForModule: jest.fn(),
  sanitizeUrl: jest.fn((value) => value),
  SERVICE_ENDPOINTS: {},
}));

describe('CustomerOnboardingService company verification webhook', () => {
  const onboardingRepository = {
    findCustomerOnboardingById: jest.fn(),
    updateCustomerOnboardingDetails: jest.fn(),
  };
  const userRepository = { findOne: jest.fn() };
  const mailService = { addAJob: jest.fn() };
  const appAuthService = {};
  let service: CustomerOnboardingService;

  beforeEach(async () => {
    jest.clearAllMocks();
    service = new CustomerOnboardingService(
      onboardingRepository as any,
      userRepository as any,
      mailService as any,
      appAuthService as any,
      {} as any,
      {
        get: jest.fn((key) =>
          key === 'CUSTOMER_ONBOARDING_WEBHOOK_SECRET' ? 'secret' : undefined,
        ),
      } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
  });

  it('stores the rejection status and reason', async () => {
    const onboarding = {
      companyId: '665f17f9c2b4f5a6d7e8f901',
      companyName: 'Acme',
      companyVerificationStatus: KybVerificationEnum.Completed,
      userId: 'user-1',
    };
    onboardingRepository.findCustomerOnboardingById.mockResolvedValue(
      onboarding,
    );
    onboardingRepository.updateCustomerOnboardingDetails.mockResolvedValue({
      ...onboarding,
      companyVerificationStatus: KybVerificationEnum.Rejected,
    });
    await service.updateCompanyVerificationStatus(
      {
        type: WebhookVerificationType.BUSINESS,
        success: false,
        environment: 'prod',
        data: {
          event: 'company.verification.updated',
          companyId: onboarding.companyId,
          status: KybVerificationEnum.Rejected,
          statusReason: ['COMPANY_INACTIVE'],
          createdAt: '2026-10-13T10:00:00.000Z',
        },
      },
      'secret',
    );

    expect(
      onboardingRepository.updateCustomerOnboardingDetails,
    ).toHaveBeenCalledWith(
      { companyId: onboarding.companyId },
      {
        $set: {
          companyVerificationStatus: KybVerificationEnum.Rejected,
          companyStatusReason: 'COMPANY_INACTIVE',
        },
      },
    );
  });

  it('does not repeat side effects for an unchanged webhook', async () => {
    onboardingRepository.findCustomerOnboardingById.mockResolvedValue({
      companyId: '665f17f9c2b4f5a6d7e8f901',
      companyVerificationStatus: KybVerificationEnum.Rejected,
      companyStatusReason: 'COMPANY_INACTIVE',
    });

    await service.updateCompanyVerificationStatus(
      {
        type: WebhookVerificationType.BUSINESS,
        success: false,
        environment: 'prod',
        data: {
          event: 'company.verification.updated',
          companyId: '665f17f9c2b4f5a6d7e8f901',
          status: KybVerificationEnum.Rejected,
          statusReason: ['COMPANY_INACTIVE'],
          createdAt: '2026-10-13T10:00:00.000Z',
        },
      },
      'secret',
    );

    expect(
      onboardingRepository.updateCustomerOnboardingDetails,
    ).not.toHaveBeenCalled();
  });

  it('does not expose raw failure reasons loaded from legacy progress', () => {
    const logs = (service as any).sanitizeOnboardingLogs([
      {
        step: OnboardingStep.CREATE_KYC_SERVICE,
        status: StepStatus.FAILED,
        time: new Date(),
        failureReason: 'issuerDid must be a string: fetch failed',
      },
    ]);

    expect(logs[0].failureReason).toBe(
      'We could not finish setting up identity verification. Please try again later.',
    );
  });

  it('restarts at DID creation when its success marker has no persisted DID', () => {
    const steps = Object.values(OnboardingStep);
    const createDidIndex = steps.indexOf(OnboardingStep.CREATE_DID);
    const resumeIndex = (service as any).getSafeResumeStepIndex(
      steps,
      [
        {
          step: OnboardingStep.CREATE_DID,
          status: StepStatus.SUCCESS,
          time: new Date(),
        },
      ],
      { ssiServiceId: 'ssi-app-1' },
    );

    expect(resumeIndex).toBe(createDidIndex - 1);
  });

  it('rejects a missing issuer DID before passing it to an SDK', () => {
    expect(() => (service as any).getIssuerDetails(undefined, false)).toThrow(
      'Onboarding issuer DID is unavailable',
    );
  });

  it('uses only high-level customer language for every onboarding step', () => {
    for (const step of Object.values(OnboardingStep)) {
      const reason = (service as any).getOnboardingFailureReason(step);
      expect(reason).not.toMatch(
        /\b(ssi|did|issuer|token|fetch|redis|sdk|kyc|kyb|api)\b/i,
      );
      expect(reason).toMatch(/Please try again later\.$/);
    }
  });
});
