export interface OnboardingCreditAmounts {
  /** API_CREDIT needed by the CAVACH/KYC service. */
  kycCreditAmount: number;
  /** API_CREDIT needed by the SSI service, including credential and DID APIs. */
  ssiCreditAmount: number;
  /** BLOCKCHAIN_TXN_CREDIT needed by SSI, including DID registration. */
  ssiHidAllowanceAmount: number;
  validityPeriod: number;
}
