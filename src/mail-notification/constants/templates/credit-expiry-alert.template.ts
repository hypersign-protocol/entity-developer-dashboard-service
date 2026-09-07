import getBody from '../element/body.template';
import { getContainer } from '../element/container.template';
import getHtml from '../element/html.template';

type CustomerDetails = {
  companyName?: string;
  name?: string;
  email?: string;
};

export default function getCreditExpiryAlertMail(
  serviceId: string,
  remainingDays: number,
  totalCredits: number,
  usedCredits: number,
  expiresAt: string,
  isSuperAdminNotification = false,
  customerDetails?: CustomerDetails,
) {
  const isExpired = remainingDays === 0;

  const salutationMessage = isExpired
    ? '🚨 Credits Expired'
    : '⏳ Credit Expiry Reminder';

  const remainingCredits = Math.max(totalCredits - usedCredits, 0);

  const formattedExpiry = new Date(expiresAt).toLocaleDateString();
  const greeting = isSuperAdminNotification
    ? 'Dear Super Admin,'
    : 'Dear Admin,';

  const supportSection = !isSuperAdminNotification
    ? `
    <p style="font-family:Arial,Helvetica,sans-serif; font-size:15px; color:#374151; margin:24px 0 0; line-height:1.7;">
      If you have any questions or need assistance with renewing your credit plan,
      please feel free to contact our support team at
      <a href="mailto:Vikram@hypermine.in">Vikram@hypermine.in</a>.
    </p>
  `
    : '';
  const customerDetailsFields = customerDetails
    ? `
    ${
      customerDetails.companyName
        ? `<li style="margin:4px 0;"><strong>Company Name:</strong> ${customerDetails.companyName}</li>`
        : ''
    }
    ${
      customerDetails.name
        ? `<li style="margin:4px 0;"><strong>Name:</strong> ${customerDetails.name}</li>`
        : ''
    }
    ${
      customerDetails.email
        ? `<li style="margin:4px 0;"><strong>Email:</strong> ${customerDetails.email}</li>`
        : ''
    }`
    : '';
  const message = `
  <p style="font-family:Arial,Helvetica,sans-serif; font-size:15px; color:#374151; margin:0 0 16px; line-height:1.7;"> ${greeting}</p>

  <p style="font-family:Arial,Helvetica,sans-serif; font-size:15px; color:#374151; margin:0 0 16px; line-height:1.7;">
    ${
      isExpired
        ? 'The credits allocated to the following service have expired.'
        : 'The credits allocated to the following service are approaching their expiry date.'
    }
  </p>

  <ul style="font-family:Arial,Helvetica,sans-serif; font-size:15px; color:#374151; margin:0 0 16px; padding-left:18px;">
    <li style="margin:4px 0;"><strong>Service ID:</strong> ${serviceId}</li>
    <li style="margin:4px 0;"><strong>Used Credits:</strong> ${usedCredits} / ${totalCredits}</li>
    <li style="margin:4px 0;"><strong>Remaining Credits:</strong> ${remainingCredits}</li>
    <li style="margin:4px 0;"><strong>Expiry Date:</strong> ${formattedExpiry}</li>
    ${customerDetailsFields}
  </ul>

  ${
    isExpired
      ? `
    <p style="font-family:Arial,Helvetica,sans-serif; font-size:15px; color:#374151; margin:0 0 12px;">
      <span style="font-size:16px;">🚨</span>
      <strong>Credits Expired</strong>
    </p>

    <p style="font-family:Arial,Helvetica,sans-serif; font-size:15px; color:#374151; margin:0 0 16px;">
      Your credits have expired. Please renew or purchase a new credit plan to continue using the service without interruption.
    </p>
    `
      : `
    <p style="font-family:Arial,Helvetica,sans-serif; font-size:15px; color:#374151; margin:0 0 16px;">
      Your credits will expire in
      <strong>${remainingDays} day${remainingDays === 1 ? '' : 's'}</strong>.
      Please renew or purchase a new credit plan before the expiry date to avoid any interruption in service.
    </p>
    `
  }

  <p style="font-family:Arial,Helvetica,sans-serif; font-size:15px; color:#374151; margin:0 0 8px; font-weight:600;">
    Recommended Action:
  </p>

  <ul style="font-family:Arial,Helvetica,sans-serif; font-size:15px; color:#374151; margin:0 0 16px; padding-left:18px;">
    <li style="margin:4px 0;">Renew or purchase a new credit plan.</li>
    <li style="margin:4px 0;">Ensure sufficient credits are available before the expiry date.</li>
  </ul>
   ${supportSection}
`;

  const container = getContainer(message, salutationMessage);
  const body = getBody(container);
  return getHtml(body);
}
