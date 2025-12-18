/**
 * Admin handler for rotating agency API keys
 * Operating Principle: Admin operations require explicit authentication
 * Hostile Audit Phase 4: Added audit logging for admin actions
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
 * Hostile Audit Phase 4: Log admin action to KV
 * Stores audit trail without PII
 * Phase 4 Hardening: Use timestamp-based key to avoid race conditions
 */
async function logAdminAction(
  kv: KVNamespace,
  action: string,
  agencyId: string,
  requestId: string,
  metadata?: Record<string, any>
): Promise<void> {
  const timestamp = Date.now(); // Unix milliseconds for sortability
  const isoTimestamp = new Date().toISOString();

  const auditEntry = {
    action,
    agencyId,
    requestId,
    timestamp: isoTimestamp,
    metadata: metadata || {},
  };

  // Phase 4 Hardening: Use agency-scoped timestamp-based key to avoid race conditions
  // Pattern: admin_audit:{agencyId}:{timestamp}:{requestId}
  // This ensures uniqueness without needing to read-modify-write an index
  const auditKey = `admin_audit:${agencyId}:${timestamp}:${requestId}`;

  // Store audit entry with TTL of 90 days
  await kv.put(auditKey, JSON.stringify(auditEntry), {
    expirationTtl: 90 * 24 * 60 * 60, // 90 days
  });

  // Note: No index maintained. To retrieve audit logs for an agency,
  // use KV list operation with prefix: admin_audit:{agencyId}:
  // Logs are naturally sorted by timestamp due to key structure.
}

/**
 * POST /api/admin/agency/:agencyId/rotate-key
 * Rotate an agency's API key (admin-only)
 * Hostile Audit Phase 4: Now logs rotation events to KV
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

    // Hostile Audit Phase 4: Log the rotation event
    const requestId = c.req.header('cf-ray') || crypto.randomUUID();
    await logAdminAction(
      env.REPORTING_KV,
      'rotate_agency_key',
      agencyId,
      requestId,
      {
        rotatedAt: new Date().toISOString(),
      }
    );

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
