import {
  checkCouponEligibility,
  EligibilityAccount,
  EligibilityCoupon,
} from './coupon-eligibility';

const now = new Date('2026-11-01T00:00:00Z');
const daysAgo = (n: number) =>
  new Date(now.getTime() - n * 24 * 60 * 60 * 1000);

const founding8: EligibilityCoupon = {
  region: 'IN',
  status: 'ACTIVE',
  eligibility: {
    requiresKybApproved: true,
    requiresTaxId: ['GSTIN', 'PAN'],
    withinDaysOfKybApproval: 180,
  },
  limits: { maxAccounts: 500, maxRedemptionsPerAccount: 3 },
  accountCount: 10,
  redemptionCount: 12,
};

const account: EligibilityAccount = {
  orgId: 'org-1',
  region: 'IN',
  kybStatus: 'Approved',
  kybApprovedAt: daysAgo(30),
  taxIdTypes: ['GSTIN'],
};

const reasonOf = (coupon: EligibilityCoupon, acc: EligibilityAccount) => {
  const result = checkCouponEligibility(coupon, acc, now);
  return 'reason' in result ? result.reason : 'ELIGIBLE';
};

describe('checkCouponEligibility', () => {
  it('accepts an approved Indian account with a GSTIN, with uses left and the KYB window end', () => {
    expect(checkCouponEligibility(founding8, account, now)).toEqual({
      eligible: true,
      usesLeft: 3,
      expiresAt: new Date(daysAgo(30).getTime() + 180 * 24 * 60 * 60 * 1000),
    });
  });

  it.each([
    ['NOT_ACTIVE', { ...founding8, status: 'PAUSED' }, account],
    ['WRONG_REGION', founding8, { ...account, region: 'GLOBAL' }],
    ['KYB_NOT_APPROVED', founding8, { ...account, kybStatus: 'Completed' }],
    ['KYB_NOT_APPROVED', founding8, { ...account, kybApprovedAt: undefined }],
    [
      'KYB_WINDOW_PASSED',
      founding8,
      { ...account, kybApprovedAt: daysAgo(180) },
    ],
    ['TAX_ID_MISSING', founding8, { ...account, taxIdTypes: [] }],
    ['ACCOUNT_LIMIT_REACHED', { ...founding8, accountCount: 500 }, account],
    ['USES_EXHAUSTED', founding8, { ...account, claim: { redemptions: 3 } }],
    [
      'EXPIRED',
      { ...founding8, limits: { ...founding8.limits, expiresAt: now } },
      account,
    ],
    [
      'NOT_STARTED',
      { ...founding8, limits: { ...founding8.limits, startsAt: daysAgo(-1) } },
      account,
    ],
    [
      'NEEDS_PURCHASE_HISTORY',
      { ...founding8, eligibility: { firstPurchaseOnly: true } },
      account,
    ],
    [
      'NOT_ALLOWED',
      { ...founding8, eligibility: { allowedOrgIds: ['org-2'] } },
      account,
    ],
    [
      'REDEMPTION_LIMIT_REACHED',
      { ...founding8, limits: { maxRedemptions: 12 } },
      account,
    ],
  ])('%s', (reason, coupon, acc) => {
    expect(
      reasonOf(coupon as EligibilityCoupon, acc as EligibilityAccount),
    ).toBe(reason);
  });

  it('lets an account that already holds a claim through when the 500 slots are full', () => {
    const full = { ...founding8, accountCount: 500 };
    expect(reasonOf(full, { ...account, claim: { redemptions: 1 } })).toBe(
      'ELIGIBLE',
    );
  });

  it('reports the earlier of the coupon expiry and the KYB window', () => {
    const expiresAt = daysAgo(-10);
    const result = checkCouponEligibility(
      { ...founding8, limits: { ...founding8.limits, expiresAt } },
      account,
      now,
    );
    expect(result).toMatchObject({ eligible: true, expiresAt, usesLeft: 3 });
  });
});
