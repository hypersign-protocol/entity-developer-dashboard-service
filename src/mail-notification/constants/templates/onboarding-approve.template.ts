import getBody from '../element/body.template';
import { getContainer } from '../element/container.template';
import getHtml from '../element/html.template';

export default function getOnboardingApprovedNotificationMail(
  userName: string | null | undefined,
) {
  const greetingName = userName || 'User';
  const salutationMessage = 'Onboarding Approved';
  const message = `
    <p>Dear ${greetingName},</p>
    <br>
    <p>
      Congratulations! Your <strong>onboarding process has been successfully approved</strong>.
    </p>
    <br>

    <ul>
      <li><strong>Status:</strong> Approved</li>
    </ul>

    <br>
    <p>
      You can now proceed to access all features and services available to approved users.
    </p>

    <br>
  `;

  const container = getContainer(message, salutationMessage);
  const body = getBody(container);
  const html = getHtml(body);
  return html;
}
