export enum CustomerType {
  INDIVIDUAL = 'INDIVIDUAL',
  BUSINESS = 'BUSINESS',
}
export enum StepStatus {
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
}
export const CountryCode = [
  'IN',
  'SG',
  'CN',
  'JP',
  'HK',
  'ID',
  'VN',
  'TH',
  'MY',
  'PH',
  'KR',
  'AU',
  'NZ',
  'UK',
  'US',
  'BD',
  'PK',
  'LK',
  'NP',
  'KH',
  'MM',
  'BN',
  'LA',
  'MN',
  'TL',
  'XX',
];

export enum JobRole {
  FOUNDER = 'FOUNDER',
  CEO = 'CEO',
  EXECUTIVE = 'EXECUTIVE',
  PRODUCT_MANAGER = 'PRODUCT_MANAGER',
  DEVELOPER = 'DEVELOPER',
  COMPLIANCE_OFFICER = 'COMPLIANCE_OFFICER',
  OTHER = 'OTHER',
}
export enum CreditStatus {
  REQUESTED = 'REQUESTED', // Initial state when credit is requested
  PROCESSING = 'PROCESSING', // When credit provisioning has started
  APPROVED = 'APPROVED', // When credit has been successfully provided
  FAILED = 'FAILED', // When credit provisioning fails
}
