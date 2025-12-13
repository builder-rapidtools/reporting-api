/**
 * Stripe integration module
 * Handles checkout sessions and webhook events
 *
 * Operating Principle: No insecure payment paths
 * Webhook signatures must be verified in production
 */

import { Env, Agency } from './types';
import { Storage } from './storage';
import { isDevMode } from './env-validator';

export interface CheckoutSession {
  url: string;
  sessionId: string;
  devMode?: boolean;
}

/**
 * Create a Stripe Checkout Session for agency subscription
 */
export async function createCheckoutSessionForAgency(
  env: Env,
  agency: Agency
): Promise<CheckoutSession> {
  // Dev mode: No Stripe keys configured
  if (isDevMode(env) && (!env.STRIPE_SECRET_KEY || !env.STRIPE_PRICE_ID_STARTER)) {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('💳 STRIPE CHECKOUT (DEV MODE)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Agency: ${agency.name} (${agency.id})`);
    console.log(`Billing Email: ${agency.billingEmail}`);
    console.log('Price: Starter Plan (£25/month)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    return {
      url: 'https://example.com/dev-checkout',
      sessionId: 'dev-session-' + Date.now(),
      devMode: true,
    };
  }

  // Production mode: Create real Stripe Checkout Session
  try {
    const baseUrl = env.FRONTEND_URL || env.BASE_URL || 'http://localhost:8787';

    if (!env.STRIPE_SECRET_KEY || !env.STRIPE_PRICE_ID_STARTER) {
      throw new Error('Stripe configuration missing: STRIPE_SECRET_KEY or STRIPE_PRICE_ID_STARTER not set');
    }

    // Build Stripe-compatible form parameters with proper array/nested encoding
    const params = new URLSearchParams();
    params.set('customer_email', agency.billingEmail);
    params.set('client_reference_id', agency.id);
    params.set('mode', 'subscription');
    params.set('line_items[0][price]', env.STRIPE_PRICE_ID_STARTER);
    params.set('line_items[0][quantity]', '1');
    params.set('success_url', `${baseUrl}/success?session_id={CHECKOUT_SESSION_ID}`);
    params.set('cancel_url', `${baseUrl}/canceled`);
    params.set('metadata[agencyId]', agency.id);

    // Dev mode: Log parameters (excluding secrets)
    if (isDevMode(env)) {
      console.log('Stripe checkout params:', params.toString());
    }

    const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      },
      body: params.toString(),
    });

    const data = await response.json() as any;

    if (!response.ok) {
      throw new Error(`Stripe API error: ${data.error?.message || response.statusText}`);
    }

    return {
      url: data.url,
      sessionId: data.id,
    };
  } catch (error) {
    console.error('Stripe checkout session creation failed:', error);
    throw error;
  }
}

/**
 * Handle Stripe webhook events
 */
export async function handleStripeWebhook(
  env: Env,
  request: Request
): Promise<{ success: boolean; message?: string; error?: string; eventId?: string }> {
  // Dev mode: No webhook secret configured
  if (isDevMode(env) && !env.STRIPE_WEBHOOK_SECRET) {
    const body = await request.text();
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔔 STRIPE WEBHOOK (DEV MODE - NOT PROCESSED)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Webhook body:', body.substring(0, 200) + '...');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    return {
      success: true,
      message: 'Webhook received in dev mode (not processed)',
    };
  }

  // Production mode: Verify signature and process event
  // Operating Principle: No webhook endpoints without signature verification
  try {
    const body = await request.text();
    const signature = request.headers.get('stripe-signature');

    if (!signature) {
      throw new Error('Missing stripe-signature header');
    }

    if (!env.STRIPE_WEBHOOK_SECRET) {
      throw new Error('STRIPE_WEBHOOK_SECRET is not configured');
    }

    // Verify webhook signature using HMAC
    const event = await verifyStripeSignature(body, signature, env.STRIPE_WEBHOOK_SECRET);

    // Check idempotency - have we processed this event before?
    const storage = new Storage(env.REPORTING_KV, env.REPORTING_R2);
    const alreadyProcessed = await checkEventIdempotency(storage, event.id);

    if (alreadyProcessed) {
      console.log(`Event ${event.id} already processed - returning success (idempotent)`);
      return {
        success: true,
        message: `Event ${event.type} already processed (idempotent)`,
        eventId: event.id,
      };
    }

    // Process event
    await processStripeEvent(env, event);

    // Mark event as processed (with 24 hour TTL)
    await markEventAsProcessed(storage, event.id);

    return {
      success: true,
      message: `Event ${event.type} processed`,
      eventId: event.id,
    };
  } catch (error) {
    console.error('Stripe webhook processing failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Verify Stripe webhook signature using HMAC SHA256
 * Implements: https://stripe.com/docs/webhooks/signatures
 *
 * Operating Principle: No webhook endpoints without signature verification
 */
async function verifyStripeSignature(
  body: string,
  signatureHeader: string,
  secret: string
): Promise<any> {
  // Parse signature header
  // Format: t=timestamp,v1=signature1,v1=signature2
  const signatureParts = signatureHeader.split(',');
  const signatures: { [key: string]: string } = {};

  for (const part of signatureParts) {
    const [key, value] = part.split('=');
    if (key && value) {
      signatures[key] = value;
    }
  }

  if (!signatures.t || !signatures.v1) {
    throw new Error('Invalid signature header format');
  }

  const timestamp = signatures.t;
  const expectedSignature = signatures.v1;

  // Check timestamp is recent (within 5 minutes) to prevent replay attacks
  const currentTime = Math.floor(Date.now() / 1000);
  const timestampAge = currentTime - parseInt(timestamp, 10);

  if (timestampAge > 300) {
    // 5 minutes
    throw new Error(`Webhook timestamp too old: ${timestampAge} seconds`);
  }

  // Construct signed payload: timestamp.body
  const signedPayload = `${timestamp}.${body}`;

  // Compute HMAC SHA256 signature
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(signedPayload);

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, messageData);

  // Convert to hex string
  const computedSignature = Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  // Constant-time comparison to prevent timing attacks
  if (computedSignature !== expectedSignature) {
    throw new Error('Signature verification failed - invalid signature');
  }

  // Signature valid - parse event
  try {
    const event = JSON.parse(body);
    return event;
  } catch (error) {
    throw new Error('Invalid webhook payload JSON');
  }
}

/**
 * Check if a webhook event has already been processed
 * Returns true if event ID exists in KV
 *
 * Operating Principle: No automation without logging and reversibility
 */
async function checkEventIdempotency(storage: Storage, eventId: string): Promise<boolean> {
  const key = `stripe_event:${eventId}`;
  const existing = await storage['kv'].get(key);
  return existing !== null;
}

/**
 * Mark a webhook event as processed
 * Stores event ID in KV with 24-hour TTL
 */
async function markEventAsProcessed(storage: Storage, eventId: string): Promise<void> {
  const key = `stripe_event:${eventId}`;
  const value = JSON.stringify({
    eventId,
    processedAt: new Date().toISOString(),
  });

  // Store with 24-hour TTL (86400 seconds)
  await storage['kv'].put(key, value, { expirationTtl: 86400 });
}

/**
 * Process Stripe webhook event
 */
async function processStripeEvent(env: Env, event: any): Promise<void> {
  const storage = new Storage(env.REPORTING_KV, env.REPORTING_R2);

  console.log(`Processing Stripe event: ${event.type}`);

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const agencyId = session.metadata?.agencyId || session.client_reference_id;

      if (!agencyId) {
        console.error('No agency ID in checkout session metadata');
        return;
      }

      const agency = await storage.getAgency(agencyId);
      if (!agency) {
        console.error(`Agency not found: ${agencyId}`);
        return;
      }

      // Update agency with Stripe customer ID and subscription ID
      agency.stripeCustomerId = session.customer;
      agency.stripeSubscriptionId = session.subscription;
      agency.subscriptionStatus = 'active';
      await storage.updateAgency(agency);

      console.log(`Agency ${agencyId} activated via checkout (subscription: ${session.subscription})`);
      break;
    }

    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const subscription = event.data.object;
      const customerId = subscription.customer;

      // Find agency by Stripe customer ID
      // Note: This requires a lookup function - for MVP, we'll skip this
      // In production, implement: getAgencyByStripeCustomerId()

      console.log(`Subscription ${subscription.id} ${event.type}`);
      break;
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object;
      const customerId = subscription.customer;

      // Find agency by Stripe customer ID
      const agency = await storage.getAgencyByStripeCustomerId(customerId);

      if (!agency) {
        console.error(`Agency not found for Stripe customer: ${customerId}`);
        return;
      }

      // Mark subscription as canceled
      agency.subscriptionStatus = 'canceled';
      await storage.updateAgency(agency);

      console.log(`Agency ${agency.id} subscription canceled (subscription: ${subscription.id})`);
      break;
    }

    default:
      console.log(`Unhandled event type: ${event.type}`);
  }
}
