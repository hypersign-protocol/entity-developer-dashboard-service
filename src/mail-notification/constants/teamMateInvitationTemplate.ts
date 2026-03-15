import getBody from './element/body.template';
import { getContainer } from './element/container.template';
import getHtml from './element/html.template';

const message = `
    <p>Hi <strong>@@InviteeName@@</strong>,</p>

    <p><strong>@@SenderEmailId@@</strong> has invited you to join their workspace on the <strong>Hypersign
            Dashboard</strong>.</p>

    <p>The Hypersign Dashboard lets you manage all your digital identity needs from one powerful, interactive
        dashboard.</p>

    <p>Click below to accept the invitation from your teammate and start collaboration:</p>

    <a class="btn" href="@@InviteLink@@" target="_blank">👉 Accept Invitation</a>

    <p style="margin-top: 30px;">If you weren’t expecting this invitation, you can safely ignore this email.</p>

    <p style="margin-top: 30px;">Looking forward to having you onboard!</p> 
`;

const salutationMessage = 'You’re Invited to Join the Hypersign Dashboard!';
const container = getContainer(message, salutationMessage);
const body = getBody(container);
const html = getHtml(body);
export default html;
