import getBody from '../element/body.template';
import { getContainer } from '../element/container.template';
import getHtml from '../element/html.template';

export default function getOnboardingRetryNotificationMail(
  userId: string,
  requesterEmail: string,
  failedStep: string,
  failureReason: string,
  onboardingId: string,
) {
  const salutationMessage = 'Re-Onboarding Request Received';
  const message = `
    <p style="font-family:Arial,Helvetica,sans-serif; font-size:15px; color:#374151; margin:0 0 16px;">Dear <strong style="color:#111827;">Super Admin</strong>,</p>

    <p style="font-family:Arial,Helvetica,sans-serif; font-size:15px; color:#374151; margin:0 0 16px;">
      The user has requested to <strong>re-initiate the onboarding process</strong> following a previous failure. Below are the relevant details:
    </p>

    <ul style="font-family:Arial,Helvetica,sans-serif; font-size:15px; color:#374151; margin:0 0 16px; padding-left:18px;">
      <li style="margin:4px 0;"><strong>User ID:</strong> ${userId}</li>
      <li style="margin:4px 0;"><strong>Requester Email:</strong> ${requesterEmail}</li>
      <li style="margin:4px 0;"><strong>Onboarding ID:</strong> ${onboardingId}</li>
      <li style="margin:4px 0;"><strong>Failed Step:</strong> ${failedStep}</li>
      <li style="margin:4px 0;"><strong>Failure Reason:</strong> ${failureReason}</li>
    </ul>

    <p style="font-family:Arial,Helvetica,sans-serif; font-size:15px; color:#374151; margin:0 0 16px;">
      Please review the failure details and proceed with necessary action for re-onboarding.
    </p>
    `;

  const container = getContainer(message, salutationMessage);
  const body = getBody(container);
  const html = getHtml(body);
  return html;
}
