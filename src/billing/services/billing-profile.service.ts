import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isPhoneNumber } from 'class-validator';
import { Model, Types } from 'mongoose';
import {
  CustomerOnboarding,
  CustomerOnboardingDocument,
} from 'src/customer-onboarding/schemas/customer-onboarding.schema';
import {
  BillingErrorCode,
  BillingRegion,
  REGION_CURRENCY,
} from '../billing.constants';
import { BillingException } from '../billing.exception';
import {
  AdminUpdateBillingProfileDto,
  UpdateBillingProfileDto,
} from '../dto/update-billing-profile.dto';
import {
  buildBillingProfile,
  gstStateFromTaxIds,
  isGstStateCode,
  normaliseTaxIds,
  regionFromCountry,
  taxIdProblem,
} from '../profile/billing-profile';

const PROFILE_FIELDS = {
  companyName: 1,
  customerEmail: 1,
  country: 1,
  billing: 1,
};

/**
 * GET/PUT /customer-onboarding/billing (docs/payment/api-contract.md §2).
 * Not gated by BILLING_ENABLED_REGIONS: invoices need the profile too.
 */
@Injectable()
export class BillingProfileService {
  constructor(
    @InjectModel(CustomerOnboarding.name)
    private readonly onboardingModel: Model<CustomerOnboardingDocument>,
  ) {}

  private async findOrg(userId: string) {
    const org = await this.onboardingModel
      .findOne({ userId }, PROFILE_FIELDS)
      .lean();
    if (!org) {
      throw new BillingException(
        HttpStatus.NOT_FOUND,
        BillingErrorCode.ONBOARDING_NOT_FOUND,
        'Complete onboarding to add billing details.',
      );
    }
    return org;
  }

  async get(userId: string) {
    return buildBillingProfile(await this.findOrg(userId));
  }

  /** PUT /customer-onboarding/billing: the customer saves their own profile. */
  async save(userId: string, dto: UpdateBillingProfileDto) {
    return this.write(await this.findOrg(userId), dto, {});
  }

  /**
   * PATCH /admin/billing/profiles/:orgId: a super admin completes or corrects a
   * customer's profile, for example before invoicing them. May change the region
   * and locked tax IDs; the reason is logged.
   */
  async adminUpdate(
    orgId: string,
    dto: AdminUpdateBillingProfileDto,
    adminUserId: string,
  ) {
    const org = Types.ObjectId.isValid(orgId)
      ? await this.onboardingModel.findById(orgId, PROFILE_FIELDS).lean()
      : null;
    if (!org) {
      throw new BillingException(
        HttpStatus.NOT_FOUND,
        BillingErrorCode.ONBOARDING_NOT_FOUND,
        'Organisation not found.',
      );
    }
    Logger.log(
      `Billing profile of ${orgId} changed by super admin ${adminUserId}: ${dto.reason}`,
      'BillingProfileService',
    );
    return this.write(org, dto, {
      region: dto.region as BillingRegion | undefined,
      admin: true,
      unlock: dto.unlock === true,
    });
  }

  private async write(
    org: { _id: unknown; billing?: any },
    dto: UpdateBillingProfileDto,
    options: { region?: BillingRegion; admin?: boolean; unlock?: boolean },
  ) {
    const existing = org.billing || {};
    const taxIds = normaliseTaxIds(dto.taxIds);

    const fields: Record<string, string> = {};
    taxIds.forEach((taxId, i) => {
      const problem = taxIdProblem(taxId);
      if (problem) fields[`taxIds[${i}].number`] = problem;
    });
    const region = (options.region ||
      existing.region ||
      regionFromCountry(dto.address.country) ||
      BillingRegion.GLOBAL) as BillingRegion;
    // A GSTIN fixes the state; otherwise the customer picks it.
    const gstStateCode =
      region === BillingRegion.IN
        ? gstStateFromTaxIds(taxIds) || dto.gstStateCode
        : undefined;
    if (gstStateCode && !isGstStateCode(gstStateCode)) {
      fields.gstStateCode = 'Not a valid GST state code';
    }
    // Stored as +<digits>, which Razorpay's checkout and links accept.
    const phoneInput = dto.phone?.trim();
    const phone = phoneInput ? phoneInput.replace(/[^\d+]/g, '') : undefined;
    if (
      phoneInput &&
      !(phoneInput.startsWith('+') && isPhoneNumber(phoneInput))
    ) {
      fields.phone =
        'Enter the number with its country code, for example +49 30 12345678';
    }
    if (Object.keys(fields).length) {
      throw new BillingException(
        HttpStatus.BAD_REQUEST,
        BillingErrorCode.VALIDATION_FAILED,
        'The request is not valid.',
        { fields },
      );
    }

    const sameTaxIds =
      JSON.stringify(normaliseTaxIds(existing.taxIds || [])) ===
      JSON.stringify(taxIds);
    if (existing.lockedAt && !sameTaxIds && !options.admin) {
      throw new BillingException(
        HttpStatus.CONFLICT,
        BillingErrorCode.BILLING_PROFILE_LOCKED,
        'Tax IDs can no longer be changed. Contact support to update them.',
      );
    }

    // Billing's own write path: only billing.* fields, never the rest of onboarding.
    const updated = await this.onboardingModel
      .findOneAndUpdate(
        { _id: org._id },
        {
          $set: {
            'billing.legalName': dto.legalName.trim(),
            'billing.email': dto.email.trim().toLowerCase(),
            'billing.address': {
              street: dto.address.street.trim(),
              city: dto.address.city.trim(),
              province: dto.address.province.trim(),
              postalCode: dto.address.postalCode.trim(),
              country: dto.address.country,
            },
            'billing.taxIds': taxIds,
            'billing.region': region,
            'billing.currency': REGION_CURRENCY[region],
            'billing.confirmedAt': new Date(),
            ...(gstStateCode && { 'billing.gstStateCode': gstStateCode }),
            ...(phone && { 'billing.phone': phone }),
          },
          ...((!gstStateCode || !phone || options.unlock) && {
            $unset: {
              ...(!gstStateCode && { 'billing.gstStateCode': '' }),
              ...(!phone && { 'billing.phone': '' }),
              ...(options.unlock && { 'billing.lockedAt': '' }),
            },
          }),
        },
        { new: true, projection: PROFILE_FIELDS },
      )
      .lean();
    return buildBillingProfile(updated);
  }
}
