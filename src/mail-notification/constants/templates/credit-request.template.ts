import getBody from '../element/body.template';
import { getContainer } from '../element/container.template';
import getHtml from '../element/html.template';

export default function getCreditRequestNotificationMail(
  userId,
  requesterEmail,
  requestedService,
  onboardingId,
) {
  const salutationMessage = 'New Credit Request Received';
  const message = `
    <p> Dear Super Admin, </p>
    <br>
    <p>
    A new creadit request has been submitted on the platform. Below are the details:
    </p>
    <br>
    <ul>
     <li><storng>UserId:</storng> ${userId}</li>
     <li><strong>Requester Email:</strong> ${requesterEmail}</li>
     <li><strong>Requested Service:</strong> ${requestedService}</li>
     <li><strong>OnboardingId:</strong> ${onboardingId}</li>
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
