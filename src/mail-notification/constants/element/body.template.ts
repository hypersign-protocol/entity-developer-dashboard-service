export default function getBody(container): string {
    return `<body class="clean-body u_body"
    style="margin:0; padding:0; -webkit-text-size-adjust:100%; background-color:#F9FAFB; color:#374151;">
    <!--[if IE]><div class="ie-container"><![endif]-->
    <!--[if mso]><div class="mso-container"><![endif]-->
    ${container}
    <!--[if IE]></div><![endif]-->
    <!--[if mso]></div><![endif]-->
</body>`;
}
