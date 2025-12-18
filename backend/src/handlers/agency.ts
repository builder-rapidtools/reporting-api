/**
 * Agency management handlers
 */

import { Context } from 'hono';
import { Env, RegisterAgencyRequest, RegisterAgencyResponse, GetAgencyResponse } from '../types';
import { Storage } from '../storage';
import { requireAgencyAuth, AuthError } from '../auth';
import { ok, fail } from '../response-helpers';

/**
 * POST /api/agency/register
 * Register a new agency and receive API key
 */
export async function handleRegisterAgency(c: Context): Promise<Response> {
  const env = c.env as Env;
  const storage = new Storage(env.REPORTING_KV, env.REPORTING_R2);

  try {
    const body = await c.req.json<RegisterAgencyRequest>();

    // Validate required fields
    if (!body.name || !body.billingEmail) {
      return fail(c, 'MISSING_REQUIRED_FIELDS', 'Missing required fields: name, billingEmail', 400);
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(body.billingEmail)) {
      return fail(c, 'INVALID_EMAIL', 'Invalid email format', 400);
    }

    // Create agency
    const agency = await storage.createAgency(body.name, body.billingEmail);

    return ok(c, {
      agency: {
        id: agency.id,
        name: agency.name,
        billingEmail: agency.billingEmail,
        apiKey: agency.apiKey,
        subscriptionStatus: agency.subscriptionStatus,
        createdAt: agency.createdAt,
      },
    }, 201);
  } catch (error) {
    return fail(
      c,
      'INTERNAL_ERROR',
      error instanceof Error ? error.message : 'Unknown error',
      500
    );
  }
}

/**
 * GET /api/agency/me
 * Get authenticated agency details (excluding API key)
 */
export async function handleGetAgency(c: Context): Promise<Response> {
  try {
    // Require authentication
    const { agency } = await requireAgencyAuth(c.req.raw, c.env as Env);

    // Return agency without API key
    const { apiKey, ...agencyWithoutKey } = agency;

    return ok(c, {
      agency: agencyWithoutKey,
    });
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
