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

export function createRouter() {
  const app = new Hono();

  // Health check
  app.get('/api/health', handleHealthCheck);

  // Agency management
  app.post('/api/agency/register', handleRegisterAgency);
  app.get('/api/agency/me', handleGetAgency);
  app.post('/api/agency/checkout', handleCreateCheckoutSession);
  app.post('/api/agency/stripe/webhook', handleStripeWebhookEndpoint);

  // Client management
  app.post('/api/client', handleCreateClient);
  app.get('/api/clients', handleListClients);
  app.delete('/api/client/:id', handleDeleteClient);

  // Data upload
  app.post('/api/client/:id/ga4-csv', handleUploadGA4Csv);

  // Report generation
  app.post('/api/client/:id/report/preview', handleReportPreview);
  app.post('/api/client/:id/report/send', handleReportSend);

  // 404 handler
  app.notFound((c) => {
    return c.json({
      success: false,
      error: 'Not found',
    }, 404);
  });

  // Error handler
  app.onError((err, c) => {
    console.error('Unhandled error:', err);
    return c.json({
      success: false,
      error: 'Internal server error',
    }, 500);
  });

  return app;
}
