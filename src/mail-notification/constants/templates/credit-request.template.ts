import getBody from '../element/body.template';
import { getContainer } from '../element/container.template';
import getHtml from '../element/html.template';

export default function getCreditRequestNotificationMail(
  userId,
  requesterEmail,
  requestedService,
  onboardingId,
  companyName,
  type,
  loggedInEmail,
  twitter,
  telegram,
) {
  const salutationMessage = 'New Credit Request Received';
  let optionalFields = '';
  let emailFields;

  if (twitter) {
    optionalFields += `<li><strong>Twitter:</strong> ${twitter}</li>`;
  }

  if (telegram) {
    optionalFields += `<li><strong>Telegram:</strong> ${telegram}</li>`;
  }
  if (loggedInEmail === requesterEmail) {
    emailFields = `<li><strong>Email:</strong> ${loggedInEmail}</li>`;
  } else {
    emailFields = `
      <li><strong>Login Email:</strong> ${loggedInEmail}</li>
      <li><strong>Company Email:</strong> ${requesterEmail}</li>
    `;
  }
  const message = `
    <p> Dear Super Admin, </p>
    <br>
    <p>
    A new creadit request has been submitted on the platform. Below are the details:
    </p>
    <br>
    <ul>
     <li><strong>UserId:</strong> ${userId}</li>
        ${emailFields}
     <li><strong>Requested Service:</strong> ${requestedService}</li>
     <li><strong>OnboardingId:</strong> ${onboardingId}</li>
     <li><strong>companyName:</strong> ${companyName}</li>
     <li><strong>accountType:</strong> ${type}</li>
     ${optionalFields}
    </ul>
    <br>
    <p>
    Please review the request and take the necessary action.
    </p>
    <br>
    `;
  const container = getContainer(message, salutationMessage);
  const body = getBody(container);
  const html = getHtml(body);
  return html;
}
