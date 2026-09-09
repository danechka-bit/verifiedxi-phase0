// Sends the magic-link login email via Resend. Falls back to
// isConfigured() === false when RESEND_API_KEY isn't set — the login route
// then shows the link directly on the page instead of emailing it, so login
// stays fully testable without an email account (see README).

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_ADDRESS = process.env.MAIL_FROM || 'VerifiedXI <onboarding@resend.dev>';

const resend = RESEND_API_KEY ? new (require('resend').Resend)(RESEND_API_KEY) : null;

function isConfigured() {
  return !!resend;
}

async function sendMagicLink(email, link) {
  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: [email],
    subject: 'Your VerifiedXI sign-in link',
    html: `
      <p>Click below to sign in to VerifiedXI. This link expires in 15 minutes and only works once.</p>
      <p><a href="${link}">${link}</a></p>
      <p>Didn't request this? You can ignore this email.</p>
    `
  });
  if (error) throw new Error(`Failed to send magic link: ${error.message || JSON.stringify(error)}`);
}

module.exports = { isConfigured, sendMagicLink };
