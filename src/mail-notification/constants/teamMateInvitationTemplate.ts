const TeammateTemplate = `

<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>You're Invited</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
                Helvetica, Arial, sans-serif;
            background-color: #f6f8fa;
            margin: 0;
            padding: 20px;
        }

        .container {
            max-width: 600px;
            margin: auto;
            background-color: #ffffff;
            border: 1px solid #d0d7de;
            border-radius: 6px;
            padding: 30px;
        }

        h2 {
            color: #24292f;
            margin-bottom: 20px;
        }

        p {
            font-size: 15px;
            color: #24292f;
            line-height: 1.6;
        }

        .btn {
            display: inline-block;
            background-color: #4b4b4b;
            color: #ffffff !important;
            text-decoration: none;
            padding: 12px 24px;
            font-weight: 600;
            border-radius: 6px;
            margin-top: 20px;
        }

        .footer {
            font-size: 12px;
            color: #6e7781;
            margin-top: 30px;
            text-align: left;
        }

        /* .footer p:first-child {
            margin-left: 0;
        }

        .footer p:last-child {
            margin-left: 0px;
        } */
    </style>
</head>

<body>
    <div class="container">
        <p>Hi <strong>@@InviteeName@@</strong>,</p>

        <p><strong>@@SenderEmailId@@</strong> has invited you to join their workspace on the <strong>Entity Studio
                Dashboard</strong>.</p>

        <p>The Entity Studio Dashboard lets you manage all your digital identity needs from one powerful, interactive
            dashboard.</p>

        <p>Click below to accept the invitation from your teammate and start collaboration:</p>

        <a class="btn" href="@@InviteLink@@" target="_blank">👉 Accept Invitation</a>

        <p style="margin-top: 30px;">If you weren’t expecting this invitation, you can safely ignore this email.</p>

        <p style="margin-top: 30px;">Looking forward to having you onboard!</p>

        <!-- <div class="footer">
            <p style="margin-left: 0;">—</p>
            <p style="margin-left: 20px;">The <strong>Entity Studio</strong> Team</p> -->
        <div class="footer">
            <p>—</p>
            <p> The Entity Studio Team</p>
        </div>
    </div>
    </div>
</body>

</html>

`;
export default TeammateTemplate;
