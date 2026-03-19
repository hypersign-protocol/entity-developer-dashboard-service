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
  <p>Dear Admin,</p>
  <br>

  <p>
    The following service has ${
      isExhausted
        ? 'fully utilized its allocated credits'
        : 'reached a critical credit usage threshold'
    }:
  </p>
  <br>

  <ul>
    <li><strong>Service ID:</strong> ${serviceId}</li>
    <li><strong>Used Credits:</strong> ${usedCredits} / ${totalCredits}</li>
    <li><strong>Remaining Credits:</strong> ${remainingCredits}</li>
    <li><strong>Usage Percentage:</strong> ${safePercentage}%</li>
    <li><strong>Configured Alert Threshold:</strong> ${threshold}%</li>
    ${expiryField}
  </ul>

  <br>

  ${
    isExhausted
      ? `
      <p>🚨 <strong>Credits Exhausted</strong></p>
      <p>
        Your credits have been fully consumed. Please recharge immediately to resume services without interruption.
      </p>
      `
      : `
      <p>⚠️ <strong>Credit Limit Approaching</strong></p>
      <p>
        Your service is nearing its credit limit. Please consider recharging to avoid any disruption.
      </p>
      `
  }

  <br>

  <p><strong>Action Required:</strong></p>
  <ul>
    <li>Recharge or top-up credits</li>
    <li>Ensure sufficient balance for uninterrupted service</li>
  </ul>

  <br>
`;
  const container = getContainer(message, salutationMessage);
  const body = getBody(container);
  const html = getHtml(body);
  return html;
}
