import { CreditType } from '@hypersign-protocol/credit-middleware';
import { SERVICE_TYPES } from 'src/supported-service/services/iServiceList';

export const SSI_CREDIT_TYPES = [
  CreditType.API_CREDIT,
  CreditType.BLOCKCHAIN_TXN_CREDIT,
] as const;

export type SsiCreditType = (typeof SSI_CREDIT_TYPES)[number];

export function sdkPlanId(
  dashboardPlanId: string,
  serviceType: SERVICE_TYPES,
  creditType: string,
): string {
  return serviceType === SERVICE_TYPES.SSI_API
    ? `${dashboardPlanId}.${creditType}`
    : dashboardPlanId;
}

export function sdkReferenceId(
  dashboardReferenceId: string,
  serviceType: SERVICE_TYPES,
  creditType: string,
): string {
  return serviceType === SERVICE_TYPES.SSI_API
    ? `${dashboardReferenceId}.${creditType}`
    : dashboardReferenceId;
}

export function dashboardPlanId(
  middlewarePlanId: string,
  serviceType: SERVICE_TYPES,
  creditType?: string,
): string {
  if (serviceType !== SERVICE_TYPES.SSI_API) return middlewarePlanId;
  const resolvedCreditType = creditType
    ? creditType
    : SSI_CREDIT_TYPES.find((type) => middlewarePlanId.endsWith(`.${type}`));
  if (
    !resolvedCreditType ||
    !SSI_CREDIT_TYPES.includes(resolvedCreditType as SsiCreditType)
  ) {
    throw new Error(`Unsupported SSI credit type: ${String(creditType)}`);
  }
  const suffix = `.${resolvedCreditType}`;
  if (!middlewarePlanId.endsWith(suffix)) {
    throw new Error(
      `SSI middleware plan ${middlewarePlanId} does not match ${resolvedCreditType}`,
    );
  }
  return middlewarePlanId.slice(0, -suffix.length);
}
