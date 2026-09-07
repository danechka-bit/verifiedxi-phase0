// Real guardian ID verification via Stripe Identity.
// Falls back to isConfigured() === false when STRIPE_SECRET_KEY isn't set, so the
// app still runs (with the old manual-admin-approval path) before you've set up Stripe.

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const APP_BASE_URL = process.env.APP_BASE_URL || 'http://localhost:3000';

const stripe = STRIPE_SECRET_KEY ? require('stripe')(STRIPE_SECRET_KEY) : null;

function isConfigured() {
  return !!stripe;
}

async function createVerificationSession(guardian) {
  return stripe.identity.verificationSessions.create({
    type: 'document',
    metadata: { guardian_id: String(guardian.id) },
    return_url: `${APP_BASE_URL}/guardian/${guardian.id}/verify/return`
  });
}

async function retrieveVerificationSession(sessionId) {
  return stripe.identity.verificationSessions.retrieve(sessionId);
}

// Maps a Stripe VerificationSession status to our guardian state machine.
// requires_input/processing stay 'submitted' (still pending, nothing to flip yet).
function mapStatus(stripeStatus) {
  if (stripeStatus === 'verified') return 'approved';
  if (stripeStatus === 'canceled') return 'rejected';
  return 'submitted';
}

function constructWebhookEvent(rawBody, signature) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET not set');
  return stripe.webhooks.constructEvent(rawBody, signature, secret);
}

module.exports = {
  isConfigured, createVerificationSession, retrieveVerificationSession,
  mapStatus, constructWebhookEvent
};
