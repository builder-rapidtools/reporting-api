/**
 * Health check endpoint handler
 */

import { Context } from 'hono';
import { Env, HealthCheckResponse } from '../types';

export async function handleHealthCheck(c: Context): Promise<Response> {
  const env = (c.env as Env).REPORTING_ENV || 'unknown';

  const response: HealthCheckResponse = {
    status: 'ok',
    env,
    timestamp: new Date().toISOString(),
  };

  return c.json(response);
}
