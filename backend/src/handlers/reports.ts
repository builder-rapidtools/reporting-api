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

    // Check for Idempotency-Key header
    const idempotencyKey = c.req.header('idempotency-key');

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

      // Check if this key has been used before
      const idempotencyCheck = await checkIdempotencyKey(
        env.REPORTING_KV,
        idempotencyKey,
        agency.id,
        clientId,
        requestPayload
      );

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
        return ok(c, {
          ...cachedResponse,
          replayed: true,
        });
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

      // Store idempotency record if key provided
      if (idempotencyKey) {
        await storeIdempotencyRecord(
          env.REPORTING_KV,
          idempotencyKey,
          agency.id,
          clientId,
          { clientId, agencyId: agency.id, body: requestBody },
          responseData
        );
      }

      return ok(c, responseData);
    }

    const responseData = {
      clientId: result.clientId,
      sentTo: client.email,
      pdfKey: result.pdfKey,
      sentAt: result.sentAt,
    };

    // Store idempotency record if key provided
    if (idempotencyKey) {
      await storeIdempotencyRecord(
        env.REPORTING_KV,
        idempotencyKey,
        agency.id,
        clientId,
        { clientId, agencyId: agency.id, body: requestBody },
        responseData
      );
    }

    return ok(c, responseData);
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
