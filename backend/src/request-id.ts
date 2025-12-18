/**
 * Request ID generation and traceability headers
 * Operating Principle: Machine-first observability
 */

import { Context } from 'hono';

/**
 * Generate a unique request ID using crypto.randomUUID
 */
export function generateRequestId(): string {
  return crypto.randomUUID();
}

/**
 * Get or generate request ID for a request
 * Checks for X-Request-Id header, otherwise generates new one
 */
export function getRequestId(c: Context): string {
  // Check if client provided a request ID (for request tracing)
  const clientRequestId = c.req.header('x-request-id');
  if (clientRequestId && clientRequestId.length > 0 && clientRequestId.length < 256) {
    return clientRequestId;
  }

  // Generate new request ID
  return generateRequestId();
}

/**
 * Add traceability headers to response
 * - X-Request-Id: unique request identifier
 * - X-RateLimit-*: advisory rate limit headers (not enforced)
 */
export function addTraceabilityHeaders(response: Response, requestId: string): Response {
  const headers = new Headers(response.headers);

  // Request ID for tracing
  headers.set('X-Request-Id', requestId);

  // Advisory rate limit headers (from manifest: 60/min, not enforced)
  headers.set('X-RateLimit-Limit', '60');
  headers.set('X-RateLimit-Policy', 'advisory; enforced=false');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
