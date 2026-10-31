import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
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
import { UpdateBillingProfileDto } from '../dto/update-billing-profile.dto';
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

  async save(userId: string, dto: UpdateBillingProfileDto) {
    const org = await this.findOrg(userId);
    const existing = org.billing || {};
    const taxIds = normaliseTaxIds(dto.taxIds);

    const fields: Record<string, string> = {};
    taxIds.forEach((taxId, i) => {
      const problem = taxIdProblem(taxId);
      if (problem) fields[`taxIds[${i}].number`] = problem;
    });
    const region = (existing.region ||
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
    if (existing.lockedAt && !sameTaxIds) {
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
          },
          ...(!gstStateCode && { $unset: { 'billing.gstStateCode': '' } }),
        },
        { new: true, projection: PROFILE_FIELDS },
      )
      .lean();
    return buildBillingProfile(updated);
  }
}
