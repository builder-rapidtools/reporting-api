/**
 * PDF Download Handler
 * Serves PDF reports from R2 storage
 *
 * Hostile Audit Phase 2: Requires signed token authentication
 */

import { Context } from 'hono';
import { Env } from '../types';
import { verifyPdfToken } from '../pdf-token';

/**
 * Handle PDF download requests
 * Supports both:
 * - /reports/:agencyId/:clientId/:filename
 * - /reports/reports/:agencyId/:clientId/:filename (for backwards compatibility)
 *
 * Hostile Audit Phase 2: Requires ?token=... query parameter with valid signature
 */
export async function handlePdfDownload(c: Context): Promise<Response> {
  try {
    const env = c.env as Env;
    const { agencyId, clientId, filename } = c.req.param();

    // Validate required params
    if (!agencyId || !clientId || !filename) {
      return c.json({
        ok: false,
        error: {
          code: 'INVALID_PDF_URL',
          message: 'Invalid PDF URL parameters',
        },
      }, 400);
    }

    // Validate filename is a PDF (case-insensitive)
    const normalizedFilename = filename.toLowerCase();
    if (!normalizedFilename.endsWith('.pdf')) {
      return c.json({
        ok: false,
        error: {
          code: 'INVALID_FILE_TYPE',
          message: 'Invalid file type. Only PDF files are supported.',
        },
      }, 400);
    }

    // Defense in depth: Validate filename contains no path separators or traversal
    if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
      return c.json({
        ok: false,
        error: {
          code: 'INVALID_FILENAME',
          message: 'Filename cannot contain path separators or traversal sequences',
        },
      }, 400);
    }

    // Ensure filename is just a filename, not a path
    const filenameOnly = filename.split('/').pop()?.split('\\').pop();
    if (filenameOnly !== filename) {
      return c.json({
        ok: false,
        error: {
          code: 'INVALID_FILENAME',
          message: 'Filename must not contain path components',
        },
      }, 400);
    }

    // Additional hardening: restrict to alphanumeric + hyphen/underscore/dot + .pdf extension
    const filenamePattern = /^[a-zA-Z0-9_-]+\.pdf$/;
    if (!filenamePattern.test(filename)) {
      return c.json({
        ok: false,
        error: {
          code: 'INVALID_FILENAME',
          message: 'Filename contains invalid characters',
        },
      }, 400);
    }

    // Hostile Audit Phase 2: Require signed token
    const token = c.req.query('token');

    if (!token) {
      return c.json({
        ok: false,
        error: {
          code: 'PDF_TOKEN_REQUIRED',
          message: 'PDF download requires a signed token. Please request a new signed URL.',
        },
      }, 401);
    }

    // Verify PDF_SIGNING_SECRET is configured
    if (!env.PDF_SIGNING_SECRET) {
      console.error('[PDF Download] PDF_SIGNING_SECRET not configured');
      return c.json({
        ok: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'PDF signing not configured',
        },
      }, 500);
    }

    // Verify token
    let payload;
    try {
      payload = await verifyPdfToken(token, env.PDF_SIGNING_SECRET);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      if (errorMessage === 'TOKEN_EXPIRED') {
        return c.json({
          ok: false,
          error: {
            code: 'PDF_TOKEN_EXPIRED',
            message: 'PDF download token has expired. Please request a new signed URL.',
          },
        }, 403);
      }

      // INVALID_TOKEN_FORMAT, INVALID_TOKEN_PAYLOAD, INVALID_TOKEN_SIGNATURE
      return c.json({
        ok: false,
        error: {
          code: 'PDF_TOKEN_INVALID',
          message: 'Invalid PDF download token. Please request a new signed URL.',
        },
      }, 403);
    }

    // Verify token matches request parameters
    if (payload.agencyId !== agencyId || payload.clientId !== clientId || payload.filename !== filename) {
      return c.json({
        ok: false,
        error: {
          code: 'PDF_TOKEN_MISMATCH',
          message: 'Token does not match requested PDF',
        },
      }, 403);
    }

    // Construct R2 key
    const r2Key = `reports/${agencyId}/${clientId}/${filename}`;

    // Fetch PDF from R2
    const object = await env.REPORTING_R2.get(r2Key);

    if (!object) {
      // Hostile Audit Phase 2: No PII in logs
      console.error('[PDF Download] PDF not found', {
        agencyId,
        clientId,
        filename,
        r2Key,
      });
      return c.json({
        ok: false,
        error: {
          code: 'PDF_NOT_FOUND',
          message: 'Report not found',
        },
      }, 404);
    }

    // Stream the PDF with proper headers
    return new Response(object.body, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${filename}"`,
        'Cache-Control': 'private, max-age=900', // Cache for 15 minutes (token-protected)
      },
    });
  } catch (error) {
    console.error('[PDF Download] Error:', error);
    return c.json({
      ok: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to retrieve report',
      },
    }, 500);
  }
}
