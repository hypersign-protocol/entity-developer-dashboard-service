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
    <p>Dear Super Admin,</p>
    <br>
    <p>
      The user has requested to <strong>re-initiate the onboarding process</strong> following a previous failure.
      Below are the relevant details:
    </p>
    <br>
    <ul>
      <li><strong>User ID:</strong> ${userId}</li>
      <li><strong>Requester Email:</strong> ${requesterEmail}</li>
      <li><strong>Onboarding ID:</strong> ${onboardingId}</li>
      <li><strong>Failed Step:</strong> ${failedStep}</li>
      <li><strong>Failure Reason:</strong> ${failureReason}</li>
    </ul>
    <br>
    <p>
      Please review the failure details and proceed with necessary action for re-onboarding.
    </p>
    <br>
    <p>Regards,</p>
    <p>The Onboarding System</p>
  `;

  const container = getContainer(message, salutationMessage);
  const body = getBody(container);
  const html = getHtml(body);
  return html;
}
