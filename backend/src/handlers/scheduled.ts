/**
 * Scheduled Report Handler (Cloudflare Cron)
 * Sends weekly reports to all active agencies
 *
 * Operating Principles:
 * - No automation without logging and reversibility
 * - Failures must be visible, not silent
 * - Bounded retries
 */

import { Env } from '../types';
import { Storage } from '../storage';
import { sendClientReport, ReportSendResult } from '../report-sender';

export interface ScheduledRunSummary {
  runId: string;
  startedAt: string;
  completedAt: string;
  agenciesProcessed: number;
  clientsProcessed: number;
  reportsSent: number;
  reportsSkipped: number;
  reportsFailed: number;
  failures: Array<{
    agencyId: string;
    clientId: string;
    error: string;
  }>;
}

/**
 * Generate unique run ID for this scheduled execution
 */
function generateRunId(): string {
  return `run-${new Date().toISOString()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Log structured message for observability
 */
function logStructured(
  level: 'info' | 'warn' | 'error',
  message: string,
  context: Record<string, any>
) {
  const log = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...context,
  };
  console.log(JSON.stringify(log));
}

/**
 * Handle scheduled report sending
 * Called by Cloudflare Cron trigger
 *
 * Operating Principles:
 * - AUTOMATION_ENABLED kill-switch must be 'true' to run
 * - Dev mode (REPORTING_ENV=dev) runs in dry-run mode only (no emails, no PDFs)
 * - Prod mode (REPORTING_ENV=prod) sends real emails and PDFs
 */
export async function handleScheduledReports(env: Env): Promise<ScheduledRunSummary> {
  const runId = generateRunId();
  const startedAt = new Date().toISOString();

  // Operating Principle: Explicit kill-switch
  // AUTOMATION_ENABLED must be explicitly set to 'true' to run
  const automationEnabled = env.AUTOMATION_ENABLED === 'true';

  if (!automationEnabled) {
    const disabledSummary: ScheduledRunSummary = {
      runId,
      startedAt,
      completedAt: new Date().toISOString(),
      agenciesProcessed: 0,
      clientsProcessed: 0,
      reportsSent: 0,
      reportsSkipped: 0,
      reportsFailed: 0,
      failures: [],
    };

    logStructured('warn', 'Scheduled report run DISABLED by kill-switch', {
      runId,
      automationEnabled: false,
      note: 'Set AUTOMATION_ENABLED=true to enable automation',
    });

    return disabledSummary;
  }

  // Operating Principle: Dev mode scheduled runs are dry-run only
  const isDryRun = env.REPORTING_ENV === 'dev';

  if (isDryRun) {
    logStructured('warn', 'Scheduled report run in DRY-RUN mode (dev environment)', {
      runId,
      dryRun: true,
      note: 'No emails will be sent, no PDFs will be written. Logs only.',
    });
  }

  logStructured('info', 'Scheduled report run started', {
    runId,
    environment: env.REPORTING_ENV || 'unknown',
    dryRun: isDryRun,
    automationEnabled,
  });

  const storage = new Storage(env.REPORTING_KV, env.REPORTING_R2);
  const summary: ScheduledRunSummary = {
    runId,
    startedAt,
    completedAt: '',
    agenciesProcessed: 0,
    clientsProcessed: 0,
    reportsSent: 0,
    reportsSkipped: 0,
    reportsFailed: 0,
    failures: [],
  };

  try {
    // Step 1: Find all active agencies
    // Note: This requires iterating KV namespace
    // For now, we'll use a list stored in KV (agencies will be added to this list on creation)
    const activeAgencies = await findActiveAgencies(storage);

    logStructured('info', 'Active agencies found', {
      runId,
      agencyCount: activeAgencies.length,
    });

    // Step 2: For each agency, find weekly clients
    for (const agency of activeAgencies) {
      summary.agenciesProcessed++;

      // Hostile Audit Phase 2: No PII in logs
      logStructured('info', 'Processing agency', {
        runId,
        agencyId: agency.id,
      });

      // Get all clients for this agency
      const clients = await storage.listClients(agency.id);

      // Filter for weekly schedule
      const weeklyClients = clients.filter((c) => c.reportSchedule === 'weekly');

      logStructured('info', 'Weekly clients found', {
        runId,
        agencyId: agency.id,
        weeklyClientCount: weeklyClients.length,
      });

      // Step 3: Send reports for each weekly client
      for (const client of weeklyClients) {
        summary.clientsProcessed++;

        // Hostile Audit Phase 2: No PII in logs
        logStructured('info', 'Sending report', {
          runId,
          agencyId: agency.id,
          clientId: client.id,
        });

        const result = await sendClientReport(env, agency, client, {
          checkIdempotency: true,
          maxRetries: 2,
          dryRun: isDryRun,
        });

        if (result.success && result.dryRun) {
          summary.reportsSent++;
          // Hostile Audit Phase 2: No PII in logs
          logStructured('info', 'DRY RUN - Report would be sent', {
            runId,
            agencyId: agency.id,
            clientId: client.id,
            dryRun: true,
            sentAt: result.sentAt,
          });
        } else if (result.success && result.skipped) {
          summary.reportsSkipped++;
          // Hostile Audit Phase 2: No PII in logs
          logStructured('info', 'Report skipped (already sent)', {
            runId,
            agencyId: agency.id,
            clientId: client.id,
            reason: result.skipReason,
          });
        } else if (result.success) {
          summary.reportsSent++;
          // Hostile Audit Phase 2: No PII in logs
          logStructured('info', 'Report sent successfully', {
            runId,
            agencyId: agency.id,
            clientId: client.id,
            pdfKey: result.pdfKey,
            sentAt: result.sentAt,
            retries: result.retries || 0,
          });
        } else {
          summary.reportsFailed++;
          // Hostile Audit Phase 2: No PII in logs
          summary.failures.push({
            agencyId: agency.id,
            clientId: client.id,
            error: result.error || 'Unknown error',
          });

          logStructured('error', 'Report send failed', {
            runId,
            agencyId: agency.id,
            clientId: client.id,
            error: result.error,
            retries: result.retries || 0,
          });

          // Optionally capture error to Sentry
          if (env.SENTRY_DSN) {
            await captureErrorToSentry(env, {
              message: 'Scheduled report send failed',
              error: result.error || 'Unknown error',
              context: {
                runId,
                agencyId: agency.id,
                clientId: client.id,
              },
            });
          }
        }
      }
    }

    summary.completedAt = new Date().toISOString();

    logStructured('info', 'Scheduled report run completed', {
      ...summary,
    });

    return summary;
  } catch (error) {
    summary.completedAt = new Date().toISOString();

    logStructured('error', 'Scheduled report run failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      ...summary,
    });

    // Capture fatal error to Sentry
    if (env.SENTRY_DSN) {
      await captureErrorToSentry(env, {
        message: 'Scheduled report run failed',
        error: error instanceof Error ? error.message : 'Unknown error',
        context: { runId },
      });
    }

    throw error;
  }
}

/**
 * Find all agencies with active subscriptions
 * For now, we iterate through a maintained list
 * TODO: Consider more efficient indexing strategy
 */
async function findActiveAgencies(storage: Storage): Promise<any[]> {
  // Get list of all agency IDs
  // We maintain this in KV under key: agency_list
  const agencyListJson = await storage['kv'].get('agency_list', 'json');
  const agencyIds = (agencyListJson as string[]) || [];

  const activeAgencies = [];

  for (const agencyId of agencyIds) {
    const agency = await storage.getAgency(agencyId);
    if (agency && agency.subscriptionStatus === 'active') {
      activeAgencies.push(agency);
    }
  }

  return activeAgencies;
}

/**
 * Capture error to Sentry (optional observability)
 * Only called if SENTRY_DSN is configured
 */
async function captureErrorToSentry(
  env: Env,
  payload: {
    message: string;
    error: string;
    context: Record<string, any>;
  }
): Promise<void> {
  if (!env.SENTRY_DSN) {
    return;
  }

  try {
    // Minimal Sentry integration via HTTP API
    // Extract DSN parts: https://<key>@<org>.ingest.sentry.io/<project>
    const dsn = new URL(env.SENTRY_DSN);
    const key = dsn.username;
    const project = dsn.pathname.substring(1);
    const sentryUrl = `https://${dsn.host}/api/${project}/store/`;

    const event = {
      message: payload.message,
      level: 'error',
      platform: 'javascript',
      timestamp: Math.floor(Date.now() / 1000),
      environment: env.REPORTING_ENV || 'production',
      extra: {
        error: payload.error,
        ...payload.context,
      },
    };

    await fetch(sentryUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${key}, sentry_client=rapidtools-worker/1.0`,
      },
      body: JSON.stringify(event),
    });
  } catch (error) {
    // Don't let Sentry errors break the main flow
    console.error('Failed to send error to Sentry:', error);
  }
}
