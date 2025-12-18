/**
 * API Router
 * Maps HTTP endpoints to handlers
 */

import { Hono } from 'hono';
import { Env } from './types';
import { handleHealthCheck } from './handlers/health';
import { handleCreateClient, handleListClients, handleDeleteClient } from './handlers/clients';
import { handleUploadGA4Csv } from './handlers/uploads';
import { handleReportPreview, handleReportSend } from './handlers/reports';
import { handleRegisterAgency, handleGetAgency } from './handlers/agency';
import { handleCreateCheckoutSession, handleStripeWebhookEndpoint } from './handlers/stripe';
import { handlePdfDownload } from './handlers/pdf-download';
import { handleRotateAgencyKey } from './handlers/admin-rotate-agency-key';
import { handleGenerateSignedPdfUrl } from './handlers/signed-pdf-url';
import { getRequestId, addTraceabilityHeaders } from './request-id';

export function createRouter() {
  const app = new Hono();

  // Global middleware: Add request ID to context and traceability headers to all responses
  app.use('*', async (c, next) => {
    const requestId = getRequestId(c);
    c.set('requestId', requestId);
    await next();
    // Add headers to response
    c.res = addTraceabilityHeaders(c.res, requestId);
  });

  // Health check
  app.get('/api/health', handleHealthCheck);

  // Agency management
  app.post('/api/agency/register', handleRegisterAgency);
  app.get('/api/agency/me', handleGetAgency);
  app.post('/api/agency/checkout', handleCreateCheckoutSession);
  app.post('/api/agency/stripe/webhook', handleStripeWebhookEndpoint);

  // Admin operations
  app.post('/api/admin/agency/:agencyId/rotate-key', handleRotateAgencyKey);

  // Client management
  app.post('/api/client', handleCreateClient);
  app.get('/api/clients', handleListClients);
  app.delete('/api/client/:id', handleDeleteClient);

  // Data upload
  app.post('/api/client/:id/ga4-csv', handleUploadGA4Csv);

  // Report generation
  app.post('/api/client/:id/report/preview', handleReportPreview);
  app.post('/api/client/:id/report/send', handleReportSend);

  // Hostile Audit Phase 2: Signed PDF URL generation
  app.post('/api/reports/:clientId/:filename/signed-url', handleGenerateSignedPdfUrl);

  // PDF download routes (Hostile Audit Phase 2: Requires signed token)
  // Support both single and double /reports/ path for backwards compatibility
  app.get('/reports/reports/:agencyId/:clientId/:filename', handlePdfDownload);
  app.get('/reports/:agencyId/:clientId/:filename', handlePdfDownload);

  // 404 handler
  app.notFound((c) => {
    const requestId = c.get('requestId') as string | undefined;
    return c.json({
      ok: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Not found',
        ...(requestId && { request_id: requestId }),
      },
    }, 404);
  });

  // Error handler
  app.onError((err, c) => {
    console.error('Unhandled error:', err);
    const requestId = c.get('requestId') as string | undefined;
    return c.json({
      ok: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
        ...(requestId && { request_id: requestId }),
      },
    }, 500);
  });

  return app;
}
