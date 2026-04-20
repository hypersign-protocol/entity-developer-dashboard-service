import getBody from '../element/body.template';
import { getContainer } from '../element/container.template';
import getHtml from '../element/html.template';

export default function getOnboardingApprovedNotificationMail(
  userName: string | null | undefined,
) {
  const greetingName = userName || 'User';
  const salutationMessage = 'Onboarding Approved';
  const message = `
    <p style="font-family:Arial,Helvetica,sans-serif; font-size:15px; color:#374151; margin:0 0 16px; line-height:1.7;">Dear <strong style="color:#111827;">${greetingName}</strong>,</p>

    <p style="font-family:Arial,Helvetica,sans-serif; font-size:15px; color:#374151; margin:0 0 16px; line-height:1.7;">
      Congratulations! Your <strong>onboarding process has been successfully approved on the Hypersign Dashboard.</strong>
    </p>

    <p style="font-family:Arial,Helvetica,sans-serif; font-size:15px; color:#374151; margin:0 0 16px; line-height:1.7;">
      You can now proceed to access all features and services available.
    </p>

    <p style="margin:0 0 0;">
      <a href="https://entity.dashboard.hypersign.id/" target="_blank" style="display:inline-block; padding:9px 18px; background-color:#555555; color:#FFFFFF; text-decoration:none; border-radius:6px; font-family:Arial,Helvetica,sans-serif; font-size:13px; font-weight:600;">
        Login to the dashboard
      </a>
      &nbsp;&nbsp;
      <a href="https://docs.hypersign.id/hypersign-developer-dashboard/developer-dashboard" target="_blank" style="display:inline-block; padding:9px 18px; background-color:transparent; color:#555555; text-decoration:underline; border-radius:6px; font-family:Arial,Helvetica,sans-serif; font-size:13px; font-weight:600;">
        Read our documentation
      </a>
    </p>
  `;

  const container = getContainer(message, salutationMessage);
  const body = getBody(container);
  const html = getHtml(body);
  return html;
}
