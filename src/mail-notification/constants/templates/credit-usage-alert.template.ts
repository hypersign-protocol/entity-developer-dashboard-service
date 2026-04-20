import getBody from '../element/body.template';
import { getContainer } from '../element/container.template';
import getHtml from '../element/html.template';

export default function getCreditUsageAlertMail(
  serviceId: string,
  usedPercentage: number,
  threshold: number,
  totalCredits: number,
  usedCredits: number,
  expiresAt?: string,
) {
  const isExhausted = usedPercentage >= 100;

  const salutationMessage = isExhausted
    ? '🚨 Credits Exhausted'
    : '⚠️ Credit Usage Alert';

  const remainingCredits = Math.max(totalCredits - usedCredits, 0);
  const safePercentage = Math.min(usedPercentage, 100);

  const formattedExpiry = expiresAt
    ? new Date(expiresAt).toLocaleDateString()
    : null;

  const expiryField = formattedExpiry
    ? `<li><strong>Expiry Date:</strong> ${formattedExpiry}</li>`
    : '';

  const message = `
  <p style="font-family:Arial,Helvetica,sans-serif; font-size:15px; color:#374151; margin:0 0 16px; line-height:1.7;">Dear Admin,</p>

  <p style="font-family:Arial,Helvetica,sans-serif; font-size:15px; color:#374151; margin:0 0 16px; line-height:1.7;">
    The following service has ${
      isExhausted
        ? 'fully utilized its allocated credits'
        : 'reached a critical credit usage threshold'
    }:
  </p>

  <ul style="font-family:Arial,Helvetica,sans-serif; font-size:15px; color:#374151; margin:0 0 16px; padding-left:18px;">
    <li style="margin:4px 0;"><strong>Service ID:</strong> ${serviceId}</li>
    <li style="margin:4px 0;"><strong>Used Credits:</strong> ${usedCredits} / ${totalCredits}</li>
    <li style="margin:4px 0;"><strong>Remaining Credits:</strong> ${remainingCredits}</li>
    <li style="margin:4px 0;"><strong>Usage Percentage:</strong> ${safePercentage}%</li>
    <li style="margin:4px 0;"><strong>Configured Alert Threshold:</strong> ${threshold}%</li>
    ${expiryField}
  </ul>

  ${
    isExhausted
      ? `
      <p style="font-family:Arial,Helvetica,sans-serif; font-size:15px; color:#374151; margin:0 0 12px;"><span style="font-size:16px;">🚨</span> <strong>Credits Exhausted</strong></p>
      <p style="font-family:Arial,Helvetica,sans-serif; font-size:15px; color:#374151; margin:0 0 16px;">
        Your credits have been fully consumed. Please recharge immediately to resume services without interruption.
      </p>
      `
      : `
      <p style="font-family:Arial,Helvetica,sans-serif; font-size:15px; color:#374151; margin:0 0 12px;"><span style="font-size:16px;">⚠️</span> <strong>Credit Limit Approaching</strong></p>
      <p style="font-family:Arial,Helvetica,sans-serif; font-size:15px; color:#374151; margin:0 0 16px;">
        Your service is nearing its credit limit. Please consider recharging to avoid any disruption.
      </p>
      `
  }

  <p style="font-family:Arial,Helvetica,sans-serif; font-size:15px; color:#374151; margin:0 0 8px; font-weight:600;">Action Required:</p>
  <ul style="font-family:Arial,Helvetica,sans-serif; font-size:15px; color:#374151; margin:0 0 16px; padding-left:18px;">
    <li style="margin:4px 0;">Recharge or top-up credits</li>
    <li style="margin:4px 0;">Ensure sufficient balance for uninterrupted service</li>
  </ul>

`;
  const container = getContainer(message, salutationMessage);
  const body = getBody(container);
  const html = getHtml(body);
  return html;
}
