import getBody from '../element/body.template';
import { getContainer } from '../element/container.template';
import getHtml from '../element/html.template';

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[character];
  });

export default function getOnboardingRejectedNotificationMail(
  userName: string | null | undefined,
  rejectionReason?: string,
) {
  const safeName = escapeHtml(userName?.trim() || 'there');
  const reasonParagraph = rejectionReason?.trim()
    ? `<p style="font-family:Arial,Helvetica,sans-serif; font-size:15px; color:#374151; margin:0 0 16px; line-height:1.7;">Reason provided: <strong>${escapeHtml(
        rejectionReason.trim(),
      )}</strong></p>`
    : '';
  const message = `
    <p style="font-family:Arial,Helvetica,sans-serif; font-size:15px; color:#374151; margin:0 0 16px; line-height:1.7;">Dear <strong style="color:#111827;">${safeName}</strong>,</p>

    <p style="font-family:Arial,Helvetica,sans-serif; font-size:15px; color:#374151; margin:0 0 16px; line-height:1.7;">
      We’re sorry, but your business verification was rejected.
    </p>

    ${reasonParagraph}

    <p style="font-family:Arial,Helvetica,sans-serif; font-size:15px; color:#374151; margin:0 0 16px; line-height:1.7;">
      Your app has been moved from <strong>Production to Development</strong> while you resolve the business verification issue. Please review your company details and documents in the dashboard, make the necessary corrections, and resubmit your business verification.
    </p>

    <p style="margin:0;">
      <a href="https://entity.dashboard.hypersign.id/" target="_blank" style="display:inline-block; padding:9px 18px; background-color:#555555; color:#FFFFFF; text-decoration:none; border-radius:6px; font-family:Arial,Helvetica,sans-serif; font-size:13px; font-weight:600;">
        Open the dashboard
      </a>
    </p>
  `;

  const container = getContainer(message, 'Business Verification Update');
  return getHtml(getBody(container));
}
