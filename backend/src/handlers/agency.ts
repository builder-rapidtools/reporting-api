/**
 * Agency management handlers
 */

import { Context } from 'hono';
import { Env, RegisterAgencyRequest, RegisterAgencyResponse, GetAgencyResponse } from '../types';
import { Storage } from '../storage';
import { requireAgencyAuth, AuthError } from '../auth';
import { ok, fail } from '../response-helpers';

/**
 * Hostile Audit Phase 1: Check rate limit for agency registration
 * Allows 3 registrations per IP per hour
 */
async function checkRegistrationRateLimit(
  kv: KVNamespace,
  clientIp: string
): Promise<{ allowed: boolean; remainingAttempts?: number }> {
  const RATE_LIMIT_MAX = 3; // Max registrations per window
  const RATE_LIMIT_WINDOW_SECONDS = 3600; // 1 hour

  const rateLimitKey = `registration_ratelimit:${clientIp}`;
  const existing = await kv.get(rateLimitKey);

  if (!existing) {
    // First attempt, allow and store
    await kv.put(rateLimitKey, '1', { expirationTtl: RATE_LIMIT_WINDOW_SECONDS });
    return { allowed: true, remainingAttempts: RATE_LIMIT_MAX - 1 };
  }

  const attempts = parseInt(existing, 10);

  if (attempts >= RATE_LIMIT_MAX) {
    return { allowed: false, remainingAttempts: 0 };
  }

  // Increment counter
  await kv.put(rateLimitKey, String(attempts + 1), { expirationTtl: RATE_LIMIT_WINDOW_SECONDS });
  return { allowed: true, remainingAttempts: RATE_LIMIT_MAX - (attempts + 1) };
}

/**
 * POST /api/agency/register
 * Register a new agency and receive API key
 *
 * Hostile Audit Phase 1: Rate limited to prevent abuse
 */
export async function handleRegisterAgency(c: Context): Promise<Response> {
  const env = c.env as Env;
  const storage = new Storage(env.REPORTING_KV, env.REPORTING_R2);

  try {
    // Hostile Audit Phase 1: Rate limiting by IP
    const clientIp = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'unknown';
    const rateLimitCheck = await checkRegistrationRateLimit(env.REPORTING_KV, clientIp);

    if (!rateLimitCheck.allowed) {
      return fail(
        c,
        'RATE_LIMIT_EXCEEDED',
        'Too many registration attempts. Please try again in 1 hour.',
        429
      );
    }

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
