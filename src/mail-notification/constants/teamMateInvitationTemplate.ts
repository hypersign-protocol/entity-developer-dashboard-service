const TeammateTemplate = `

<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Invitation Reminder</title>
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
            line-height: 1.5;
        }

        .btn {
            display: inline-block;
            background-color: #2da44e;
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
            text-align: center;
        }
    </style>
</head>

<body>
    <div class="container">
        <h2>📄 Reminder: Invitation to collaborate</h2>
        <p>
            <strong>@@SenderEmailId@@</strong> has invited you to collaborate on the
            <strong>Entity Developer Dashboard</strong>.
        </p>

        <p>You can accept or decline this invitation:</p>

        <a class="btn" href="@@InviteLink@@" target="_blank">View Invitation</a>

        <p style="margin-top: 20px">
            This invitation will expire in <strong>2 days</strong>.
        </p>

        <div class="footer">
            <p>If you weren’t expecting this invitation, you can ignore this email.</p>
            <p>— The <strong>Entity Developer Dashboard</strong> Team</p>
        </div>
    </div>
</body>

</html>
`;
export default TeammateTemplate;
