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
      Congratulations! Your <strong>onboarding process has been successfully approved on the Hypersign Dashboard.</strong>.
    </p>
    <br>
    <br>
    <p>
      You can now proceed to access all features and services available.
    </p>

    <br>
     <p>
    <a href="https://entity.dashboard.hypersign.id/" target="_blank" style="color:#4A90E2; text-decoration:none; font-weight:bold;">
      Login to the dashboard
    </a>
    &nbsp;/&nbsp;
    <a href="https://docs.hypersign.id/hypersign-developer-dashboard/developer-dashboard" target="_blank" style="color:#4A90E2; text-decoration:none; font-weight:bold;">
      Read our documentation
    </a>
  </p>
  `;

  const container = getContainer(message, salutationMessage);
  const body = getBody(container);
  const html = getHtml(body);
  return html;
}
