/**
 * Admin handler for rotating agency API keys
 * Operating Principle: Admin operations require explicit authentication
 */

import { Context } from 'hono';
import { Env } from '../types';
import { Storage } from '../storage';
import { ok, fail } from '../response-helpers';

interface RotateKeyResponse {
  success: boolean;
  newApiKey?: string;
  error?: string;
}

/**
 * POST /api/admin/agency/:agencyId/rotate-key
 * Rotate an agency's API key (admin-only)
 */
export async function handleRotateAgencyKey(c: Context): Promise<Response> {
  const env = c.env as Env;

  // Authenticate admin request
  const adminSecret = c.req.header('x-admin-secret');

  if (!adminSecret || adminSecret !== env.ADMIN_SECRET) {
    return fail(c, 'FORBIDDEN', 'Forbidden', 403);
  }

  try {
    const agencyId = c.req.param('agencyId');

    if (!agencyId) {
      return fail(c, 'MISSING_REQUIRED_FIELDS', 'Missing agency ID', 400);
    }

    const storage = new Storage(env.REPORTING_KV, env.REPORTING_R2);

    // Fetch agency record
    const agency = await storage.getAgency(agencyId);

    if (!agency) {
      return fail(c, 'AGENCY_NOT_FOUND', 'Agency not found', 404);
    }

    // Store old API key for cleanup
    const oldApiKey = agency.apiKey;

    // Generate new API key
    const { v4: uuidv4 } = await import('uuid');
    const newApiKey = uuidv4();

    // Update agency with new API key
    agency.apiKey = newApiKey;
    agency.updatedAt = new Date().toISOString();

    // Save agency (this creates new lookup agency_api_key:{newApiKey})
    await storage.saveAgency(agency);

    // Delete old API key lookup
    if (oldApiKey) {
      const oldLookupKey = `agency_api_key:${oldApiKey}`;
      await env.REPORTING_KV.delete(oldLookupKey);
    }

    return ok(c, {
      newApiKey,
    });
  } catch (error) {
    console.error('Admin rotate key failed:', error);
    return fail(
      c,
      'INTERNAL_ERROR',
      error instanceof Error ? error.message : 'Unknown error',
      500
    );
  }
}
