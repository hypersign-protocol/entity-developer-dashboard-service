import { footer } from './footer.template';
import { getHeader, getSalutation } from './header.template';
import { signature } from './signature.template';

export function getContainer(
    messageTemplate: string,
    salutationMessage = 'KYC Approved',
): string {
    return `<!-- Outer background -->
<table id="u_body" role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
    style="border-collapse:collapse; background-color:#F9FAFB; width:100%;">
    <tr>
        <td align="center" style="padding:36px 16px 48px;">

            <!-- Email card -->
            <table class="email-card" role="presentation" cellpadding="0" cellspacing="0" border="0"
                style="width:600px; max-width:100%; background-color:#FFFFFF;
                             border-radius:16px; overflow:hidden;
                             box-shadow:0 4px 40px rgba(0,0,0,0.10);">

                ${getHeader(salutationMessage)}
                ${getSalutation(salutationMessage)}

                <!-- Body content -->
                <tr>
                    <td class="content-td"
                        style="padding:36px 40px; font-family:Arial,Helvetica,sans-serif;
                                     font-size:15px; line-height:1.75; color:#374151;
                                     background-color:#FFFFFF;">
                        ${messageTemplate}
                    </td>
                </tr>

                ${signature}
                ${footer}

            </table>

            <!-- Below-card: social + tagline -->
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:20px auto 0;">
                <tr>
                    <td style="padding:0 8px;">
                        <a href="https://www.linkedin.com/company/hypersign-id/" target="_blank" rel="noopener"
                             style="text-decoration:none; display:inline-block;">
                            <img src="https://img.icons8.com/ios-filled/48/888888/linkedin.png"
                                     alt="LinkedIn" width="24" height="24"
                                     style="display:block; border:0;" />
                        </a>
                    </td>
                    <td style="padding:0 8px;">
                        <a href="https://x.com/hypersignchain" target="_blank" rel="noopener"
                             style="text-decoration:none; display:inline-block;">
                            <img src="https://img.icons8.com/ios-filled/48/888888/twitterx--v1.png"
                                     alt="X / Twitter" width="24" height="24"
                                     style="display:block; border:0;" />
                        </a>
                    </td>
                </tr>
            </table>
            <p style="font-family:Arial,Helvetica,sans-serif; font-size:12px; color:#6B7280;
                                text-align:center; margin:12px 0 0; line-height:1.8; max-width:400px;
                                margin-left:auto; margin-right:auto; font-weight:500; letter-spacing:0.1px;">
                Hypersign helps Web3 and fintech companies prevent fraud and reduce<br>
                KYC friction with reusable identity.
            </p>

        </td>
    </tr>
</table>`;
}
