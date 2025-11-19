import { footer } from './footer.template';
import { getSalutation, header } from './header.template';
import { signature } from './signature.template';
export function getContainer(
  messageTemplate: string,
  salutationMessage = 'KYC Approved',
): string {
  return `
    <table id="u_body"
        style="border-collapse: collapse;table-layout: fixed;border-spacing: 0;mso-table-lspace: 0pt;mso-table-rspace: 0pt;vertical-align: top;min-width: 320px;Margin: 0 auto;background-color: #e7e7e7;width:100%"
        cellpadding="0" cellspacing="0">
        <tbody>
            <tr style="vertical-align: top">
                <td style="word-break: break-word;border-collapse: collapse !important;vertical-align: top">
                    ${header}
                    ${getSalutation(salutationMessage)}
                    
                    <div class="u-row-container" style="padding: 0px;background-color: white">
                        <div class="u-row" style="Margin: 0 auto;min-width: 320px;max-width: 500px;overflow-wrap: break-word;word-wrap: break-word;word-break: break-word;background-color: white;">
                            <div style="border-collapse: collapse;display: table;width: 100%;height: 100%;background-color: white;">
                                <div class="u-col u-col-100"
                                style="max-width: 320px;min-width: 500px;display: table-cell;vertical-align: top;">
                                    <div style="line-height: 140%; text-align: left; word-wrap: break-word;">
                                        <table style="font-family:arial,helvetica,sans-serif;" role="presentation" cellpadding="0" cellspacing="0" width="100%" border="0">
                                                <tbody>
                                                    <tr>
                                                        <td class="v-container-padding-padding" style="overflow-wrap:break-word;word-break:break-word;padding:10px;font-family:arial,helvetica,sans-serif;" align="left">
                                                            ${messageTemplate}                
                                                        </td>
                                                    </tr>
                                                </tbody>
                                        </table>    
                                    </div>                                
                               </div>
                            </div>
                        </div>
                    </div>
                    ${signature}
                </td>
            </tr>
            <tr>
                <td>
                    ${footer}
                </td>
            </tr>
        </tbody>
    </table>
    `;
}
