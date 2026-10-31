import {
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  catalog as ssiCreditCatalog,
} from '@hypersign-protocol/credit-middleware-ssi';
import { OnboardingCreditAmounts } from '../dto/onboarding-credit-amounts.interface';
import { ONBOARDING_CONFIG, sumCatalogCreditCost } from 'src/utils/utils';

export function calculateDidOnboardingCreditAmounts(
  validityPeriod: number,
): Pick<OnboardingCreditAmounts, 'ssiCreditAmount' | 'ssiHidAllowanceAmount' | 'validityPeriod'> {
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
