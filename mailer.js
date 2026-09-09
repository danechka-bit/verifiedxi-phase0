// Sends the magic-link login email. Falls back to isConfigured() === false
// when no provider is wired up — the login route then shows the link
// directly on the page instead of emailing it, so login is still fully
// testable without an email account. Swap sendMagicLink's body for a real
// provider (Resend, Postmark, SES...) later; nothing else needs to change.

function isConfigured() {
  return false;
}

async function sendMagicLink(email, link) {
  throw new Error('mailer not configured — isConfigured() should have been checked first');
}

module.exports = { isConfigured, sendMagicLink };
