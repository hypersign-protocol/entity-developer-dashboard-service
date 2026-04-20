export const style = `
<style type="text/css">
  /* ── Reset ─────────────────────────────────────── */
  * { box-sizing: border-box; line-height: inherit; }
  body  { margin: 0; padding: 0; -webkit-text-size-adjust: 100%; background-color: #F9FAFB; }
  table, tr, td { vertical-align: top; border-collapse: collapse; }
  p   { margin: 0; }
  img { border: 0; -ms-interpolation-mode: bicubic; }
  a[x-apple-data-detectors='true'] { color: inherit !important; text-decoration: none !important; }
  .ie-container table, .mso-container table { table-layout: fixed; }

  /* ── Responsive ─────────────────────────────────── */
  @media only screen and (max-width: 640px) {
    .email-card  { width: 100% !important; min-width: 320px !important; }
    .content-td  { padding: 24px 20px !important; }
    .header-td   { padding: 22px 20px !important; }
    .banner-td   { padding: 22px 20px !important; }
    .sig-td      { padding: 20px 20px !important; }
    .footer-td   { padding: 24px 20px !important; }
    .status-h1   { font-size: 18px !important; }
  }

  /* ── Utility ─────────────────────────────────────── */
  .errorMessage {
    display: block;
    padding: 12px 16px;
    background-color: #FFF5F5;
    border-left: 4px solid #E07070;
    border-radius: 4px;
    font-style: italic;
    color: #A04040;
    margin: 16px 0;
    font-size: 14px;
    line-height: 1.6;
  }

  table, td { color: #374151; }
</style>
`;
