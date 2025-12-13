/**
 * Client CRUD handlers
 */

import { Context } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import { Env, Client, CreateClientRequest, CreateClientResponse, ListClientsResponse } from '../types';
import { Storage } from '../storage';
import { requireAgencyAuth, requireActiveSubscription } from '../auth';

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
      const response: CreateClientResponse = {
        success: false,
        error: 'Missing required fields: name, email',
      };
      return c.json(response, 400);
    }

    // Email validation (basic)
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(body.email)) {
      const response: CreateClientResponse = {
        success: false,
        error: 'Invalid email format',
      };
      return c.json(response, 400);
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

    const response: CreateClientResponse = {
      success: true,
      client,
    };

    return c.json(response, 201);
  } catch (error) {
    if (error instanceof Error && error.name === 'AuthError') {
      return c.json({ success: false, error: error.message, ...(error as any).metadata }, (error as any).statusCode || 401);
    }

    const response: CreateClientResponse = {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
    return c.json(response, 500);
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

    const response: ListClientsResponse = {
      success: true,
      clients,
    };

    return c.json(response);
  } catch (error) {
    if (error instanceof Error && error.name === 'AuthError') {
      return c.json({ success: false, error: error.message }, (error as any).statusCode || 401);
    }

    const response: ListClientsResponse = {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
    return c.json(response, 500);
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
      return c.json({ success: false, error: 'Missing client ID' }, 400);
    }

    // Verify client exists and belongs to agency
    const client = await storage.getClient(clientId);
    if (!client) {
      return c.json({ success: false, error: 'Client not found' }, 404);
    }

    if (client.agencyId !== agency.id) {
      return c.json({ success: false, error: 'Unauthorized' }, 403);
    }

    await storage.deleteClient(clientId);

    return c.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.name === 'AuthError') {
      return c.json({ success: false, error: error.message }, (error as any).statusCode || 401);
    }

    return c.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
}
