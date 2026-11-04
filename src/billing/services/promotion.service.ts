import {
  ForbiddenException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { App, AppDocument } from 'src/app-auth/schemas/app.schema';
import {
  CreditStatus as OnboardingStatus,
  InterestedService,
  TimeUnit,
} from 'src/customer-onboarding/constants/enum';
import {
  CustomerOnboarding,
  CustomerOnboardingDocument,
  PromotionClaim,
} from 'src/customer-onboarding/schemas/customer-onboarding.schema';
import {
  CreditPlan,
  CreditPlanDocument,
  CreditSourceEnum,
  CreditStatus,
} from 'src/credits/schemas/credit.schema';
import { CreditService } from 'src/credits/services/credits.service';
import { calculateFreeCreditAmounts } from 'src/credits/utils/credit-amounts';
import { SERVICE_TYPES } from 'src/supported-service/services/iServiceList';
import { UserRole } from 'src/user/schema/user.schema';
import { CREDIT_REFERENCE_PREFIXES, ONBOARDING_CONFIG } from 'src/utils/utils';
import { redisClient } from 'src/utils/redis.provider';
import { BillingErrorCode } from '../billing.constants';
import { BillingException } from '../billing.exception';
import { buildBillingProfile } from '../profile/billing-profile';
import { InvoiceService } from './invoice.service';

const CLAIM_LOCK_MS = 2 * 60 * 1000;
const ELIGIBLE_SERVICES: string[] = [
  SERVICE_TYPES.SSI_API,
  SERVICE_TYPES.CAVACH_API,
];

export type PromotionReason =
  | 'SERVICE_NOT_ELIGIBLE'
  | 'ONBOARDING_NOT_APPROVED'
  | 'ALREADY_CLAIMED'
  | 'BILLING_PROFILE_INCOMPLETE'
  | 'BILLING_NOT_CONFIGURED';

/** Also the credit plan's referenceId when the claim isn't invoiced. */
export function promotionKey(orgId: string, serviceId: string) {
  return `${CREDIT_REFERENCE_PREFIXES.PROMOTION}${orgId}:${serviceId}`;
}

export interface PromotionCaller {
  userId: string;
  role: string;
}

type StoredOrg = CustomerOnboarding & { _id: unknown };

interface Context {
  app: { appId: string; appName: string };
  serviceId: string;
  org: StoredOrg | null;
  offer: { credits: number; validityDays: number; onChainAllowance?: number };
  record: PromotionClaim | null;
  invoiced: boolean;
  claimed: boolean;
  reason: PromotionReason | null;
  missingFields: string[];
}

/**
 * The free-credit promotion: each organisation can claim it once per service
 * (SSI, ID Service) from the dashboard banner. The claim is recorded on the
 * organisation, so a deleted and recreated app can't claim again. An ID
 * Service claim is issued as a complimentary invoice; SSI isn't invoiced.
 */
@Injectable()
export class PromotionService {
  constructor(
    @InjectModel(App.name) private readonly appModel: Model<AppDocument>,
    @InjectModel(CustomerOnboarding.name)
    private readonly onboardingModel: Model<CustomerOnboardingDocument>,
    @InjectModel(CreditPlan.name)
    private readonly creditPlanModel: Model<CreditPlanDocument>,
    private readonly invoices: InvoiceService,
    private readonly creditService: CreditService,
  ) {}

  /** GET /billing/promotion?appId: whether to show the banner. */
  async status(appId: string, caller: PromotionCaller) {
    return this.view(await this.context(appId, caller));
  }

  /** POST /billing/promotion/claim: the banner's Claim button. */
  async claim(appId: string, caller: PromotionCaller) {
    const ctx = await this.context(appId, caller);
    if (ctx.claimed) {
      if (!ctx.record) await this.recordLegacyClaim(ctx);
      throw this.alreadyClaimed(ctx);
    }
    if (ctx.reason) {
      throw new BillingException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        BillingErrorCode.PROMOTION_NOT_ELIGIBLE,
        'This app is not eligible for free credits.',
        { reason: ctx.reason, missingFields: ctx.missingFields },
      );
    }

    const orgId = String(ctx.org._id);
    const key = promotionKey(orgId, ctx.serviceId);
    const lockKey = `billing:promotion-claim:${key}`;
    const locked = await redisClient.set(
      lockKey,
      caller.userId,
      'PX',
      CLAIM_LOCK_MS,
      'NX',
    );
    if (!locked) throw this.inProgress();
    try {
      // Reserve the organisation's claim; a CLAIMING record is a retry, finished below.
      let record = ctx.record;
      if (!record) {
        record = {
          status: 'CLAIMING',
          appId,
          claimedBy: caller.userId,
          claimedAt: new Date(),
          credits: ctx.offer.credits,
          validityDays: ctx.offer.validityDays,
          onChainAllowance: ctx.offer.onChainAllowance,
          invoiced: ctx.invoiced,
        };
        const reserved = await this.onboardingModel.updateOne(
          { _id: ctx.org._id, [this.path(ctx)]: { $exists: false } },
          { $set: { [this.path(ctx)]: record } },
        );
        if (!reserved.modifiedCount) {
          throw this.alreadyClaimed(await this.context(appId, caller));
        }
      }

      const hadActivePlan = await this.creditPlanModel.exists({
        serviceId: appId,
        status: CreditStatus.ACTIVE,
      });
      let granted: Pick<
        PromotionClaim,
        'creditPlanId' | 'invoiceId' | 'invoiceNumber'
      >;
      if (record.invoiced) {
        const invoice = await this.invoices.issueForPromotion({
          promotionKey: key,
          orgId,
          app: ctx.app,
          credits: record.credits,
          validityDays: record.validityDays,
          claimedBy: record.claimedBy,
        });
        granted = {
          creditPlanId: invoice.creditPlanId,
          invoiceId: String(invoice._id),
          invoiceNumber: invoice.invoiceNumber,
        };
      } else {
        await this.creditService.grantCredit(
          appId,
          {
            amount: String(record.credits),
            validityPeriod: record.validityDays,
            validityPeriodUnit: TimeUnit.Days,
            amountDenom: 'uhid',
            source: CreditSourceEnum.PROMOTION,
          },
          record.claimedBy,
          CreditSourceEnum.PROMOTION,
          key,
          record.onChainAllowance !== undefined
            ? String(record.onChainAllowance)
            : undefined,
        );
        const plan = await this.creditPlanModel
          .findOne({ serviceId: appId, referenceId: key }, { _id: 1 })
          .lean();
        granted = { creditPlanId: plan ? String(plan._id) : undefined };
      }

      const done: PromotionClaim = {
        ...record,
        ...granted,
        status: 'GRANTED',
        grantedAt: new Date(),
      };
      await this.onboardingModel.updateOne(
        { _id: ctx.org._id, [`${this.path(ctx)}.status`]: 'CLAIMING' },
        { $set: { [this.path(ctx)]: done } },
      );
      Logger.log(
        `Promotion claimed for ${key} on app ${appId}`,
        'PromotionService',
      );
      return {
        message: 'Free credits granted.',
        claim: this.claimView(done),
        creditsActive: hadActivePlan ? 'AFTER_CURRENT_PLAN' : 'IMMEDIATELY',
      };
    } finally {
      await redisClient.del(lockKey);
    }
  }

  private path(ctx: Context) {
    return `promotions.${ctx.serviceId}`;
  }

  private async context(
    appId: string,
    caller: PromotionCaller,
  ): Promise<Context> {
    const app = await this.appModel
      .findOne(
        { appId },
        { appId: 1, appName: 1, userId: 1, orgId: 1, services: 1 },
      )
      .lean();
    if (!app || app.userId !== caller.userId) {
      throw new BillingException(
        HttpStatus.NOT_FOUND,
        BillingErrorCode.APP_NOT_FOUND,
        'App not found.',
      );
    }
    if (
      caller.role !== UserRole.ADMIN &&
      caller.role !== UserRole.SUPER_ADMIN
    ) {
      throw new ForbiddenException(['Caller is not eligible to claim credits']);
    }
    const serviceId = app.services?.[0]?.id as string;
    const ctx: Context = {
      app: { appId: app.appId, appName: app.appName },
      serviceId,
      org: null,
      offer: null,
      record: null,
      invoiced: false,
      claimed: false,
      reason: null,
      missingFields: [],
    };
    if (!ELIGIBLE_SERVICES.includes(serviceId)) {
      return { ...ctx, reason: 'SERVICE_NOT_ELIGIBLE' };
    }

    const org: StoredOrg = await this.onboardingModel
      .findOne(app.orgId ? { _id: app.orgId } : { userId: app.userId }, {
        companyName: 1,
        customerEmail: 1,
        country: 1,
        billing: 1,
        userId: 1,
        onboardingStatus: 1,
        interestedService: 1,
        promotions: 1,
      })
      .lean();
    if (!org || org.onboardingStatus !== OnboardingStatus.APPROVED) {
      return { ...ctx, org, reason: 'ONBOARDING_NOT_APPROVED' };
    }
    ctx.org = org;

    const record = org.promotions?.[serviceId] ?? null;
    if (record) {
      ctx.record = record;
      ctx.offer = {
        credits: record.credits,
        validityDays: record.validityDays,
      };
      ctx.invoiced = record.invoiced;
      // A CLAIMING record on this app is an unfinished claim: claiming again finishes it.
      if (record.status === 'GRANTED' || record.appId !== appId) {
        return { ...ctx, claimed: true, reason: 'ALREADY_CLAIMED' };
      }
      return ctx;
    }

    const amounts = calculateFreeCreditAmounts(
      ONBOARDING_CONFIG.TOTAL_VERIFICATION,
      org.interestedService as InterestedService[],
      ONBOARDING_CONFIG.EXPIRY,
    );
    const isSsi = serviceId === SERVICE_TYPES.SSI_API;
    ctx.offer = {
      credits: isSsi ? amounts.ssiCreditAmount : amounts.kycCreditAmount,
      validityDays: amounts.validityPeriod,
      ...(isSsi && { onChainAllowance: amounts.ssiHidAllowanceAmount }),
    };
    if (await this.legacyPlan(String(org._id), serviceId, appId)) {
      return { ...ctx, claimed: true, reason: 'ALREADY_CLAIMED' };
    }

    // ID Service free credits always get a ₹0 invoice; SSI isn't invoiced.
    ctx.invoiced = serviceId === SERVICE_TYPES.CAVACH_API;
    // Saved billing details are enough, for every service; company
    // verification (KYB) isn't waited for, as with going live.
    const profile = buildBillingProfile(org);
    if (!profile.complete) {
      return {
        ...ctx,
        reason: 'BILLING_PROFILE_INCOMPLETE',
        missingFields: profile.missingFields,
      };
    }
    if (ctx.invoiced) {
      try {
        this.invoices.assertConfigured();
      } catch {
        return { ...ctx, reason: 'BILLING_NOT_CONFIGURED' };
      }
    }
    return ctx;
  }

  /**
   * Free credits granted before claims were recorded on the organisation: a
   * PROMOTION plan on any of its apps of this service, or, for ID Service,
   * the starter credits onboarding used to grant.
   */
  private async legacyPlan(
    orgId: string,
    serviceId: string,
    appId: string,
  ): Promise<{ _id: unknown; serviceId: string; createdAt?: Date } | null> {
    const apps = await this.appModel
      .find({ orgId, 'services.id': serviceId }, { appId: 1 })
      .lean();
    const appIds = [...new Set([appId, ...apps.map((a) => a.appId)])];
    const sources =
      serviceId === SERVICE_TYPES.CAVACH_API
        ? [CreditSourceEnum.PROMOTION, CreditSourceEnum.CUSTOMER_ONBOARDING]
        : [CreditSourceEnum.PROMOTION];
    return this.creditPlanModel
      .findOne(
        { serviceId: { $in: appIds }, source: { $in: sources } },
        { _id: 1, serviceId: 1, createdAt: 1 },
      )
      .lean();
  }

  /** Writes the claim for a legacy grant, so it holds even if that app is deleted. */
  private async recordLegacyClaim(ctx: Context) {
    const plan = await this.legacyPlan(
      String(ctx.org._id),
      ctx.serviceId,
      ctx.app.appId,
    );
    if (!plan) return;
    const record: PromotionClaim = {
      status: 'GRANTED',
      appId: plan.serviceId,
      claimedBy: ctx.org.userId,
      claimedAt: plan.createdAt ?? new Date(),
      credits: ctx.offer.credits,
      validityDays: ctx.offer.validityDays,
      invoiced: false,
      creditPlanId: String(plan._id),
      grantedAt: plan.createdAt ?? new Date(),
      legacy: true,
    };
    await this.onboardingModel.updateOne(
      { _id: ctx.org._id, [this.path(ctx)]: { $exists: false } },
      { $set: { [this.path(ctx)]: record } },
    );
    ctx.record = record;
  }

  private alreadyClaimed(ctx: Context) {
    return new BillingException(
      HttpStatus.CONFLICT,
      BillingErrorCode.PROMOTION_ALREADY_CLAIMED,
      'Free credits have already been claimed for this organisation.',
      { claim: ctx.record ? this.claimView(ctx.record) : null },
    );
  }

  private inProgress() {
    return new BillingException(
      HttpStatus.CONFLICT,
      BillingErrorCode.PROMOTION_CLAIM_IN_PROGRESS,
      'The free-credit claim is being processed. Check again in a few seconds.',
    );
  }

  private claimView(record: PromotionClaim) {
    return {
      status: record.status,
      appId: record.appId,
      credits: record.credits,
      validityDays: record.validityDays,
      claimedAt: record.claimedAt,
      grantedAt: record.grantedAt ?? null,
      creditPlanId: record.creditPlanId ?? null,
      invoiceId: record.invoiceId ?? null,
      invoiceNumber: record.invoiceNumber ?? null,
    };
  }

  private view(ctx: Context) {
    return {
      appId: ctx.app.appId,
      serviceId: ctx.serviceId,
      eligible: !ctx.claimed && !ctx.reason,
      claimed: ctx.claimed,
      reason: ctx.reason,
      missingFields: ctx.missingFields,
      offer: ctx.offer
        ? { credits: ctx.offer.credits, validityDays: ctx.offer.validityDays }
        : null,
      invoiced: ctx.invoiced,
      claim: ctx.record ? this.claimView(ctx.record) : null,
    };
  }
}
