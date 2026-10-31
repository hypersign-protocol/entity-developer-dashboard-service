import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { App, AppDocument } from 'src/app-auth/schemas/app.schema';
import {
  CustomerOnboarding,
  CustomerOnboardingDocument,
} from 'src/customer-onboarding/schemas/customer-onboarding.schema';
import { SERVICE_TYPES } from 'src/supported-service/services/iServiceList';
import {
  BillingCurrency,
  BillingErrorCode,
  BillingRegion,
  isBillingEnabled,
  REGION_CURRENCY,
} from '../billing.constants';
import { BillingException } from '../billing.exception';
import {
  BillingProfile,
  buildBillingProfile,
  regionFromCountry,
} from '../profile/billing-profile';

export interface BillingAccount {
  orgId: string;
  ownerUserId: string;
  region: BillingRegion;
  currency: BillingCurrency;
  kybStatus?: string;
  kybApprovedAt?: Date;
  taxIdTypes: string[];
  profile: BillingProfile;
}

@Injectable()
export class BillingAccountService {
  constructor(
    @InjectModel(CustomerOnboarding.name)
    private readonly onboardingModel: Model<CustomerOnboardingDocument>,
    @InjectModel(App.name) private readonly appModel: Model<AppDocument>,
  ) {}

  /**
   * The caller's organisation and billing region. `userId` is the owner's id
   * (JWTAccessAccountMiddleware maps team members to it). Refuses regions
   * where billing is switched off.
   */
  async resolve(userId: string): Promise<BillingAccount> {
    const org = await this.onboardingModel
      .findOne(
        { userId },
        {
          companyName: 1,
          customerEmail: 1,
          country: 1,
          billing: 1,
          companyVerificationStatus: 1,
          companyVerificationApprovedAt: 1,
        },
      )
      .lean();
    if (!org) {
      throw new BillingException(
        HttpStatus.NOT_FOUND,
        BillingErrorCode.ONBOARDING_NOT_FOUND,
        'Complete onboarding to use billing.',
      );
    }
    const orgId = org._id.toString();

    let region = org.billing?.region as BillingRegion | undefined;
    if (!region) {
      const derived =
        regionFromCountry(org.billing?.address?.country) ||
        regionFromCountry(org.country);
      region = derived ?? BillingRegion.GLOBAL;
      // Stored once, and only from a known country: a missing country must not
      // lock an Indian customer into Global pricing. Billing's own $set path.
      if (derived) {
        await this.onboardingModel.updateOne(
          { _id: org._id, 'billing.region': { $exists: false } },
          {
            $set: {
              'billing.region': region,
              'billing.currency': REGION_CURRENCY[region],
            },
          },
        );
        Logger.log(
          `Billing region ${region} set for organisation ${orgId}`,
          'BillingAccountService',
        );
      }
    }

    if (!isBillingEnabled(region)) {
      throw new BillingException(
        HttpStatus.SERVICE_UNAVAILABLE,
        BillingErrorCode.BILLING_DISABLED,
        'Billing is not available for your region yet.',
      );
    }

    return {
      orgId,
      ownerUserId: userId,
      region,
      currency: REGION_CURRENCY[region],
      kybStatus: org.companyVerificationStatus,
      kybApprovedAt: org.companyVerificationApprovedAt,
      taxIdTypes: (org.billing?.taxIds || []).map((t) => t.type),
      profile: buildBillingProfile({
        ...org,
        billing: { ...org.billing, region },
      }),
    };
  }

  /** Checks that the app belongs to the organisation and is an ID Service app. */
  async assertBillableApp(appId: string, account: BillingAccount) {
    const app = await this.appModel
      .findOne(
        { appId },
        { appId: 1, appName: 1, userId: 1, orgId: 1, services: 1 },
      )
      .lean();
    // Environments not yet backfilled may lack orgId; fall back to the owner.
    const ownsApp =
      app &&
      (app.orgId
        ? app.orgId === account.orgId
        : app.userId === account.ownerUserId);
    if (!ownsApp) {
      throw new BillingException(
        HttpStatus.NOT_FOUND,
        BillingErrorCode.APP_NOT_FOUND,
        'App not found.',
      );
    }
    if (app.services?.[0]?.id !== SERVICE_TYPES.CAVACH_API) {
      throw new BillingException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        BillingErrorCode.APP_NOT_BILLABLE,
        'Only ID Service apps can be topped up here.',
      );
    }
    return app;
  }
}
