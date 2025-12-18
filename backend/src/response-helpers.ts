/**
 * RapidTools v1 API Response Envelope Helpers
 *
 * Standardizes all API responses to the v1 contract:
 * - Success: { ok: true, data: {...} }
 * - Error: { ok: false, error: { code: string, message: string } }
 */

import { Context } from 'hono';

/**
 * Standard success response envelope
 */
export interface OkResponse<T = any> {
  ok: true;
  data: T;
}

/**
 * Standard error response envelope
 */
export interface FailResponse {
  ok: false;
  error: {
    code: string;
    message: string;
    request_id?: string;
  };
}

/**
 * Return a success response with RapidTools v1 envelope
 *
 * @param c Hono context
 * @param data Response data payload
 * @param status HTTP status code (default: 200)
 */
export function ok<T>(c: Context, data: T, status: number = 200): Response {
  const response: OkResponse<T> = {
    ok: true,
    data,
  };
  return c.json(response, status);
}

/**
 * Return an error response with RapidTools v1 envelope
 *
 * @param c Hono context
 * @param code Error code (e.g., "UNAUTHORIZED", "INVALID_INPUT")
 * @param message Human-readable error message
 * @param status HTTP status code
 * @param requestId Optional request ID for traceability
 */
export function fail(
  c: Context,
  code: string,
  message: string,
  status: number,
  requestId?: string
): Response {
  const response: FailResponse = {
    ok: false,
    error: {
      code,
      message,
      ...(requestId && { request_id: requestId }),
    },
  };
  return c.json(response, status);
}
