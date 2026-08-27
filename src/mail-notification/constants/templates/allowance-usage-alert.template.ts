import getBody from '../element/body.template';
import { getContainer } from '../element/container.template';
import getHtml from '../element/html.template';

export default function getAllowanceUsageAlertMail(
  serviceId: string,
  usedPercentage: number,
  totalAllowance: number,
  usedAllowance: number,
  denom: string,
  expiresAt?: string,
) {
  const isExhausted = usedPercentage >= 100;
  const remainingAllowance = Math.max(totalAllowance - usedAllowance, 0);
  const formattedExpiry = expiresAt
    ? new Date(expiresAt).toLocaleDateString()
    : null;

  const message = `
  <p style="font-family:Arial,Helvetica,sans-serif; font-size:15px; color:#374151; margin:0 0 16px; line-height:1.7;">Dear Super Admin,</p>
  <p style="font-family:Arial,Helvetica,sans-serif; font-size:15px; color:#374151; margin:0 0 16px; line-height:1.7;">
    The following SSI service has ${
      isExhausted
        ? 'fully utilized its on-chain allowance'
        : 'reached a critical on-chain allowance usage threshold'
    }:
  </p>
  <ul style="font-family:Arial,Helvetica,sans-serif; font-size:15px; color:#374151; margin:0 0 16px; padding-left:18px;">
    <li style="margin:4px 0;"><strong>Service ID:</strong> ${serviceId}</li>
    <li style="margin:4px 0;"><strong>Used Allowance:</strong> ${usedAllowance} / ${totalAllowance} ${denom}</li>
    <li style="margin:4px 0;"><strong>Remaining Allowance:</strong> ${remainingAllowance} ${denom}</li>
    <li style="margin:4px 0;"><strong>Usage Percentage:</strong> ${Math.min(
      usedPercentage,
      100,
    )}%</li>
    ${
      formattedExpiry
        ? `<li style="margin:4px 0;"><strong>Expiry Date:</strong> ${formattedExpiry}</li>`
        : ''
    }
  </ul>
  <p style="font-family:Arial,Helvetica,sans-serif; font-size:15px; color:#374151; margin:0 0 16px; line-height:1.7;">
    ${
      isExhausted
        ? 'The allowance has been fully consumed. Please replenish it immediately to avoid service disruption.'
        : 'Please replenish the allowance before it is exhausted to avoid service disruption.'
    }
  </p>`;

  return getHtml(
    getBody(
      getContainer(
        message,
        isExhausted ? '🚨 Allowance Exhausted' : '⚠️ Allowance Usage Alert',
      ),
    ),
  );
}
