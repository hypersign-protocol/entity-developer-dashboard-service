import getBody from '../element/body.template';
import { getContainer } from '../element/container.template';
import getHtml from '../element/html.template';

export default function getCreditRequestNotificationMail(
  userId: string,
  requesterEmail: string,
  requestedService: string,
  onboardingId: string,
  companyName: string,
  type: string,
  loggedInEmail: string,
  twitter?: string,
  telegram?: string,
) {
  const salutationMessage = 'New Credit Request Received';

  let optionalFields = '';
  if (twitter) {
    optionalFields += `<li style="margin:4px 0;"><strong>Twitter:</strong> ${twitter}</li>`;
  }
  if (telegram) {
    optionalFields += `<li style="margin:4px 0;"><strong>Telegram:</strong> ${telegram}</li>`;
  }

  const emailFields =
    loggedInEmail === requesterEmail
      ? `<li style="margin:4px 0;"><strong>Email:</strong> ${loggedInEmail}</li>`
      : `
      <li style="margin:4px 0;"><strong>Login Email:</strong> ${loggedInEmail}</li>
      <li style="margin:4px 0;"><strong>Company Email:</strong> ${requesterEmail}</li>
    `;

  const message = `
    <p style="font-family:Arial,Helvetica,sans-serif; font-size:15px; color:#374151; margin:0 0 16px;">
      Dear <strong style="color:#111827;">Super Admin</strong>,
    </p>

    <p style="font-family:Arial,Helvetica,sans-serif; font-size:15px; color:#374151; margin:0 0 16px;">
      A new credit request has been submitted on the platform. Below are the details:
    </p>

    <ul style="font-family:Arial,Helvetica,sans-serif; font-size:15px; color:#374151; margin:0 0 16px; padding-left:18px;">
      <li style="margin:4px 0;"><strong>Onboarding ID:</strong> ${onboardingId}</li>
      <li style="margin:4px 0;"><strong>User ID:</strong> ${userId}</li>
      ${emailFields}
      <li style="margin:4px 0;"><strong>Requested Service:</strong> ${requestedService}</li>
      <li style="margin:4px 0;"><strong>Company Name:</strong> ${companyName}</li>
      <li style="margin:4px 0;"><strong>Account Type:</strong> ${type}</li>
      ${optionalFields}
    </ul>

    <p style="font-family:Arial,Helvetica,sans-serif; font-size:15px; color:#374151; margin:0 0 16px;">
      Please review the request and take the necessary action.
    </p>
  `;

  const container = getContainer(message, salutationMessage);
  const body = getBody(container);
  const html = getHtml(body);
  return html;
}
