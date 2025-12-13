/**
 * Stripe-related endpoint handlers
 */

import { Context } from 'hono';
import { Env, CreateCheckoutSessionResponse } from '../types';
import { requireAgencyAuth } from '../auth';
import { createCheckoutSessionForAgency, handleStripeWebhook } from '../stripe';

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

    const response: CreateCheckoutSessionResponse = {
      success: true,
      checkoutUrl: session.url,
      sessionId: session.sessionId,
    };

    if (session.devMode) {
      (response as any).devMode = true;
    }

    return c.json(response);
  } catch (error) {
    if (error instanceof Error && error.name === 'AuthError') {
      return c.json({ success: false, error: error.message }, (error as any).statusCode || 401);
    }

    const response: CreateCheckoutSessionResponse = {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
    return c.json(response, 500);
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
      return c.json(result, 200);
    } else {
      return c.json(result, 400);
    }
  } catch (error) {
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
}
