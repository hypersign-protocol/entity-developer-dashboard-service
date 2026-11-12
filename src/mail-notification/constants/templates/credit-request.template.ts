import getBody from '../element/body.template';
import { getContainer } from '../element/container.template';
import getHtml from '../element/html.template';

const NOT_AVAILABLE = 'N/A';

function displayValue(value?: string | string[] | null): string {
  if (Array.isArray(value)) {
    const items = value.map((item) => item?.trim()).filter(Boolean);
    return items.length ? items.join(', ') : NOT_AVAILABLE;
  }
  return value?.trim() || NOT_AVAILABLE;
}

export default function getCreditRequestNotificationMail(customer: {
  customerId: string;
  customerName: string;
  customerEmail: string;
  onboardingId: string;
  companyName: string;
  companyDomain?: string;
  billingAddress?: string;
  linkedinUrl?: string;
  twitterUrl?: string;
  telegramUrl?: string;
  country?: string;
  phoneNumber?: string;
  interestedService?: string[];
  yearlyVolume?: string;
  businessField?: string[];
  loggedInEmail?: string;
  referralSource?: string;
}) {
  const salutationMessage = 'New Credit Request Received';
  const referralSource = (customer.referralSource || '')
    .trim()
    .replace(/^other\s*:\s*/i, '');

  const emailFields: Array<[string, string | undefined]> =
    !customer.loggedInEmail || customer.loggedInEmail === customer.customerEmail
      ? [['Customer Email', customer.customerEmail]]
      : [
          ['Login Email', customer.loggedInEmail],
          ['Customer Email', customer.customerEmail],
        ];

  const fields: Array<[string, string | string[] | undefined]> = [
    ['Onboarding ID', customer.onboardingId],
    ['Customer ID', customer.customerId],
    ['Customer Name', customer.customerName],
    ...emailFields,
    ['Company Name', customer.companyName],
    ['Country', customer.country],
    ['Company Domain', customer.companyDomain],
    ['Billing Address', customer.billingAddress],
    ['Phone Number', customer.phoneNumber],
    ['LinkedIn URL', customer.linkedinUrl],
    ['Twitter URL', customer.twitterUrl],
    ['Telegram URL', customer.telegramUrl],
    ['How did you hear about us?', referralSource],
    ['Interested Services', customer.interestedService],
    ['Monthly Volume', customer.yearlyVolume],
    ['Business Fields', customer.businessField],
  ];

  const fieldList = fields
    .map(
      ([label, value]) =>
        `<li style="margin:4px 0;"><strong>${label}:</strong> ${displayValue(
          value,
        )}</li>`,
    )
    .join('');

  const message = `
    <p style="font-family:Arial,Helvetica,sans-serif; font-size:15px; color:#374151; margin:0 0 16px;">
      Dear <strong style="color:#111827;">Super Admin</strong>,
    </p>

    <p style="font-family:Arial,Helvetica,sans-serif; font-size:15px; color:#374151; margin:0 0 16px;">
      A new credit request has been submitted on the platform. Below are the details:
    </p>

    <ul style="font-family:Arial,Helvetica,sans-serif; font-size:15px; color:#374151; margin:0 0 16px; padding-left:18px;">
      ${fieldList}
    </ul>

    <p style="font-family:Arial,Helvetica,sans-serif; font-size:15px; color:#374151; margin:0 0 16px;">
      Please review the request and take the necessary action.
    </p>
  `;

  const container = getContainer(message, salutationMessage);
  const body = getBody(container);
  return getHtml(body);
}
