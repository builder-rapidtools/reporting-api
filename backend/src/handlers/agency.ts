/**
 * Agency management handlers
 */

import { Context } from 'hono';
import { Env, RegisterAgencyRequest, RegisterAgencyResponse, GetAgencyResponse } from '../types';
import { Storage } from '../storage';
import { requireAgencyAuth } from '../auth';

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
      const response: RegisterAgencyResponse = {
        success: false,
        error: 'Missing required fields: name, billingEmail',
      };
      return c.json(response, 400);
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(body.billingEmail)) {
      const response: RegisterAgencyResponse = {
        success: false,
        error: 'Invalid email format',
      };
      return c.json(response, 400);
    }

    // Create agency
    const agency = await storage.createAgency(body.name, body.billingEmail);

    const response: RegisterAgencyResponse = {
      success: true,
      agency: {
        id: agency.id,
        name: agency.name,
        billingEmail: agency.billingEmail,
        apiKey: agency.apiKey,
        subscriptionStatus: agency.subscriptionStatus,
        createdAt: agency.createdAt,
      },
    };

    return c.json(response, 201);
  } catch (error) {
    const response: RegisterAgencyResponse = {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
    return c.json(response, 500);
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

    const response: GetAgencyResponse = {
      success: true,
      agency: agencyWithoutKey,
    };

    return c.json(response);
  } catch (error) {
    if (error instanceof Error && error.name === 'AuthError') {
      return c.json({ success: false, error: error.message }, (error as any).statusCode || 401);
    }

    const response: GetAgencyResponse = {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
    return c.json(response, 500);
  }
}
