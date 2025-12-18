/**
 * Client CRUD handlers
 */

import { Context } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import { Env, Client, CreateClientRequest } from '../types';
import { Storage } from '../storage';
import { requireAgencyAuth, requireActiveSubscription, AuthError } from '../auth';
import { ok, fail } from '../response-helpers';

/**
 * POST /api/client
 * Create or update a client
 */
export async function handleCreateClient(c: Context): Promise<Response> {
  const env = c.env as Env;
  const storage = new Storage(env.REPORTING_KV, env.REPORTING_R2);

  try {
    // Require authentication and active subscription
    const { agency } = await requireAgencyAuth(c.req.raw, env);
    requireActiveSubscription(agency);

    const body = await c.req.json<CreateClientRequest>();

    // Validate required fields
    if (!body.name || !body.email) {
      return fail(c, 'MISSING_REQUIRED_FIELDS', 'Missing required fields: name, email', 400);
    }

    // Email validation (basic)
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(body.email)) {
      return fail(c, 'INVALID_EMAIL', 'Invalid email format', 400);
    }

    const client: Client = {
      id: uuidv4(),
      agencyId: agency.id,
      name: body.name,
      email: body.email,
      brandLogoUrl: body.brandLogoUrl,
      reportSchedule: body.reportSchedule || 'weekly',
      createdAt: new Date().toISOString(),
    };

    await storage.saveClient(client);

    return ok(c, {
      client,
      nextSteps: {
        uploadCsv: `/api/client/${client.id}/ga4-csv`,
        sendReport: `/api/client/${client.id}/report/send`,
      },
    }, 201);
  } catch (error) {
    if (error instanceof AuthError) {
      return c.json(error.toJSON(), error.statusCode);
    }

    return fail(c, 'INTERNAL_ERROR', error instanceof Error ? error.message : 'Unknown error', 500);
  }
}

/**
 * GET /api/clients
 * List all clients for authenticated agency
 */
export async function handleListClients(c: Context): Promise<Response> {
  const env = c.env as Env;
  const storage = new Storage(env.REPORTING_KV, env.REPORTING_R2);

  try {
    // Require authentication
    const { agency } = await requireAgencyAuth(c.req.raw, env);

    const clients = await storage.listClients(agency.id);

    return ok(c, { clients });
  } catch (error) {
    if (error instanceof AuthError) {
      return c.json(error.toJSON(), error.statusCode);
    }

    return fail(c, 'INTERNAL_ERROR', error instanceof Error ? error.message : 'Unknown error', 500);
  }
}

/**
 * DELETE /api/client/:id
 * Delete a client
 */
export async function handleDeleteClient(c: Context): Promise<Response> {
  const env = c.env as Env;
  const storage = new Storage(env.REPORTING_KV, env.REPORTING_R2);

  try {
    // Require authentication
    const { agency } = await requireAgencyAuth(c.req.raw, env);

    const clientId = c.req.param('id');

    if (!clientId) {
      return fail(c, 'MISSING_CLIENT_ID', 'Missing client ID', 400);
    }

    // Verify client exists and belongs to agency
    const client = await storage.getClient(clientId);
    if (!client) {
      return fail(c, 'CLIENT_NOT_FOUND', 'Client not found', 404);
    }

    if (client.agencyId !== agency.id) {
      return fail(c, 'FORBIDDEN', 'Unauthorized', 403);
    }

    await storage.deleteClient(clientId);

    return ok(c, { deleted: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return c.json(error.toJSON(), error.statusCode);
    }

    return fail(c, 'INTERNAL_ERROR', error instanceof Error ? error.message : 'Unknown error', 500);
  }
}
