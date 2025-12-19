/**
 * Report generation handlers
 */

import { Context } from 'hono';
import { Env, ReportPreviewResponse } from '../types';
import { Storage } from '../storage';
import { aggregateMetrics } from './uploads';
import { requireAgencyAuth, requireActiveSubscription, AuthError } from '../auth';
import { sendClientReport } from '../report-sender';
import { ok, fail } from '../response-helpers';
import { checkIdempotencyKey, storeIdempotencyRecord } from '../idempotency';

/**
 * POST /api/client/:id/report/preview
 * Generate a preview of the report (JSON structure)
 * Phase 1: Returns JSON preview with metrics
 * Phase 2: Will generate actual PDF
 */
export async function handleReportPreview(c: Context): Promise<Response> {
  const env = c.env as Env;
  const storage = new Storage(env.REPORTING_KV, env.REPORTING_R2);

  try {
    // Require authentication
    const { agency } = await requireAgencyAuth(c.req.raw, env);

    const clientId = c.req.param('id');

    if (!clientId) {
      return fail(c, 'MISSING_REQUIRED_FIELDS', 'Missing client ID', 400);
    }

    // Verify client exists
    const client = await storage.getClient(clientId);
    if (!client) {
      return fail(c, 'CLIENT_NOT_FOUND', 'Client not found', 404);
    }

    // Verify client belongs to authenticated agency
    if (client.agencyId !== agency.id) {
      return fail(c, 'UNAUTHORIZED', 'Unauthorized', 403);
    }

    // Get integration config to find latest CSV
    const integrationConfig = await storage.getIntegrationConfig(clientId);

    if (!integrationConfig || !integrationConfig.ga4CsvLatestKey) {
      return fail(c, 'NO_DATA_UPLOADED', 'No GA4 data uploaded for this client. Please upload a CSV first.', 404);
    }

    // Fetch CSV from R2
    const csvContent = await storage.getCsvFromR2(integrationConfig.ga4CsvLatestKey);

    if (!csvContent) {
      return fail(c, 'DATA_NOT_FOUND', 'CSV data not found in storage', 500);
    }

    // Parse and aggregate metrics
    const rows = parseGA4Csv(csvContent);
    const metrics = aggregateMetrics(rows);

    return ok(c, {
      preview: {
        client: {
          id: client.id,
          agencyId: client.agencyId,
          name: client.name,
          email: client.email,
          brandLogoUrl: client.brandLogoUrl,
          reportSchedule: client.reportSchedule,
          createdAt: client.createdAt,
        },
        metrics,
        generatedAt: new Date().toISOString(),
      },
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

/**
 * POST /api/client/:id/report/send
 * Generate PDF report and email it to client
 * Delegates to sendClientReport for actual sending
 *
 * Supports optional idempotency via Idempotency-Key header:
 * - When header present, prevents duplicate email sends
 * - Returns cached response on replay with same payload
 * - Returns 409 on replay with different payload
 */
export async function handleReportSend(c: Context): Promise<Response> {
  const env = c.env as Env;
  const storage = new Storage(env.REPORTING_KV, env.REPORTING_R2);

  try {
    // Require authentication and active subscription
    const { agency } = await requireAgencyAuth(c.req.raw, env);
    requireActiveSubscription(agency);

    const clientId = c.req.param('id');

    if (!clientId) {
      return fail(c, 'MISSING_REQUIRED_FIELDS', 'Missing client ID', 400);
    }

    // Verify client exists
    const client = await storage.getClient(clientId);
    if (!client) {
      return fail(c, 'CLIENT_NOT_FOUND', 'Client not found', 404);
    }

    // Verify client belongs to authenticated agency
    if (client.agencyId !== agency.id) {
      return fail(c, 'UNAUTHORIZED', 'Unauthorized', 403);
    }

    // Rate limiting: 10 reports per client per hour (FRS-1: Economic abuse prevention)
    // FRS-2: Track window start time for X-RateLimit-Reset header
    const rateLimitKey = `ratelimit:report-send:${clientId}`;
    const rateLimitWindow = 3600; // 1 hour in seconds
    const rateLimitMax = 10;

    const currentValueStr = await env.REPORTING_KV.get(rateLimitKey);

    // Parse stored value: "count:windowStart" or legacy "count"
    let currentCount = 0;
    let windowStart = Math.floor(Date.now() / 1000);

    if (currentValueStr) {
      const parts = currentValueStr.split(':');
      currentCount = parseInt(parts[0], 10);
      windowStart = parts.length > 1 ? parseInt(parts[1], 10) : windowStart;
    }

    const resetTime = windowStart + rateLimitWindow;
    const remaining = Math.max(0, rateLimitMax - currentCount);

    if (currentCount >= rateLimitMax) {
      const response = fail(
        c,
        'RATE_LIMIT_EXCEEDED',
        `Report generation rate limit exceeded. Maximum ${rateLimitMax} reports per client per hour.`,
        429
      );
      // Add rate limit headers to 429 response (FRS-2: agent observability)
      response.headers.set('X-RateLimit-Limit', rateLimitMax.toString());
      response.headers.set('X-RateLimit-Remaining', '0');
      response.headers.set('X-RateLimit-Reset', resetTime.toString());
      return response;
    }

    // Increment rate limit counter, preserving window start time
    const newCount = currentCount + 1;
    const newValue = `${newCount}:${windowStart}`;
    await env.REPORTING_KV.put(rateLimitKey, newValue, {
      expirationTtl: rateLimitWindow,
    });

    // Check for Idempotency-Key header (accept both lowercase and capitalized for HTTP spec compliance)
    const idempotencyKey = c.req.header('idempotency-key') || c.req.header('Idempotency-Key');

    // Parse request body for idempotency check
    let requestBody = {};
    try {
      requestBody = await c.req.json();
    } catch {
      // No body or invalid JSON - use empty object
      requestBody = {};
    }

    if (idempotencyKey) {
      // Build request payload for comparison
      const requestPayload = {
        clientId,
        agencyId: agency.id,
        body: requestBody,
      };

      // FRS-2: Fail closed if idempotency check fails (storage unavailable)
      let idempotencyCheck;
      try {
        // Check if this key has been used before
        idempotencyCheck = await checkIdempotencyKey(
          env.REPORTING_KV,
          idempotencyKey,
          agency.id,
          clientId,
          requestPayload
        );
      } catch (error) {
        // Idempotency check failed - reject request to prevent duplicates
        console.error('Idempotency check failed:', error);
        return fail(
          c,
          'IDEMPOTENCY_CHECK_FAILED',
          'Unable to verify request idempotency. Please retry with a different idempotency key or without the header.',
          503
        );
      }

      if (idempotencyCheck.isReplay) {
        if (idempotencyCheck.payloadMismatch) {
          // Same key, different payload - conflict
          return fail(
            c,
            'IDEMPOTENCY_KEY_REUSE_MISMATCH',
            'Idempotency key was already used with a different request payload',
            409
          );
        }

        // Same key, same payload - return cached response
        const cachedResponse = idempotencyCheck.record!.response;
        const response = ok(c, {
          ...cachedResponse,
          replayed: true,
        });
        // Add rate limit headers (FRS-2: agent observability)
        response.headers.set('X-RateLimit-Limit', rateLimitMax.toString());
        response.headers.set('X-RateLimit-Remaining', Math.max(0, remaining - 1).toString());
        response.headers.set('X-RateLimit-Reset', resetTime.toString());
        return response;
      }
    }

    // Proceed with sending report
    const result = await sendClientReport(env, agency, client, {
      checkIdempotency: false, // HTTP endpoint idempotency handled separately via Idempotency-Key header
      maxRetries: 0, // HTTP endpoint returns errors immediately
    });

    if (!result.success) {
      return fail(c, 'REPORT_SEND_FAILED', result.error || 'Failed to send report', 500);
    }

    if (result.skipped) {
      const responseData = {
        skipped: true,
        skipReason: result.skipReason,
        clientId: result.clientId,
        clientName: result.clientName,
      };

      // Store idempotency record if key provided (FRS-2: non-blocking, log on failure)
      if (idempotencyKey) {
        try {
          await storeIdempotencyRecord(
            env.REPORTING_KV,
            idempotencyKey,
            agency.id,
            clientId,
            { clientId, agencyId: agency.id, body: requestBody },
            responseData
          );
        } catch (error) {
          // Log error but don't fail request (email already sent)
          console.error('Failed to store idempotency record:', error);
        }
      }

      const response = ok(c, responseData);
      // Add rate limit headers (FRS-2: agent observability)
      response.headers.set('X-RateLimit-Limit', rateLimitMax.toString());
      response.headers.set('X-RateLimit-Remaining', Math.max(0, remaining - 1).toString());
      response.headers.set('X-RateLimit-Reset', resetTime.toString());
      return response;
    }

    const responseData = {
      clientId: result.clientId,
      sentTo: client.email,
      pdfKey: result.pdfKey,
      sentAt: result.sentAt,
    };

    // Store idempotency record if key provided (FRS-2: non-blocking, log on failure)
    if (idempotencyKey) {
      try {
        await storeIdempotencyRecord(
          env.REPORTING_KV,
          idempotencyKey,
          agency.id,
          clientId,
          { clientId, agencyId: agency.id, body: requestBody },
          responseData
        );
      } catch (error) {
        // Log error but don't fail request (email already sent)
        console.error('Failed to store idempotency record:', error);
      }
    }

    const response = ok(c, responseData);
    // Add rate limit headers (FRS-2: agent observability)
    response.headers.set('X-RateLimit-Limit', rateLimitMax.toString());
    response.headers.set('X-RateLimit-Remaining', Math.max(0, remaining - 1).toString());
    response.headers.set('X-RateLimit-Reset', resetTime.toString());
    return response;
  } catch (error) {
    if (error instanceof AuthError) {
      return c.json(error.toJSON(), error.statusCode);
    }

    console.error('Report send failed:', error);
    return fail(
      c,
      'INTERNAL_ERROR',
      error instanceof Error ? error.message : 'Unknown error',
      500
    );
  }
}

/**
 * Parse GA4 CSV (duplicate of uploads.ts function for now)
 * TODO: Extract to shared utils module
 */
function parseGA4Csv(csvContent: string): any[] {
  const lines = csvContent.trim().split('\n');

  if (lines.length < 2) {
    throw new Error('CSV must contain header row and at least one data row');
  }

  const header = lines[0].split(',').map(h => h.trim().toLowerCase());

  const rows: any[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = line.split(',').map(v => v.trim());

    if (values.length !== header.length) {
      continue;
    }

    const row: any = {
      date: values[header.indexOf('date')],
      sessions: parseInt(values[header.indexOf('sessions')], 10) || 0,
      users: parseInt(values[header.indexOf('users')], 10) || 0,
      pageviews: parseInt(values[header.indexOf('pageviews')], 10) || 0,
    };

    const pagePathIndex = header.indexOf('page_path');
    if (pagePathIndex !== -1) {
      row.page_path = values[pagePathIndex];
    }

    const pageViewsIndex = header.indexOf('page_views');
    if (pageViewsIndex !== -1) {
      row.page_views = parseInt(values[pageViewsIndex], 10) || 0;
    }

    rows.push(row);
  }

  return rows;
}
