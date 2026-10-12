import { KybVerificationEnum } from '../constants/identifier-types';
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
  const appAuthService = { moveAppToDevelopment: jest.fn() };
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
          key === 'DASHBOARD_COMPANY_WEBHOOK_SECRET' ? 'secret' : undefined,
        ),
      } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
  });

  it('stores rejection and downgrades the onboarding apps', async () => {
    const onboarding = {
      companyId: '665f17f9c2b4f5a6d7e8f901',
      companyName: 'Acme',
      companyVerificationStatus: KybVerificationEnum.Completed,
      kycServiceId: 'kyc-app',
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
        companyId: onboarding.companyId,
        status: KybVerificationEnum.Rejected,
        statusReason: ['COMPANY_INACTIVE'],
      },
      'secret',
    );

    expect(appAuthService.moveAppToDevelopment).toHaveBeenCalledWith(
      'kyc-app',
      'user-1',
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
        companyId: '665f17f9c2b4f5a6d7e8f901',
        status: KybVerificationEnum.Rejected,
        statusReason: ['COMPANY_INACTIVE'],
      },
      'secret',
    );

    expect(appAuthService.moveAppToDevelopment).not.toHaveBeenCalled();
    expect(
      onboardingRepository.updateCustomerOnboardingDetails,
    ).not.toHaveBeenCalled();
  });
});
