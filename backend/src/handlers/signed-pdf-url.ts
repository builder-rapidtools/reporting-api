/**
 * Signed PDF URL Handler
 * Hostile Audit Phase 2: Generate signed URLs for PDF access
 */

import { Context } from 'hono';
import { Env } from '../types';
import { Storage } from '../storage';
import { requireAgencyAuth, requireActiveSubscription, AuthError } from '../auth';
import { ok, fail } from '../response-helpers';
import { generateSignedPdfUrl } from '../pdf-token';

/**
 * POST /api/reports/:clientId/:filename/signed-url
 * Generate a signed URL for PDF download
 *
 * Query parameters:
 * - ttl: Time-to-live in seconds (default: 900 = 15 minutes, max: 3600 = 1 hour)
 *
 * Response:
 * {
 *   "url": "https://base.url/reports/:agencyId/:clientId/:filename?token=...",
 *   "expiresAt": "2025-12-18T14:00:00.000Z"
 * }
 */
export async function handleGenerateSignedPdfUrl(c: Context): Promise<Response> {
  const env = c.env as Env;
  const storage = new Storage(env.REPORTING_KV, env.REPORTING_R2);

  try {
    // Require authentication and active subscription
    const { agency } = await requireAgencyAuth(c.req.raw, env);
    requireActiveSubscription(agency);

    const clientId = c.req.param('clientId');
    const filename = c.req.param('filename');

    if (!clientId || !filename) {
      return fail(c, 'MISSING_REQUIRED_FIELDS', 'Missing clientId or filename', 400);
    }

    // Validate filename is a PDF (case-insensitive)
    const normalizedFilename = filename.toLowerCase();
    if (!normalizedFilename.endsWith('.pdf')) {
      return fail(c, 'INVALID_FILE_TYPE', 'Filename must end with .pdf', 400);
    }

    // Validate filename contains no path separators or traversal
    if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
      return fail(c, 'INVALID_FILENAME', 'Filename cannot contain path separators or traversal sequences', 400);
    }

    // Ensure filename is just a filename, not a path (defense in depth)
    const filenameOnly = filename.split('/').pop()?.split('\\').pop();
    if (filenameOnly !== filename) {
      return fail(c, 'INVALID_FILENAME', 'Filename must not contain path components', 400);
    }

    // Additional hardening: restrict to alphanumeric + hyphen/underscore/dot + .pdf extension
    const filenamePattern = /^[a-zA-Z0-9_-]+\.pdf$/;
    if (!filenamePattern.test(filename)) {
      return fail(c, 'INVALID_FILENAME', 'Filename contains invalid characters', 400);
    }

    // Verify client exists and belongs to agency
    const client = await storage.getClient(clientId);
    if (!client) {
      return fail(c, 'CLIENT_NOT_FOUND', 'Client not found', 404);
    }

    if (client.agencyId !== agency.id) {
      return fail(c, 'UNAUTHORIZED', 'Unauthorized', 403);
    }

    // Verify PDF_SIGNING_SECRET is configured
    if (!env.PDF_SIGNING_SECRET) {
      console.error('[Signed PDF URL] PDF_SIGNING_SECRET not configured');
      return fail(c, 'INTERNAL_ERROR', 'PDF signing not configured', 500);
    }

    // Get TTL from query parameter (default: 15 minutes, max: 60 minutes)
    const ttlParam = c.req.query('ttl');
    let ttlSeconds = 900; // 15 minutes default

    if (ttlParam) {
      const parsedTtl = parseInt(ttlParam, 10);
      if (isNaN(parsedTtl) || parsedTtl < 1) {
        return fail(c, 'INVALID_TTL', 'TTL must be a positive integer', 400);
      }
      ttlSeconds = parsedTtl;
    }

    // Generate base URL
    const baseUrl = env.BASE_URL || 'https://reporting-api.rapidtools.dev';

    // Generate signed URL
    const { url, expiresAt } = await generateSignedPdfUrl(
      baseUrl,
      agency.id,
      clientId,
      filename,
      env.PDF_SIGNING_SECRET,
      ttlSeconds
    );

    return ok(c, {
      url,
      expiresAt,
      ttl: ttlSeconds,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return c.json(error.toJSON(), error.statusCode);
    }

    console.error('[Signed PDF URL] Error:', error);
    return fail(
      c,
      'INTERNAL_ERROR',
      error instanceof Error ? error.message : 'Unknown error',
      500
    );
  }
}
