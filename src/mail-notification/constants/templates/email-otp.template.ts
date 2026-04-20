import getBody from '../element/body.template';
import { getContainer } from '../element/container.template';
import getHtml from '../element/html.template';

export default function getEmailOtpMail(
  otp: string,
  validityMinutes = 5,
  salutationMessage = 'Your One-Time Password (OTP)',
) {
  const message = `
    <p style="font-family:Arial,Helvetica,sans-serif; font-size:15px; color:#374151; margin:0 0 16px; line-height:1.7;">Dear User,</p>

    <p style="font-family:Arial,Helvetica,sans-serif; font-size:15px; color:#374151; margin:0 0 16px; line-height:1.7;">
      Use the following One-Time Password (OTP) to verify your email address and complete the login process:
    </p>

    <h2 style="text-align:center; font-size:28px; color:#111827; margin:8px 0 18px; font-family:Arial,Helvetica,sans-serif;">${otp}</h2>

    <p style="font-family:Arial,Helvetica,sans-serif; font-size:15px; color:#374151; margin:0 0 16px; line-height:1.7;">
      This OTP is valid for <strong>${validityMinutes} minutes</strong>. Please do not share it with anyone for security reasons.
    </p>

    <p style="font-family:Arial,Helvetica,sans-serif; font-size:15px; color:#374151; margin:0 0 16px; line-height:1.7;">
      If you did not request this, please ignore this email.
    </p>
  `;

  const container = getContainer(message, salutationMessage);
  const body = getBody(container);
  const html = getHtml(body);

  return html;
}
