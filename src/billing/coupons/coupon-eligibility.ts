// Pure coupon eligibility (ADR §4.3): whether an account may use a coupon now.

export interface EligibilityCoupon {
  region: string;
  status: string;
  eligibility?: {
    requiresKybApproved?: boolean;
    requiresTaxId?: string[];
    withinDaysOfKybApproval?: number;
    firstPurchaseOnly?: boolean;
    minDaysSinceLastPurchase?: number;
    allowedOrgIds?: string[];
  };
  limits?: {
    maxAccounts?: number;
    maxRedemptions?: number;
    maxRedemptionsPerAccount?: number;
    startsAt?: Date;
    expiresAt?: Date;
  };
  accountCount: number;
  redemptionCount: number;
}

export interface EligibilityAccount {
  orgId: string;
  region: string;
  kybStatus?: string;
  kybApprovedAt?: Date;
  taxIdTypes: string[];
  claim?: { redemptions: number }; // the account's CouponAccount, if any
}

export type IneligibleReason =
  | 'NOT_ACTIVE'
  | 'WRONG_REGION'
  | 'NOT_STARTED'
  | 'EXPIRED'
  | 'KYB_NOT_APPROVED'
  | 'KYB_WINDOW_PASSED'
  | 'TAX_ID_MISSING'
  | 'NOT_ALLOWED'
  | 'NEEDS_PURCHASE_HISTORY'
  | 'ACCOUNT_LIMIT_REACHED'
  | 'USES_EXHAUSTED'
  | 'REDEMPTION_LIMIT_REACHED';

export type EligibilityResult =
  | { eligible: true; usesLeft: number | null; expiresAt: Date | null }
  | { eligible: false; reason: IneligibleReason };

const DAY_MS = 24 * 60 * 60 * 1000;

export function checkCouponEligibility(
  coupon: EligibilityCoupon,
  account: EligibilityAccount,
  now: Date,
): EligibilityResult {
  const rules = coupon.eligibility || {};
  const limits = coupon.limits || {};
  const no = (reason: IneligibleReason): EligibilityResult => ({
    eligible: false,
    reason,
  });

  if (coupon.status !== 'ACTIVE') return no('NOT_ACTIVE');
  if (coupon.region !== account.region) return no('WRONG_REGION');
  if (limits.startsAt && now < new Date(limits.startsAt))
    return no('NOT_STARTED');
  if (limits.expiresAt && now >= new Date(limits.expiresAt))
    return no('EXPIRED');

  if (
    rules.allowedOrgIds?.length &&
    !rules.allowedOrgIds.includes(account.orgId)
  ) {
    return no('NOT_ALLOWED');
  }
  if (
    (rules.requiresKybApproved || rules.withinDaysOfKybApproval) &&
    account.kybStatus !== 'Approved'
  ) {
    return no('KYB_NOT_APPROVED');
  }
  let kybWindowEnd: Date | null = null;
  if (rules.withinDaysOfKybApproval) {
    if (!account.kybApprovedAt) return no('KYB_NOT_APPROVED');
    kybWindowEnd = new Date(
      new Date(account.kybApprovedAt).getTime() +
        rules.withinDaysOfKybApproval * DAY_MS,
    );
    if (now >= kybWindowEnd) return no('KYB_WINDOW_PASSED');
  }
  if (
    rules.requiresTaxId?.length &&
    !rules.requiresTaxId.some((type) => account.taxIdTypes.includes(type))
  ) {
    return no('TAX_ID_MISSING');
  }
  // Both need the account's purchase history, which arrives with checkout.
  if (rules.firstPurchaseOnly || rules.minDaysSinceLastPurchase) {
    return no('NEEDS_PURCHASE_HISTORY');
  }

  if (
    !account.claim &&
    limits.maxAccounts !== undefined &&
    coupon.accountCount >= limits.maxAccounts
  ) {
    return no('ACCOUNT_LIMIT_REACHED');
  }
  const used = account.claim?.redemptions ?? 0;
  if (
    limits.maxRedemptionsPerAccount !== undefined &&
    used >= limits.maxRedemptionsPerAccount
  ) {
    return no('USES_EXHAUSTED');
  }
  if (
    limits.maxRedemptions !== undefined &&
    coupon.redemptionCount >= limits.maxRedemptions
  ) {
    return no('REDEMPTION_LIMIT_REACHED');
  }

  const ends = [limits.expiresAt && new Date(limits.expiresAt), kybWindowEnd]
    .filter((d): d is Date => !!d)
    .sort((a, b) => a.getTime() - b.getTime());
  return {
    eligible: true,
    usesLeft:
      limits.maxRedemptionsPerAccount !== undefined
        ? limits.maxRedemptionsPerAccount - used
        : null,
    expiresAt: ends[0] ?? null,
  };
}
