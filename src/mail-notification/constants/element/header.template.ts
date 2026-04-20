import { getContainer } from './container.template';

const LOGO_URL =
  'https://storage.googleapis.com/fyre-image-storage/download.png';

export function getHeader(_salutationMessage: string): string {
  return `<tr>
  <td class="header-td" align="center"
    style="background-color:#FFFFFF; padding:20px 40px; text-align:center; border-bottom:1px solid #E5E7EB;">
    <a href="https://hypersign.id" target="_blank"
       style="text-decoration:none; display:inline-block; line-height:1;">
      <img
        src="${LOGO_URL}"
        alt="Hypersign"
        width="150"
        style="display:block; border:0; max-width:150px; height:auto; width:150px;" />
    </a>
  </td>
</tr>`;
}

export function getSalutation(statusMessage = 'KYC Verified'): string {
  return `<tr>
  <td style="padding:32px 40px 0; background-color:#FFFFFF;
             font-family:Arial,Helvetica,sans-serif;">
    <h1 class="status-h1"
      style="font-size:22px; font-weight:700; color:#6B7280;
             margin:0 0 4px; line-height:1.3;">
      ${statusMessage}
    </h1>
  </td>
</tr>`;
}
