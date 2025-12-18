/**
 * GA4 CSV upload handler
 */

import { Context } from 'hono';
import { Env, UploadGA4CsvResponse, GA4CsvRow, ReportMetrics } from '../types';
import { Storage } from '../storage';
import { requireAgencyAuth, requireActiveSubscription, AuthError } from '../auth';
import { ok, fail } from '../response-helpers';

/**
 * POST /api/client/:id/ga4-csv
 * Upload GA4 CSV data for a client
 */
export async function handleUploadGA4Csv(c: Context): Promise<Response> {
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

    // Get CSV content from request body
    const csvContent = await c.req.text();

    if (!csvContent || csvContent.trim().length === 0) {
      return fail(c, 'INVALID_CSV', 'Empty CSV content', 400);
    }

    // Hostile Audit Phase 1: CSV size limit enforcement (5MB)
    const MAX_CSV_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
    const csvSizeBytes = new TextEncoder().encode(csvContent).length;

    if (csvSizeBytes > MAX_CSV_SIZE_BYTES) {
      return fail(
        c,
        'CSV_TOO_LARGE',
        `CSV file exceeds maximum size of ${MAX_CSV_SIZE_BYTES / 1024 / 1024}MB (actual: ${(csvSizeBytes / 1024 / 1024).toFixed(2)}MB)`,
        413
      );
    }

    // Parse and validate CSV
    const parsedData = parseGA4Csv(csvContent);

    if (parsedData.length === 0) {
      return fail(c, 'INVALID_CSV', 'No valid rows found in CSV', 400);
    }

    // Hostile Audit Phase 1: Row count limit enforcement (100,000 rows)
    const MAX_CSV_ROWS = 100000;

    if (parsedData.length > MAX_CSV_ROWS) {
      return fail(
        c,
        'CSV_TOO_MANY_ROWS',
        `CSV file exceeds maximum row count of ${MAX_CSV_ROWS} (actual: ${parsedData.length})`,
        413
      );
    }

    // Upload CSV to R2
    const csvKey = await storage.uploadCsvToR2(agency.id, clientId, csvContent);

    // Update integration config with latest CSV reference
    const integrationConfig = {
      clientId,
      ga4CsvLatestKey: csvKey,
      ga4CsvUploadedAt: new Date().toISOString(),
    };

    await storage.saveIntegrationConfig(integrationConfig);

    return ok(c, {
      uploadedAt: integrationConfig.ga4CsvUploadedAt,
      rowsProcessed: parsedData.length,
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
 * Parse GA4 CSV content into structured data
 * Required columns: date, sessions, users
 * Optional columns: pageviews, page_path, page_views
 */
function parseGA4Csv(csvContent: string): GA4CsvRow[] {
  const lines = csvContent.trim().split('\n');

  if (lines.length < 2) {
    throw new Error('CSV must contain header row and at least one data row');
  }

  const header = lines[0].split(',').map(h => h.trim().toLowerCase());

  // Validate required columns
  const requiredColumns = ['date', 'sessions', 'users'];
  const missingColumns = requiredColumns.filter(col => !header.includes(col));

  if (missingColumns.length > 0) {
    throw new Error(
      `Missing required CSV columns: ${missingColumns.join(', ')}. ` +
      `Required columns are: ${requiredColumns.join(', ')}`
    );
  }

  const rows: GA4CsvRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = line.split(',').map(v => v.trim());

    if (values.length !== header.length) {
      console.warn(`Skipping malformed row ${i}: column count mismatch`);
      continue;
    }

    const row: GA4CsvRow = {
      date: values[header.indexOf('date')],
      sessions: parseInt(values[header.indexOf('sessions')], 10) || 0,
      users: parseInt(values[header.indexOf('users')], 10) || 0,
      pageviews: 0,
    };

    // Optional columns
    const pageviewsIndex = header.indexOf('pageviews');
    if (pageviewsIndex !== -1) {
      row.pageviews = parseInt(values[pageviewsIndex], 10) || 0;
    }

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

/**
 * Aggregate CSV rows into report metrics
 * Helper function for generating report previews
 */
export function aggregateMetrics(rows: GA4CsvRow[]): ReportMetrics {
  if (rows.length === 0) {
    throw new Error('No data to aggregate');
  }

  // Sort by date to get period range
  const sortedRows = [...rows].sort((a, b) => a.date.localeCompare(b.date));

  const periodStart = sortedRows[0].date;
  const periodEnd = sortedRows[sortedRows.length - 1].date;

  // Sum totals
  let totalSessions = 0;
  let totalUsers = 0;
  let totalPageviews = 0;

  for (const row of rows) {
    totalSessions += row.sessions;
    totalUsers += row.users;
    totalPageviews += row.pageviews;
  }

  // Aggregate top pages (if page_path data exists)
  const pageMap = new Map<string, number>();

  for (const row of rows) {
    if (row.page_path && row.page_views) {
      const existing = pageMap.get(row.page_path) || 0;
      pageMap.set(row.page_path, existing + row.page_views);
    }
  }

  // Sort pages by views and take top 10
  const topPages = Array.from(pageMap.entries())
    .map(([path, pageviews]) => ({ path, pageviews }))
    .sort((a, b) => b.pageviews - a.pageviews)
    .slice(0, 10);

  return {
    periodStart,
    periodEnd,
    sessions: totalSessions,
    users: totalUsers,
    pageviews: totalPageviews,
    topPages,
  };
}
