/**
 * Report Sender Core Logic
 * Reusable logic for generating and sending reports
 *
 * Operating Principles:
 * - Idempotent (check before send)
 * - Bounded retries (max 2 retries)
 * - Failures are visible (structured logs)
 */

import { Env, Client, Agency, ReportMetrics } from './types';
import { Storage } from './storage';
import { generateAndStoreReportPDF } from './pdf';
import { sendReportEmail, buildReportEmailHtml } from './email';
import { aggregateMetrics } from './handlers/uploads';
import { generateSignedPdfUrl } from './pdf-token';

export interface ReportSendResult {
  success: boolean;
  clientId: string;
  clientName?: string; // Phase 2: Added for PII audit logging
  error?: string;
  pdfKey?: string;
  sentAt?: string;
  skipped?: boolean;
  skipReason?: string;
  retries?: number;
  dryRun?: boolean;
}

/**
 * Get ISO week identifier for idempotency
 * Format: YYYY-WW (e.g., "2025-W50")
 */
function getISOWeek(date: Date): string {
  const tempDate = new Date(date.valueOf());
  const dayNum = (date.getDay() + 6) % 7;
  tempDate.setDate(tempDate.getDate() - dayNum + 3);
  const firstThursday = tempDate.valueOf();
  tempDate.setMonth(0, 1);
  if (tempDate.getDay() !== 4) {
    tempDate.setMonth(0, 1 + ((4 - tempDate.getDay() + 7) % 7));
  }
  const weekNum = 1 + Math.ceil((firstThursday - tempDate.valueOf()) / 604800000);
  const year = tempDate.getFullYear();
  return `${year}-W${weekNum.toString().padStart(2, '0')}`;
}

/**
 * Check if report has already been sent this week
 * Idempotency key: report_sent:{agencyId}:{clientId}:{yearWeek}
 */
async function checkReportSent(
  storage: Storage,
  agencyId: string,
  clientId: string,
  weekId: string
): Promise<boolean> {
  const idempotencyKey = `report_sent:${agencyId}:${clientId}:${weekId}`;
  const existing = await storage['kv'].get(idempotencyKey);
  return existing !== null;
}

/**
 * Mark report as sent for this week
 * Store with 60-day TTL to prevent re-sends
 */
async function markReportSent(
  storage: Storage,
  agencyId: string,
  clientId: string,
  weekId: string,
  sentAt: string
): Promise<void> {
  const idempotencyKey = `report_sent:${agencyId}:${clientId}:${weekId}`;
  const value = JSON.stringify({
    agencyId,
    clientId,
    weekId,
    sentAt,
  });

  // 60-day TTL (5184000 seconds)
  await storage['kv'].put(idempotencyKey, value, { expirationTtl: 5184000 });
}

/**
 * Parse CSV helper (duplicate from reports.ts)
 * TODO: Move to shared utils module
 */
function parseGA4Csv(csvContent: string): any[] {
  const lines = csvContent.trim().split('\n');

  if (lines.length < 2) {
    throw new Error('CSV must contain header row and at least one data row');
  }

  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());

  const rows: any[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = line.split(',').map((v) => v.trim());

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

/**
 * Send a single report with retry logic
 * Attempts up to maxRetries times before giving up
 *
 * Operating Principle: Bounded retries
 * Operating Principle: Dev mode scheduled runs are dry-run only
 */
export async function sendClientReport(
  env: Env,
  agency: Agency,
  client: Client,
  options: {
    checkIdempotency?: boolean;
    maxRetries?: number;
    dryRun?: boolean;
  } = {}
): Promise<ReportSendResult> {
  const { checkIdempotency = true, maxRetries = 2, dryRun = false } = options;
  const storage = new Storage(env.REPORTING_KV, env.REPORTING_R2);

  // Check idempotency
  if (checkIdempotency) {
    const weekId = getISOWeek(new Date());
    const alreadySent = await checkReportSent(storage, agency.id, client.id, weekId);

    if (alreadySent) {
      return {
        success: true,
        clientId: client.id,
        clientName: client.name,
        skipped: true,
        skipReason: `Already sent for week ${weekId}`,
      };
    }
  }

  // Dry-run mode: Log only, no actual sends
  // Operating Principle: Dev mode scheduled runs are dry-run only
  if (dryRun) {
    console.log(
      JSON.stringify({
        level: 'info',
        message: 'DRY RUN - Report would be sent',
        timestamp: new Date().toISOString(),
        agencyId: agency.id,
        agencyName: agency.name,
        clientId: client.id,
        clientName: client.name,
        clientEmail: client.email,
      })
    );

    return {
      success: true,
      clientId: client.id,
      clientName: client.name,
      dryRun: true,
      sentAt: new Date().toISOString(),
    };
  }

  // Attempt send with retries
  let lastError: Error | null = null;
  let attemptCount = 0;

  while (attemptCount <= maxRetries) {
    try {
      // Get integration config
      const integrationConfig = await storage.getIntegrationConfig(client.id);

      if (!integrationConfig || !integrationConfig.ga4CsvLatestKey) {
        return {
          success: false,
          clientId: client.id,
          clientName: client.name,
          error: 'No GA4 data uploaded for this client',
        };
      }

      // Fetch CSV and generate metrics
      const csvContent = await storage.getCsvFromR2(integrationConfig.ga4CsvLatestKey);

      if (!csvContent) {
        return {
          success: false,
          clientId: client.id,
          clientName: client.name,
          error: 'CSV data not found in storage',
        };
      }

      const rows = parseGA4Csv(csvContent);
      const metrics = aggregateMetrics(rows);
      const generatedAt = new Date().toISOString();

      // Generate PDF
      const pdfResult = await generateAndStoreReportPDF(env, {
        client,
        metrics,
        generatedAt,
      });

      // Hostile Audit Phase 2: Generate signed URL for PDF download
      // Extract filename from pdfKey (e.g., reports/agencyId/clientId/filename.pdf -> filename.pdf)
      const filename = pdfResult.pdfKey.split('/').pop() || 'report.pdf';
      const baseUrl = env.BASE_URL || 'https://reporting-api.rapidtools.dev';
      const pdfSigningSecret = env.PDF_SIGNING_SECRET || 'default-secret-change-in-prod';

      const { url: signedPdfUrl } = await generateSignedPdfUrl(
        baseUrl,
        agency.id,
        client.id,
        filename,
        pdfSigningSecret,
        86400 // 24 hours (long TTL for email links)
      );

      // Build and send email
      const htmlSummary = buildReportEmailHtml({
        clientName: client.name,
        periodStart: metrics.periodStart,
        periodEnd: metrics.periodEnd,
        sessions: metrics.sessions,
        users: metrics.users,
        pageviews: metrics.pageviews,
        topPages: metrics.topPages,
      });

      const emailResult = await sendReportEmail(env, {
        to: client.email,
        subject: `Weekly Report: ${client.name}`,
        htmlSummary,
        pdfUrl: signedPdfUrl, // Hostile Audit Phase 2: Use signed URL
      });

      if (!emailResult.success) {
        throw new Error(emailResult.error || 'Email send failed');
      }

      // Update client's lastReportSentAt
      client.lastReportSentAt = generatedAt;
      await storage.saveClient(client);

      // Mark as sent for idempotency
      if (checkIdempotency) {
        const weekId = getISOWeek(new Date());
        await markReportSent(storage, agency.id, client.id, weekId, generatedAt);
      }

      return {
        success: true,
        clientId: client.id,
        clientName: client.name,
        pdfKey: pdfResult.pdfKey,
        sentAt: generatedAt,
        retries: attemptCount,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Unknown error');
      attemptCount++;

      // If we haven't exhausted retries, wait briefly before retry
      if (attemptCount <= maxRetries) {
        // Exponential backoff: 1s, 2s
        await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attemptCount) * 1000));
      }
    }
  }

  // All retries exhausted
  return {
    success: false,
    clientId: client.id,
    clientName: client.name,
    error: lastError?.message || 'Unknown error',
    retries: attemptCount - 1,
  };
}
