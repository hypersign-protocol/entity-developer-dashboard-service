import {
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { catalog as kycCreditCatalog } from '@hypersign-protocol/credit-middleware';
import { catalog as ssiCreditCatalog } from '@hypersign-protocol/credit-middleware-ssi';
import { InterestedService } from 'src/customer-onboarding/constants/enum';
import { OnboardingCreditAmounts } from 'src/customer-onboarding/dto/onboarding-credit-amounts.interface';
import { ONBOARDING_CONFIG, sumCatalogCreditCost } from 'src/utils/utils';

export function calculateDidOnboardingCreditAmounts(
  validityPeriod: number,
): Pick<
  OnboardingCreditAmounts,
  'ssiCreditAmount' | 'ssiHidAllowanceAmount' | 'validityPeriod'
> {
  if (!Number.isSafeInteger(validityPeriod) || validityPeriod < 1) {
    throw new BadRequestException([
      'validityPeriod must be a positive integer',
    ]);
  }

  const ssiCreditAmount = sumCatalogCreditCost(
    ssiCreditCatalog,
    'POST',
    ONBOARDING_CONFIG.SSI_DID_ROUTES,
    'API_CREDIT',
  );
  const ssiHidAllowanceAmount = sumCatalogCreditCost(
    ssiCreditCatalog,
    'POST',
    ONBOARDING_CONFIG.SSI_DID_ROUTES,
    'BLOCKCHAIN_TXN_CREDIT',
  );
  if (
    !Number.isSafeInteger(ssiCreditAmount) ||
    !Number.isSafeInteger(ssiHidAllowanceAmount)
  ) {
    throw new InternalServerErrorException(
      'Calculated DID credit requirements exceed the maximum safe integer',
    );
  }

  return { ssiCreditAmount, ssiHidAllowanceAmount, validityPeriod };
}

export function calculateFreeCreditAmounts(
  numberOfVerifications: number,
  interestedServices: InterestedService[],
  validityPeriod: number,
): OnboardingCreditAmounts {
  if (
    !Number.isSafeInteger(numberOfVerifications) ||
    numberOfVerifications < 1
  ) {
    throw new BadRequestException([
      'numberOfVerifications must be a positive integer',
    ]);
  }
  if (!Number.isSafeInteger(validityPeriod) || validityPeriod < 1) {
    throw new BadRequestException([
      'validityPeriod must be a positive integer',
    ]);
  }

  const isAadhaar =
    interestedServices?.includes(InterestedService.AADHAR_VERIFICATION) ??
    false;
  const verificationRoutes = isAadhaar
    ? ONBOARDING_CONFIG.AADHAAR_VERIFICATION_ROUTES
    : ONBOARDING_CONFIG.KYC_VERIFICATION_ROUTES;

  const kycCostPerVerification = sumCatalogCreditCost(
    kycCreditCatalog,
    'POST',
    verificationRoutes,
    'API_CREDIT',
  );
  const credentialIssueApiCost = sumCatalogCreditCost(
    ssiCreditCatalog,
    'POST',
    ONBOARDING_CONFIG.SSI_CREDENTIAL_ISSUE_ROUTES,
    'API_CREDIT',
  );
  const credentialIssueHidCost = sumCatalogCreditCost(
    ssiCreditCatalog,
    'POST',
    ONBOARDING_CONFIG.SSI_CREDENTIAL_ISSUE_ROUTES,
    'BLOCKCHAIN_TXN_CREDIT',
  );
  const didApiCost = sumCatalogCreditCost(
    ssiCreditCatalog,
    'POST',
    ONBOARDING_CONFIG.SSI_DID_ROUTES,
    'API_CREDIT',
  );
  const didHidCost = sumCatalogCreditCost(
    ssiCreditCatalog,
    'POST',
    ONBOARDING_CONFIG.SSI_DID_ROUTES,
    'BLOCKCHAIN_TXN_CREDIT',
  );

  const credentialIssueCount =
    numberOfVerifications * verificationRoutes.length;
  const ssiCreditAmount =
    credentialIssueCount * credentialIssueApiCost + didApiCost;
  const ssiHidAllowanceAmount =
    credentialIssueCount * credentialIssueHidCost + didHidCost;
  const kycCreditAmount = kycCostPerVerification * numberOfVerifications;

  if (
    !Number.isSafeInteger(credentialIssueCount) ||
    !Number.isSafeInteger(kycCreditAmount) ||
    !Number.isSafeInteger(ssiCreditAmount) ||
    !Number.isSafeInteger(ssiHidAllowanceAmount)
  ) {
    throw new InternalServerErrorException(
      'Calculated free-credit requirements exceed the maximum safe integer',
    );
  }

  return {
    kycCreditAmount,
    ssiCreditAmount,
    ssiHidAllowanceAmount,
    validityPeriod,
  };
}
