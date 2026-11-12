import { ConflictException } from '@nestjs/common';
import { KybVerificationEnum } from '../constants/identifier-types';
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
    createCustomerOnboarding: jest.fn(),
  };
  const userRepository = { findOne: jest.fn() };
  const mailService = { addAJob: jest.fn() };
  const appAuthService = {};
  const appRepository = { attachOrganisation: jest.fn() };
  const roleRepository = { attachOrganisation: jest.fn() };
  const adminPeopleRepository = { attachOrganisation: jest.fn() };
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
      appRepository as any,
      roleRepository as any,
      {} as any,
      {} as any,
      adminPeopleRepository as any,
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

  describe('KYB approval and the billing profile', () => {
    const companyId = '665f17f9c2b4f5a6d7e8f901';
    const address = {
      street: '12 MG Road',
      city: 'Bengaluru',
      province: 'Karnataka',
      postalCode: '560001',
      country: 'IN',
    };
    const approve = (billing: Record<string, unknown>) => {
      onboardingRepository.findCustomerOnboardingById.mockResolvedValue({
        _id: 'org-1',
        companyId,
        companyName: 'Acme',
        customerEmail: 'billing@acme.example',
        companyVerificationStatus: KybVerificationEnum.Submitted,
        billing,
      });
      onboardingRepository.updateCustomerOnboardingDetails.mockResolvedValue({
        companyId,
      });
      return service.updateCompanyVerificationStatus(
        {
          type: WebhookVerificationType.BUSINESS,
          success: true,
          environment: 'prod',
          data: {
            event: 'company.verification.updated',
            companyId,
            status: KybVerificationEnum.Approved,
            createdAt: '2026-10-13T10:00:00.000Z',
          },
        },
        'secret',
      );
    };
    const billingWrites = () =>
      onboardingRepository.updateCustomerOnboardingDetails.mock.calls.filter(
        ([filter]) => 'billing.confirmedAt' in filter,
      );

    it('saves complete prefilled details, keeping a concurrent save', async () => {
      await approve({ region: 'IN', address, gstStateCode: '29' });

      expect(billingWrites()).toEqual([
        [
          { companyId, 'billing.confirmedAt': { $exists: false } },
          {
            $set: expect.objectContaining({
              'billing.legalName': 'Acme',
              'billing.confirmedAt': expect.any(Date),
            }),
          },
        ],
      ]);
    });

    it('leaves saved and incomplete details alone', async () => {
      await approve({
        region: 'IN',
        address,
        gstStateCode: '29',
        confirmedAt: new Date(),
      });
      await approve({ region: 'IN', gstStateCode: '29' });

      expect(billingWrites()).toEqual([]);
    });

    it('does not save details on any other status', async () => {
      onboardingRepository.findCustomerOnboardingById.mockResolvedValue({
        _id: 'org-1',
        companyId,
        companyName: 'Acme',
        customerEmail: 'billing@acme.example',
        companyVerificationStatus: KybVerificationEnum.Submitted,
        billing: { region: 'IN', address, gstStateCode: '29' },
      });
      await service.updateCompanyVerificationStatus(
        {
          type: WebhookVerificationType.BUSINESS,
          success: true,
          environment: 'prod',
          data: {
            event: 'company.verification.updated',
            companyId,
            status: KybVerificationEnum.Completed,
            createdAt: '2026-10-13T10:00:00.000Z',
          },
        },
        'secret',
      );

      expect(billingWrites()).toEqual([]);
    });
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

  describe('createCustomerOnboardingDetail', () => {
    it.each(['ADMIN', 'SUPER_ADMIN'])(
      'rejects a second onboarding for a %s with 409',
      async (role) => {
        onboardingRepository.findCustomerOnboardingById.mockResolvedValue({
          _id: 'existing',
          userId: 'user-1',
        });

        await expect(
          service.createCustomerOnboardingDetail(
            { companyName: 'Acme' } as any,
            { userId: 'user-1', role },
            'owner@acme.test',
          ),
        ).rejects.toBeInstanceOf(ConflictException);
        expect(
          onboardingRepository.createCustomerOnboarding,
        ).not.toHaveBeenCalled();
      },
    );
  });

  describe('submitKybCompany', () => {
    const onboardingId = '665f17f9c2b4f5a6d7e8f900';
    const companyId = '665f17f9c2b4f5a6d7e8f901';
    const user = { userId: 'user-1' };
    let send: jest.SpyInstance;

    beforeEach(() => {
      send = jest
        .spyOn(service as any, 'sendKybCompany')
        .mockResolvedValue({ sent: true });
    });

    const submit = () => service.submitKybCompany(onboardingId, {}, [], user);
    const claimCall = () =>
      onboardingRepository.updateCustomerOnboardingDetails.mock.calls.find(
        ([, update]) => update.$set?.kybSubmissionStartedAt,
      );

    it.each([
      KybVerificationEnum.Submitted,
      KybVerificationEnum.InProgress,
      'SomeFutureStatus',
      undefined,
    ])(
      'refuses with 409 and calls nothing while the company is %s',
      async (status) => {
        onboardingRepository.findCustomerOnboardingById.mockResolvedValue({
          companyId,
          companyVerificationStatus: status,
        });

        await expect(submit()).rejects.toBeInstanceOf(ConflictException);
        expect(send).not.toHaveBeenCalled();
        expect(
          onboardingRepository.updateCustomerOnboardingDetails,
        ).not.toHaveBeenCalled();
      },
    );

    it.each([KybVerificationEnum.Approved, KybVerificationEnum.Completed])(
      'returns the record unchanged once %s',
      async (status) => {
        const onboarding = { companyId, companyVerificationStatus: status };
        onboardingRepository.findCustomerOnboardingById.mockResolvedValue(
          onboarding,
        );

        await expect(submit()).resolves.toBe(onboarding);
        expect(send).not.toHaveBeenCalled();
        expect(
          onboardingRepository.updateCustomerOnboardingDetails,
        ).not.toHaveBeenCalled();
      },
    );

    it('claims, sends and releases a first submission', async () => {
      const claimed = { _id: onboardingId };
      onboardingRepository.findCustomerOnboardingById.mockResolvedValue({
        _id: onboardingId,
      });
      onboardingRepository.updateCustomerOnboardingDetails
        .mockResolvedValueOnce(claimed)
        .mockResolvedValueOnce({});

      await expect(submit()).resolves.toEqual({ sent: true });

      const [filter, update] = claimCall();
      expect(filter).toMatchObject({
        _id: onboardingId,
        userId: 'user-1',
        companyId: null,
      });
      expect(filter.companyVerificationStatus).toBeUndefined();
      expect(send).toHaveBeenCalledWith(onboardingId, {}, [], user, claimed);
      expect(
        onboardingRepository.updateCustomerOnboardingDetails,
      ).toHaveBeenLastCalledWith(
        {
          _id: onboardingId,
          kybSubmissionStartedAt: update.$set.kybSubmissionStartedAt,
        },
        { $unset: { kybSubmissionStartedAt: '' } },
      );
    });

    it('claims only a company that is still rejected', async () => {
      onboardingRepository.findCustomerOnboardingById.mockResolvedValue({
        companyId,
        companyVerificationStatus: KybVerificationEnum.Rejected,
      });
      onboardingRepository.updateCustomerOnboardingDetails.mockResolvedValue(
        {},
      );

      await submit();

      expect(claimCall()[0]).toMatchObject({
        companyId,
        companyVerificationStatus: KybVerificationEnum.Rejected,
      });
      expect(send).toHaveBeenCalled();
    });

    it('refuses with 409 when another submission holds the claim', async () => {
      onboardingRepository.findCustomerOnboardingById.mockResolvedValue({});
      onboardingRepository.updateCustomerOnboardingDetails.mockResolvedValue(
        null,
      );

      await expect(submit()).rejects.toBeInstanceOf(ConflictException);
      expect(send).not.toHaveBeenCalled();
      expect(
        onboardingRepository.updateCustomerOnboardingDetails,
      ).toHaveBeenCalledTimes(1);
    });

    it('releases the claim when sending fails', async () => {
      onboardingRepository.findCustomerOnboardingById.mockResolvedValue({});
      onboardingRepository.updateCustomerOnboardingDetails.mockResolvedValue(
        {},
      );
      send.mockRejectedValue(new Error('ID-Service down'));

      await expect(submit()).rejects.toThrow('ID-Service down');
      expect(
        onboardingRepository.updateCustomerOnboardingDetails,
      ).toHaveBeenLastCalledWith(
        expect.objectContaining({ _id: onboardingId }),
        { $unset: { kybSubmissionStartedAt: '' } },
      );
    });
  });

  describe('findUserOnboardingDetail', () => {
    it('sorts by newest instead of filtering on a sort field', async () => {
      const onboarding = { userId: 'user-1', companyName: 'Acme' };
      onboardingRepository.findCustomerOnboardingById.mockResolvedValue(
        onboarding,
      );

      await expect(
        service.findUserOnboardingDetail({ userId: 'user-1' }),
      ).resolves.toEqual(onboarding);
      expect(
        onboardingRepository.findCustomerOnboardingById,
      ).toHaveBeenCalledWith({ userId: 'user-1' }, { sort: { createdAt: -1 } });
    });
  });

  describe('formatStatusReason', () => {
    const format = (reason) => (service as any).formatStatusReason(reason);

    it.each([
      [undefined, ''],
      ['COMPANY_INACTIVE', 'COMPANY_INACTIVE'],
      [['A', 'B'], 'A, B'],
      [
        { code: 'DOC_PENDING', message: 'Tax document under review' },
        'Tax document under review',
      ],
      [[{ code: 'A' }, { reason: 'B' }], 'A, B'],
      [{ TaxRegistration: 'Submitted' }, '{"TaxRegistration":"Submitted"}'],
    ])('formats %j as %j', (reason, expected) => {
      expect(format(reason)).toBe(expected);
    });
  });

  describe('attachOrganisation', () => {
    it("links the owner's existing apps, roles and team rows", async () => {
      appRepository.attachOrganisation.mockResolvedValue(2);
      roleRepository.attachOrganisation.mockResolvedValue({ modifiedCount: 1 });
      adminPeopleRepository.attachOrganisation.mockResolvedValue({
        modifiedCount: 3,
      });

      await (service as any).attachOrganisation('user-1', 'org-1');

      expect(appRepository.attachOrganisation).toHaveBeenCalledWith(
        'user-1',
        'org-1',
      );
      expect(roleRepository.attachOrganisation).toHaveBeenCalledWith(
        'user-1',
        'org-1',
      );
      expect(adminPeopleRepository.attachOrganisation).toHaveBeenCalledWith(
        'user-1',
        'org-1',
      );
    });
  });
});
