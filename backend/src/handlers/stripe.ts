/**
 * Stripe-related endpoint handlers
 */

import { Context } from 'hono';
import { Env, CreateCheckoutSessionResponse } from '../types';
import { requireAgencyAuth, AuthError } from '../auth';
import { createCheckoutSessionForAgency, handleStripeWebhook } from '../stripe';
import { ok, fail } from '../response-helpers';

/**
 * POST /api/agency/checkout
 * Create Stripe Checkout Session for agency
 */
export async function handleCreateCheckoutSession(c: Context): Promise<Response> {
  const env = c.env as Env;
  try {
    // Require authentication
    const { agency } = await requireAgencyAuth(c.req.raw, env);

    // Create checkout session
    const session = await createCheckoutSessionForAgency(env, agency);

    const responseData: any = {
      checkoutUrl: session.url,
      sessionId: session.sessionId,
    };

    if (session.devMode) {
      responseData.devMode = true;
    }

    return ok(c, responseData);
  } catch (error) {
    if (error instanceof AuthError) {
      return c.json(error.toJSON(), error.statusCode);
    }

    return fail(
      c,
      'INTERNAL_ERROR',
      error instanceof Error ? error.message : 'Unknown error',
      500
    );
  }
}

/**
 * POST /api/agency/stripe/webhook
 * Handle Stripe webhook events
 */
export async function handleStripeWebhookEndpoint(c: Context): Promise<Response> {
  try {
    const result = await handleStripeWebhook(c.env as Env, c.req.raw);

    if (result.success) {
      return ok(c, result.data || {});
    } else {
      return fail(c, 'WEBHOOK_ERROR', result.error || 'Webhook processing failed', 400);
    }
  } catch (error) {
    return fail(
      c,
      'INTERNAL_ERROR',
      error instanceof Error ? error.message : 'Unknown error',
      500
    );
  }
}
