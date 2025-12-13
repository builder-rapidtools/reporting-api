/**
 * Report generation handlers
 */

import { Context } from 'hono';
import { Env, ReportPreviewResponse } from '../types';
import { Storage } from '../storage';
import { aggregateMetrics } from './uploads';
import { requireAgencyAuth, requireActiveSubscription } from '../auth';
import { sendClientReport } from '../report-sender';

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
      const response: ReportPreviewResponse = {
        success: false,
        error: 'Missing client ID',
      };
      return c.json(response, 400);
    }

    // Verify client exists
    const client = await storage.getClient(clientId);
    if (!client) {
      const response: ReportPreviewResponse = {
        success: false,
        error: 'Client not found',
      };
      return c.json(response, 404);
    }

    // Verify client belongs to authenticated agency
    if (client.agencyId !== agency.id) {
      return c.json({ success: false, error: 'Unauthorized' }, 403);
    }

    // Get integration config to find latest CSV
    const integrationConfig = await storage.getIntegrationConfig(clientId);

    if (!integrationConfig || !integrationConfig.ga4CsvLatestKey) {
      const response: ReportPreviewResponse = {
        success: false,
        error: 'No GA4 data uploaded for this client. Please upload a CSV first.',
      };
      return c.json(response, 404);
    }

    // Fetch CSV from R2
    const csvContent = await storage.getCsvFromR2(integrationConfig.ga4CsvLatestKey);

    if (!csvContent) {
      const response: ReportPreviewResponse = {
        success: false,
        error: 'CSV data not found in storage',
      };
      return c.json(response, 500);
    }

    // Parse and aggregate metrics
    const rows = parseGA4Csv(csvContent);
    const metrics = aggregateMetrics(rows);

    const response: ReportPreviewResponse = {
      success: true,
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
    };

    return c.json(response);
  } catch (error) {
    if (error instanceof Error && error.name === 'AuthError') {
      return c.json({ success: false, error: error.message }, (error as any).statusCode || 401);
    }

    const response: ReportPreviewResponse = {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
    return c.json(response, 500);
  }
}

/**
 * POST /api/client/:id/report/send
 * Generate PDF report and email it to client
 * Delegates to sendClientReport for actual sending
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
      return c.json({
        success: false,
        error: 'Missing client ID',
      }, 400);
    }

    // Verify client exists
    const client = await storage.getClient(clientId);
    if (!client) {
      return c.json({
        success: false,
        error: 'Client not found',
      }, 404);
    }

    // Verify client belongs to authenticated agency
    if (client.agencyId !== agency.id) {
      return c.json({ success: false, error: 'Unauthorized' }, 403);
    }

    // Use shared report sending logic
    const result = await sendClientReport(env, agency, client, {
      checkIdempotency: false, // HTTP endpoint allows manual re-send
      maxRetries: 0, // HTTP endpoint returns errors immediately
    });

    if (!result.success) {
      return c.json({
        success: false,
        error: result.error,
      }, 500);
    }

    if (result.skipped) {
      return c.json({
        success: true,
        skipped: true,
        skipReason: result.skipReason,
        clientId: result.clientId,
        clientName: result.clientName,
      });
    }

    return c.json({
      success: true,
      clientId: result.clientId,
      sentTo: client.email,
      pdfKey: result.pdfKey,
      sentAt: result.sentAt,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AuthError') {
      return c.json({ success: false, error: error.message, ...(error as any).metadata }, (error as any).statusCode || 401);
    }

    console.error('Report send failed:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
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
