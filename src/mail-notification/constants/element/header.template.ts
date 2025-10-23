export const header = `
 <div class="u-row-container" style="padding: 0px;background-color: white">
            <div class="u-row"
              style="Margin: 0 auto;min-width: 320px;max-width: 500px;overflow-wrap: break-word;word-wrap: break-word;word-break: break-word;background-color: white;">
              <div style="border-collapse: collapse;display: table;width: 100%;height: 100%;background-color: white;">
                <!--[if (mso)|(IE)]><table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding: 0px;background-color: white;" align="center"><table cellpadding="0" cellspacing="0" border="0" style="width:500px;"><tr style="background-color: white;"><![endif]-->

                <!--[if (mso)|(IE)]><td align="center" width="500" style="width: 500px;padding: 0px;border-top: 0px solid white;border-left: 0px solid white;border-right: 0px solid white;border-bottom: 0px solid white;" valign="top"><![endif]-->
                <div class="u-col u-col-100"
                  style="max-width: 320px;min-width: 500px;display: table-cell;vertical-align: top;">
                  <div style="height: 100%;width: 100% !important;">
                    <!--[if (!mso)&(!IE)]><!-->
                    <div
                      style="height: 100%; padding: 0px;border-top: 0px solid white;border-left: 0px solid white;border-right: 0px solid white;border-bottom: 0px solid white;">
                      <!--<![endif]-->

                      <table style="font-family:arial,helvetica,sans-serif;" role="presentation" cellpadding="0"
                        cellspacing="0" width="100%" border="0">
                        <tbody>
                          <tr>
                            <td class="v-container-padding-padding"
                              style="overflow-wrap:break-word;word-break:break-word;padding:10px;font-family:arial,helvetica,sans-serif; text-align: center"
                              align="left">
                            </td>
                          </tr>
                        </tbody>
                      </table>

                      <!--[if (!mso)&(!IE)]><!-->
                    </div><!--<![endif]-->
                  </div>
                </div>
                <!--[if (mso)|(IE)]></td><![endif]-->
                <!--[if (mso)|(IE)]></tr></table></td></tr></table><![endif]-->
              </div>
            </div>
          </div>
`;
export function getSalutation(statusMessage = 'KYC Verified'): string {
  return `
<div class="u-row-container" style="padding: 0px;background-color: white">
            <div class="u-row"
              style="Margin: 0 auto;min-width: 320px;max-width: 500px;overflow-wrap: break-word;word-wrap: break-word;word-break: break-word;background-color: white;">
              <div style="border-collapse: collapse;display: table;width: 100%;height: 100%;background-color: white;">
                <!--[if (mso)|(IE)]><table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding: 0px;background-color: white;" align="center"><table cellpadding="0" cellspacing="0" border="0" style="width:500px;"><tr style="background-color: white;"><![endif]-->

                <!--[if (mso)|(IE)]><td align="center" width="500" style="width: 500px;padding: 0px;border-top: 0px solid white;border-left: 0px solid white;border-right: 0px solid white;border-bottom: 0px solid white;border-radius: 0px;-webkit-border-radius: 0px; -moz-border-radius: 0px;" valign="top"><![endif]-->
                <div class="u-col u-col-100"
                  style="max-width: 320px;min-width: 500px;display: table-cell;vertical-align: top;">
                  <div
                    style="height: 100%;width: 100% !important;border-radius: 0px;-webkit-border-radius: 0px; -moz-border-radius: 0px;">
                    <!--[if (!mso)&(!IE)]><!-->
                    <div
                      style="height: 100%; padding: 0px;border-top: 0px solid white;border-left: 0px solid white;border-right: 0px solid white;border-bottom: 0px solid white;border-radius: 0px;-webkit-border-radius: 0px; -moz-border-radius: 0px;">
                      <!--<![endif]-->

                      <table style="font-family:arial,helvetica,sans-serif;" role="presentation" cellpadding="0"
                        cellspacing="0" width="100%" border="0">
                        <tbody>
                          <tr>
                            <td class="v-container-padding-padding"
                              style="overflow-wrap:break-word;word-break:break-word;padding:10px;font-family:arial,helvetica,sans-serif;"
                              align="left">

                              <div style="line-height: 140%; text-align: left; word-wrap: break-word;">
                                <h1>${statusMessage}</h1>
                                <p style="font-size: 14px; line-height: 140%;">Hey👋,</p>
                              </div>

                            </td>
                          </tr>
                        </tbody>
                      </table>

                      <!--[if (!mso)&(!IE)]><!-->
                    </div><!--<![endif]-->
                  </div>
                </div>
                <!--[if (mso)|(IE)]></td><![endif]-->
                <!--[if (mso)|(IE)]></tr></table></td></tr></table><![endif]-->
              </div>
            </div>
          </div>
`;
}
