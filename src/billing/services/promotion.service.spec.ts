import { Types } from 'mongoose';
import { CreditSourceEnum } from 'src/credits/schemas/credit.schema';
import { PromotionService } from './promotion.service';

const redis = { set: jest.fn(), del: jest.fn() };
// jest.mock is hoisted above `redis`, so the mock reads it lazily.
jest.mock('src/utils/redis.provider', () => ({
  redisClient: {
    set: (...args) => redis.set(...args),
    del: (...args) => redis.del(...args),
  },
}));
// The real amounts come from the credit-middleware catalogs.
jest.mock('src/credits/utils/credit-amounts', () => ({
  calculateFreeCreditAmounts: () => ({
    kycCreditAmount: 5000,
    ssiCreditAmount: 700,
    ssiHidAllowanceAmount: 90,
    validityPeriod: 15,
  }),
}));
const profile = { complete: true, missingFields: [] };
jest.mock('../profile/billing-profile', () => ({
  buildBillingProfile: () => profile,
}));

const lean = (value) => ({ lean: jest.fn().mockResolvedValue(value) });
const orgId = new Types.ObjectId();
const owner = { userId: 'user-1', role: 'ADMIN' };
const ssiApp = {
  appId: 'ssi-1',
  appName: 'Acme SSI',
  userId: 'user-1',
  orgId: String(orgId),
  services: [{ id: 'SSI_API' }],
};
const kycApp = { ...ssiApp, appId: 'kyc-1', services: [{ id: 'CAVACH_API' }] };

describe('PromotionService', () => {
  const appModel = { findOne: jest.fn(), find: jest.fn() };
  const onboardingModel = { findOne: jest.fn(), updateOne: jest.fn() };
  const creditPlanModel = { findOne: jest.fn(), exists: jest.fn() };
  const invoices = {
    issueForPromotion: jest.fn(),
    assertConfigured: jest.fn(),
  };
  const creditService = { grantCredit: jest.fn() };
  let service: PromotionService;
  let org;

  const withApp = (app) => appModel.findOne.mockReturnValue(lean(app));

  beforeEach(() => {
    jest.resetAllMocks();
    profile.complete = true;
    profile.missingFields = [];
    org = {
      _id: orgId,
      userId: 'user-1',
      onboardingStatus: 'APPROVED',
      interestedService: [],
    };
    withApp(ssiApp);
    appModel.find.mockReturnValue(lean([]));
    onboardingModel.findOne.mockImplementation(() => lean(org));
    onboardingModel.updateOne.mockResolvedValue({ modifiedCount: 1 });
    creditPlanModel.findOne.mockReturnValue(lean(null));
    creditPlanModel.exists.mockResolvedValue(null);
    redis.set.mockResolvedValue('OK');
    service = new PromotionService(
      appModel as any,
      onboardingModel as any,
      creditPlanModel as any,
      invoices as any,
      creditService as any,
    );
  });

  describe('status', () => {
    it('offers the free credits to an approved organisation that has not claimed', async () => {
      await expect(service.status('ssi-1', owner)).resolves.toMatchObject({
        eligible: true,
        claimed: false,
        reason: null,
        offer: { credits: 700, validityDays: 15 },
        invoiced: false,
        claim: null,
      });
    });

    it('is claimed for every app of the service once the organisation has claimed', async () => {
      // Claimed on an app that was later deleted: a new app can't claim again.
      org.promotions = {
        SSI_API: {
          status: 'GRANTED',
          appId: 'ssi-deleted',
          credits: 700,
          validityDays: 15,
          invoiced: false,
        },
      };
      await expect(service.status('ssi-1', owner)).resolves.toMatchObject({
        eligible: false,
        claimed: true,
        reason: 'ALREADY_CLAIMED',
        claim: { appId: 'ssi-deleted', status: 'GRANTED' },
      });
    });

    it('treats a PROMOTION plan granted before claims were recorded as claimed', async () => {
      creditPlanModel.findOne.mockReturnValue(
        lean({ _id: 'plan-1', serviceId: 'ssi-1' }),
      );
      await expect(service.status('ssi-1', owner)).resolves.toMatchObject({
        claimed: true,
        reason: 'ALREADY_CLAIMED',
      });
      expect(creditPlanModel.findOne.mock.calls[0][0]).toEqual({
        serviceId: { $in: ['ssi-1'] },
        source: { $in: [CreditSourceEnum.PROMOTION] },
      });
    });

    it('counts the old onboarding starter credits as claimed for ID Service', async () => {
      withApp(kycApp);
      await service.status('kyc-1', owner);
      expect(creditPlanModel.findOne.mock.calls[0][0].source).toEqual({
        $in: [CreditSourceEnum.PROMOTION, CreditSourceEnum.CUSTOMER_ONBOARDING],
      });
    });

    it('asks for billing details first for an ID Service claim (it is invoiced)', async () => {
      withApp(kycApp);
      profile.complete = false;
      profile.missingFields = ['address.postalCode'];
      await expect(service.status('kyc-1', owner)).resolves.toMatchObject({
        eligible: false,
        claimed: false,
        reason: 'BILLING_PROFILE_INCOMPLETE',
        missingFields: ['address.postalCode'],
        offer: { credits: 5000, validityDays: 15 },
        invoiced: true,
      });
    });

    it('does not wait for company verification (KYB)', async () => {
      org.companyVerificationStatus = 'Submitted';
      await expect(service.status('ssi-1', owner)).resolves.toMatchObject({
        eligible: true,
        reason: null,
      });
    });

    it('needs billing details for SSI too, though SSI is not invoiced', async () => {
      profile.complete = false;
      profile.missingFields = ['address.city'];
      await expect(service.status('ssi-1', owner)).resolves.toMatchObject({
        eligible: false,
        reason: 'BILLING_PROFILE_INCOMPLETE',
        missingFields: ['address.city'],
        invoiced: false,
      });
    });

    it('is not eligible before onboarding is approved', async () => {
      org.onboardingStatus = 'INITIATED';
      await expect(service.status('ssi-1', owner)).resolves.toMatchObject({
        eligible: false,
        reason: 'ONBOARDING_NOT_APPROVED',
      });
    });

    it("hides another owner's app", async () => {
      await expect(
        service.status('ssi-1', { userId: 'someone-else', role: 'ADMIN' }),
      ).rejects.toMatchObject({ code: 'APP_NOT_FOUND' });
    });
  });

  describe('claim', () => {
    it('records the claim on the organisation, then grants the SSI credits once', async () => {
      creditPlanModel.findOne
        .mockReturnValueOnce(lean(null)) // no legacy plan
        .mockReturnValueOnce(lean({ _id: 'plan-1' }));

      const result = await service.claim('ssi-1', owner);

      const key = `PROMOTION:${orgId}:SSI_API`;
      expect(onboardingModel.updateOne.mock.calls[0]).toEqual([
        { _id: orgId, 'promotions.SSI_API': { $exists: false } },
        {
          $set: {
            'promotions.SSI_API': expect.objectContaining({
              status: 'CLAIMING',
              appId: 'ssi-1',
              credits: 700,
              onChainAllowance: 90,
              invoiced: false,
            }),
          },
        },
      ]);
      expect(creditService.grantCredit).toHaveBeenCalledWith(
        'ssi-1',
        expect.objectContaining({ amount: '700', validityPeriod: 15 }),
        'user-1',
        CreditSourceEnum.PROMOTION,
        key,
        '90',
      );
      expect(onboardingModel.updateOne.mock.calls[1][1].$set).toEqual({
        'promotions.SSI_API': expect.objectContaining({
          status: 'GRANTED',
          creditPlanId: 'plan-1',
        }),
      });
      expect(result).toMatchObject({
        claim: { status: 'GRANTED', appId: 'ssi-1', creditPlanId: 'plan-1' },
        creditsActive: 'IMMEDIATELY',
      });
      expect(redis.del).toHaveBeenCalledWith(`billing:promotion-claim:${key}`);
    });

    it('issues a complimentary invoice for an ID Service claim', async () => {
      withApp(kycApp);
      invoices.issueForPromotion.mockResolvedValue({
        _id: 'inv-1',
        invoiceNumber: 'HS/IN/2026-27/0007',
        creditPlanId: 'plan-2',
      });

      const result = await service.claim('kyc-1', owner);

      expect(invoices.issueForPromotion).toHaveBeenCalledWith({
        promotionKey: `PROMOTION:${orgId}:CAVACH_API`,
        orgId: String(orgId),
        app: { appId: 'kyc-1', appName: 'Acme SSI' },
        credits: 5000,
        validityDays: 15,
        claimedBy: 'user-1',
      });
      expect(creditService.grantCredit).not.toHaveBeenCalled();
      expect(result.claim).toMatchObject({
        invoiceId: 'inv-1',
        invoiceNumber: 'HS/IN/2026-27/0007',
        creditPlanId: 'plan-2',
      });
    });

    it('refuses a second claim with 409 and grants nothing', async () => {
      org.promotions = {
        SSI_API: { status: 'GRANTED', appId: 'ssi-1', invoiced: false },
      };
      await expect(service.claim('ssi-1', owner)).rejects.toMatchObject({
        code: 'PROMOTION_ALREADY_CLAIMED',
      });
      expect(creditService.grantCredit).not.toHaveBeenCalled();
      expect(redis.set).not.toHaveBeenCalled();
    });

    it('records a legacy grant on the organisation and refuses the claim', async () => {
      creditPlanModel.findOne.mockReturnValue(
        lean({ _id: 'plan-0', serviceId: 'ssi-old' }),
      );
      await expect(service.claim('ssi-1', owner)).rejects.toMatchObject({
        code: 'PROMOTION_ALREADY_CLAIMED',
      });
      expect(onboardingModel.updateOne.mock.calls[0][1].$set).toEqual({
        'promotions.SSI_API': expect.objectContaining({
          status: 'GRANTED',
          appId: 'ssi-old',
          creditPlanId: 'plan-0',
          legacy: true,
        }),
      });
      expect(creditService.grantCredit).not.toHaveBeenCalled();
    });

    it('answers 409 while another claim for the organisation is running', async () => {
      redis.set.mockResolvedValue(null);
      await expect(service.claim('ssi-1', owner)).rejects.toMatchObject({
        code: 'PROMOTION_CLAIM_IN_PROGRESS',
      });
      expect(creditService.grantCredit).not.toHaveBeenCalled();
    });

    it('finishes an interrupted claim with the amounts it recorded', async () => {
      org.promotions = {
        SSI_API: {
          status: 'CLAIMING',
          appId: 'ssi-1',
          claimedBy: 'user-1',
          credits: 650,
          validityDays: 15,
          onChainAllowance: 80,
          invoiced: false,
        },
      };
      await service.claim('ssi-1', owner);

      expect(onboardingModel.updateOne).toHaveBeenCalledTimes(1); // only GRANTED
      expect(creditService.grantCredit).toHaveBeenCalledWith(
        'ssi-1',
        expect.objectContaining({ amount: '650' }),
        'user-1',
        CreditSourceEnum.PROMOTION,
        `PROMOTION:${orgId}:SSI_API`,
        '80',
      );
    });

    it('loses a race to a claim that reserved first', async () => {
      onboardingModel.updateOne.mockResolvedValue({ modifiedCount: 0 });
      await expect(service.claim('ssi-1', owner)).rejects.toMatchObject({
        code: 'PROMOTION_ALREADY_CLAIMED',
      });
      expect(creditService.grantCredit).not.toHaveBeenCalled();
      expect(redis.del).toHaveBeenCalled();
    });

    it('refuses a claim until billing details are saved', async () => {
      profile.complete = false;
      profile.missingFields = ['address.city'];
      await expect(service.claim('ssi-1', owner)).rejects.toMatchObject({
        code: 'PROMOTION_NOT_ELIGIBLE',
        response: {
          details: {
            reason: 'BILLING_PROFILE_INCOMPLETE',
            missingFields: ['address.city'],
          },
        },
      });
      expect(redis.set).not.toHaveBeenCalled();
      expect(creditService.grantCredit).not.toHaveBeenCalled();
    });

    it('refuses an app that is not eligible', async () => {
      withApp({ ...ssiApp, services: [{ id: 'QUEST' }] });
      await expect(service.claim('ssi-1', owner)).rejects.toMatchObject({
        code: 'PROMOTION_NOT_ELIGIBLE',
      });
    });
  });
});
