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

//https://worldpopulationreview.com/country-rankings/phone-number-length-by-country
export const PhoneRegexMap: Record<string, RegExp> = {
  IN: /^[6-9]\d{9}$/, // India: 10 digits, starts with 6-9
  SG: /^[689]\d{7}$/, // Singapore: 8 digits, starts with 6, 8, or 9
  JP: /^\d{10,11}$/, // Japan: 10 or 11 digits
  CN: /^1[3-9]\d{9}$/, // China: 11 digits, starts with 13–19
  ID: /^(\+62|62|0)8[1-9][0-9]{6,9}$/, // Indonesia
  VN: /^(0|\+84)(3|5|7|8|9)[0-9]{8}$/, // Vietnam
  TH: /^0[689]\d{8}$/, // Thailand: 10 digits, starts with 06/08/09
  MY: /^01[0-46-9]-?[0-9]{7,8}$/, // Malaysia: 9–10 digits
  PH: /^(09|\+639)\d{9}$/, // Philippines: 11 digits
  KR: /^01[016789]\d{7,8}$/, // South Korea: 10–11 digits
  AU: /^(\+61|0)[2-478](\d{8})$/, // Australia: 9–10 digits
  NZ: /^(\+64|0)[2-9]\d{7,9}$/, // New Zealand: 8–10 digits
  BD: /^(?:\+?88)?01[3-9]\d{8}$/, // Bangladesh: 11 digits
  PK: /^03[0-9]{9}$/, // Pakistan: 11 digits, starts with 03
  LK: /^(?:\+94|0)?7\d{8}$/, // Sri Lanka: 10 digits
  NP: /^(?:\+977|0)?9[78]\d{8}$/, // Nepal: 10 digits
  KH: /^(?:\+855|0)?[1-9]\d{7,8}$/, // Cambodia: 8–9 digits
  MM: /^(?:\+95|0)?9\d{7,9}$/, // Myanmar: 8–10 digits
  BN: /^(\+673)?[2-8]\d{6}$/, // Brunei: 7 digits
  LA: /^(?:\+856|0)?(20)\d{8}$/, // Laos: 10 digits
  MN: /^(\+976|0)?[89]\d{7}$/, // Mongolia: 8 digits
  UK: /^(\+44|0)7\d{9}$/, // UK mobile: starts with 07, total 11 digits
  HK: /^(\+852)?[5,6,9]\d{7}$/, // Hong Kong: 8 digits, starts with 5,6,9
  US: /^(\+1)?\d{10}$/, // USA: 10 digits, optional +1};
};

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

export enum InterestedService {
  ID_VERIFICATION = 'ID Verification',
  AML_SCREEN = 'AML Screening',
  BIOMETRIC_VERIFCATION = 'Biometric Verification',
  PROOF_OF_ADDRESS = 'Proof Of Address',
}

export enum YearlyVolume {
  ZERO_ONEK = '0 - 1,000',
  ONEKONE_TWENTYK = '1,001 - 20,000',
  TWENTYKONE_FIFTYK = '20,000 - 50,000',
  PLUS_FIFTYK = '+50,000',
}

export enum BusinessField {
  FINTECH = 'Fintech',
  CRYPTO = 'Crypto',
  GAMBLING = 'Gambling',
  MARKETPLACES = 'Marketplaces',
  'ONLINE_TRAVEL' = 'Online travel',
  TELCO = 'Telco',
  HR_GIG_PLATFORM = 'HR/Gig Platform',
  E_COMM = 'E-commerce',
  EDTECH = 'Edtech',
  GAMING = 'Gaming',
  GOVENRNMENT = 'Government',
  HEALTHCARE = 'Healthcare',
}
