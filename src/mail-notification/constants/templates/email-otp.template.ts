import getBody from '../element/body.template';
import { getContainer } from '../element/container.template';
import getHtml from '../element/html.template';

export default function getEmailOtpMail(
  otp: string,
  validityMinutes = 5,
  salutationMessage = 'Your One-Time Password (OTP) for Login',
) {
  const message = `
    <p>Dear User,</p>
    <br>
    <p>
      Use the following One-Time Password (OTP) to verify your email address or complete the login process:
    </p>
    <br>
    <h2 style="text-align:center; font-size:24px; color:#2c3e50;">${otp}</h2>
    <br>
    <p>
      This OTP is valid for <strong>${validityMinutes} minutes</strong>.
      Please do not share it with anyone for security reasons.
    </p>
    <br>
    <p>
      If you did not request this, please ignore this email.
    </p>
  `;

  const container = getContainer(message, salutationMessage);
  const body = getBody(container);
  const html = getHtml(body);

  return html;
}
