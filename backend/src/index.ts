/**
 * Cloudflare Worker entrypoint
 * RapidTools Automated Weekly Client Reporting Tool - Backend API
 *
 * Operating Principle: Safety over growth
 * Production must fail fast if required secrets are missing
 */

import { createRouter } from './router';
import { assertValidEnvironment } from './env-validator';
import { handleScheduledReports } from './handlers/scheduled';
import { Env } from './types';

const app = createRouter();

// Validate environment on first request
let environmentValidated = false;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Validate environment on first request only
    if (!environmentValidated) {
      try {
        await assertValidEnvironment(env);
        environmentValidated = true;
      } catch (error) {
        // Environment validation failed - return 503 Service Unavailable
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return new Response(
          JSON.stringify({
            error: 'Service configuration error',
            message: 'Worker cannot start - environment validation failed',
            details: errorMessage,
          }),
          {
            status: 503,
            headers: {
              'Content-Type': 'application/json',
            },
          }
        );
      }
    }

    // Delegate to Hono router
    return app.fetch(request, env, ctx);
  },

  /**
   * Scheduled handler for Cloudflare Cron triggers
   * Sends weekly reports to all active agencies
   *
   * Operating Principle: No automation without logging and reversibility
   */
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📅 SCHEDULED REPORT RUN TRIGGERED');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Cron: ${event.cron}`);
    console.log(`Scheduled Time: ${new Date(event.scheduledTime).toISOString()}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    try {
      const summary = await handleScheduledReports(env);

      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('✓ SCHEDULED REPORT RUN SUMMARY');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`Run ID: ${summary.runId}`);
      console.log(`Agencies processed: ${summary.agenciesProcessed}`);
      console.log(`Clients processed: ${summary.clientsProcessed}`);
      console.log(`Reports sent: ${summary.reportsSent}`);
      console.log(`Reports skipped: ${summary.reportsSkipped}`);
      console.log(`Reports failed: ${summary.reportsFailed}`);
      console.log(`Duration: ${new Date(summary.completedAt).getTime() - new Date(summary.startedAt).getTime()}ms`);

      if (summary.reportsFailed > 0) {
        console.log('\nFailed reports:');
        // Hostile Audit Phase 2: No PII in logs
        for (const failure of summary.failures) {
          console.log(`  - Agency ${failure.agencyId} / Client ${failure.clientId}: ${failure.error}`);
        }
      }

      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    } catch (error) {
      console.error('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.error('✗ SCHEDULED REPORT RUN FAILED');
      console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.error(error);
      console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      // Don't throw - let the worker continue for next scheduled run
    }
  },
};
