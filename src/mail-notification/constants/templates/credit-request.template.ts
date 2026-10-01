import getBody from '../element/body.template';
import { getContainer } from '../element/container.template';
import getHtml from '../element/html.template';

export default function getCreditRequestNotificationMail(customer: {
  customerId: string;
  customerName: string;
  customerEmail: string;
  onboardingId: string;
  companyName: string;
  companyDomain?: string;
  companyLogo?: string;
  billingAddress?: string;
  companyRegistrationNumber?: string;
  companyType: string;
  linkedinUrl?: string;
  twitterUrl?: string;
  telegramUrl?: string;
  country?: string;
  phoneNumber?: string;
  interestedService: string[];
  yearlyVolume: string;
  businessField: string[];
  loggedInEmail: string;
  referralSource?: string;
}) {
  const salutationMessage = 'New Credit Request Received';
  const referralSource = customer.referralSource?.trim() || '';
  const displayReferralSource = referralSource.replace(/^other\s*:\s*/i, '');

  const optionalFields = [
    ['Company Domain', customer.companyDomain],
    ['Company Logo', customer.companyLogo],
    ['Company Registration Number', customer.companyRegistrationNumber],
    ['Billing Address', customer.billingAddress],
    ['Phone Number', customer.phoneNumber],
    ['LinkedIn URL', customer.linkedinUrl],
    ['Twitter URL', customer.twitterUrl],
    ['Telegram URL', customer.telegramUrl],
    ['How did you hear about us?', displayReferralSource],
  ]
    .map(
      ([label, value]) =>
        `<li style="margin:4px 0;"><strong>${label}:</strong> ${value || ''}</li>`,
    )
    .join('');

  const emailFields =
    customer.loggedInEmail === customer.customerEmail
      ? `<li style="margin:4px 0;"><strong>Customer Email:</strong> ${customer.customerEmail}</li>`
      : `
      <li style="margin:4px 0;"><strong>Login Email:</strong> ${customer.loggedInEmail}</li>
      <li style="margin:4px 0;"><strong>Customer Email:</strong> ${customer.customerEmail}</li>
    `;

  const message = `
    <p style="font-family:Arial,Helvetica,sans-serif; font-size:15px; color:#374151; margin:0 0 16px;">
      Dear <strong style="color:#111827;">Super Admin</strong>,
    </p>

    <p style="font-family:Arial,Helvetica,sans-serif; font-size:15px; color:#374151; margin:0 0 16px;">
      A new credit request has been submitted on the platform. Below are the details:
    </p>

    <ul style="font-family:Arial,Helvetica,sans-serif; font-size:15px; color:#374151; margin:0 0 16px; padding-left:18px;">
      <li style="margin:4px 0;"><strong>Onboarding ID:</strong> ${customer.onboardingId}</li>
      <li style="margin:4px 0;"><strong>Customer ID:</strong> ${customer.customerId}</li>
      <li style="margin:4px 0;"><strong>Customer Name:</strong> ${customer.customerName}</li>
      ${emailFields}
      <li style="margin:4px 0;"><strong>Company Name:</strong> ${customer.companyName}</li>
      <li style="margin:4px 0;"><strong>Company Type:</strong> ${customer.companyType}</li>
      <li style="margin:4px 0;"><strong>Country:</strong> ${customer.country || ''}</li>
      ${optionalFields}
      <li style="margin:4px 0;"><strong>Interested Services:</strong> ${customer.interestedService.join(', ')}</li>
      <li style="margin:4px 0;"><strong>Yearly Volume:</strong> ${customer.yearlyVolume}</li>
      <li style="margin:4px 0;"><strong>Business Fields:</strong> ${customer.businessField.join(', ')}</li>
    </ul>

    <p style="font-family:Arial,Helvetica,sans-serif; font-size:15px; color:#374151; margin:0 0 16px;">
      Please review the request and take the necessary action.
    </p>
  `;

  const container = getContainer(message, salutationMessage);
  const body = getBody(container);
  return getHtml(body);
}
