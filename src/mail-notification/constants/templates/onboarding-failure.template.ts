import getBody from '../element/body.template';
import { getContainer } from '../element/container.template';
import getHtml from '../element/html.template';

const escapeHtml = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

export default function getOnboardingFailureNotificationMail(
  onboardingDetails: Record<string, unknown>,
  failedStep: string,
  failureReason: string,
) {
  // External request errors often include an operation prefix; the failed step
  // is already shown separately, so keep only the useful underlying reason.
  const cleanFailureReason = failureReason.replace(/^Failed to [^:]+:\s*/i, '');
  const detailItems = Object.entries(onboardingDetails)
    .filter(
      ([key, value]) =>
        !['__v', 'logs', 'createdAt', 'updatedAt', 'onboardingStatus'].includes(
          key,
        ) && value !== undefined,
    )
    .map(([key, value]) => {
      let displayValue: string;
      if (Array.isArray(value)) {
        displayValue = value.join(', ');
      } else if (value instanceof Date) {
        displayValue = value.toISOString();
      } else if (
        value &&
        typeof value === 'object' &&
        typeof (value as any).toString === 'function' &&
        (value as any).toString() !== '[object Object]'
      ) {
        displayValue = (value as any).toString();
      } else if (typeof value === 'object' && value !== null) {
        displayValue = JSON.stringify(value);
      } else {
        displayValue = String(value ?? '—');
      }
      return `<li style="margin:4px 0;"><strong>${escapeHtml(
        key,
      )}:</strong> ${escapeHtml(displayValue)}</li>`;
    })
    .join('');

  const content = `
    <p style="font-family:Arial,Helvetica,sans-serif; font-size:15px; color:#374151; margin:0 0 16px;">Dear <strong style="color:#111827;">Super Admin</strong>,</p>
    <p style="font-family:Arial,Helvetica,sans-serif; font-size:15px; color:#374151; margin:0 0 16px;">Customer onboarding has stopped after a failure. </p>
    <ul style="font-family:Arial,Helvetica,sans-serif; font-size:15px; color:#374151; margin:0 0 16px; padding-left:18px;">
      <li style="margin:4px 0;"><strong>Failed Step:</strong> ${escapeHtml(
        failedStep,
      )}</li>
      <li style="margin:4px 0;"><strong>Failure Reason:</strong> ${escapeHtml(
        cleanFailureReason,
      )}</li>
      ${detailItems}
    </ul>`;

  return getHtml(getBody(getContainer(content, 'Customer Onboarding Failed')));
}
