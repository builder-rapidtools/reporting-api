/**
 * Health check endpoint handler
 */

import { Context } from 'hono';
import { Env } from '../types';
import { ok } from '../response-helpers';

export async function handleHealthCheck(c: Context): Promise<Response> {
  const env = (c.env as Env).REPORTING_ENV || 'unknown';

  return ok(c, {
    status: 'ok',
    env,
    timestamp: new Date().toISOString(),
  });
}
