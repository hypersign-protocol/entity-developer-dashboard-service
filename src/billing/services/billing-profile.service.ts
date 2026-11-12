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
import { Order, OrderDocument, OrderStatus } from '../schemas/order.schema';
import {
  AdminUpdateBillingProfileDto,
  UpdateBillingProfileDto,
} from '../dto/update-billing-profile.dto';
import {
  buildBillingProfile,
  gstStateFromProvince,
  gstStateFromTaxIds,
  isGstStateCode,
  normaliseTaxIds,
  regionFromCountry,
  taxIdProblem,
} from '../profile/billing-profile';

// Orders still to be paid or invoiced, in the region they were priced in.
const OPEN_ORDER_STATUSES = [
  OrderStatus.CREATED,
  OrderStatus.PENDING_PAYMENT,
  OrderStatus.PAID,
  OrderStatus.NEEDS_REVIEW,
];

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
    @InjectModel(Order.name)
    private readonly orderModel: Model<OrderDocument>,
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

    // The billing address country decides the region and currency (ADR §4.0).
    // A super admin may set the region outright.
    const region = (options.region ||
      regionFromCountry(dto.address.country) ||
      BillingRegion.GLOBAL) as BillingRegion;

    const fields: Record<string, string> = {};
    taxIds.forEach((taxId, i) => {
      const problem =
        taxIdProblem(taxId) ||
        (taxId.type === 'GSTIN' && region !== BillingRegion.IN
          ? 'A GSTIN can only be used with a billing address in India'
          : null);
      if (problem) fields[`taxIds[${i}].number`] = problem;
    });
    // A GSTIN fixes the state. Otherwise it's the state the customer picked,
    // which the dashboard sends as gstStateCode, or the province's name.
    const gstStateCode =
      region === BillingRegion.IN
        ? gstStateFromTaxIds(taxIds) ||
          dto.gstStateCode ||
          gstStateFromProvince(dto.address.province) ||
          undefined
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
    const regionChanges = !!existing.region && region !== existing.region;
    if (regionChanges && existing.lockedAt && !options.admin) {
      // Issued invoices carry the region, so it is fixed once there is one.
      throw new BillingException(
        HttpStatus.CONFLICT,
        BillingErrorCode.BILLING_PROFILE_LOCKED,
        'Your billing country sets your region and currency, which can no longer be changed. Contact support to update it.',
      );
    }
    if (regionChanges) {
      // An open order was priced, and will be invoiced, in the old region and
      // currency. It isn't cancelled here: a payment may be in flight.
      const openOrders = await this.orderModel
        .find(
          { orgId: String(org._id), status: { $in: OPEN_ORDER_STATUSES } },
          { orderNumber: 1 },
        )
        .limit(10)
        .lean();
      if (openOrders.length) {
        throw new BillingException(
          HttpStatus.CONFLICT,
          BillingErrorCode.REGION_CHANGE_BLOCKED,
          'You have an order in progress. Finish or cancel it before changing your billing country.',
          { orders: openOrders.map((o) => o.orderNumber) },
        );
      }
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
