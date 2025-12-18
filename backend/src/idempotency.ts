/**
 * Idempotency support for send_report endpoint
 *
 * Operating Principle: Optional idempotency via Idempotency-Key header
 * - When Idempotency-Key header is present, prevent duplicate email sends
 * - Store idempotency records in KV with 86400s TTL
 * - Return 409 on key reuse with different payload
 */

import { KVNamespace } from '@cloudflare/workers-types';

export interface IdempotencyRecord {
  key: string;
  agencyId: string;
  clientId: string;
  requestHash: string;
  response: any;
  createdAt: string;
}

export interface IdempotencyCheckResult {
  isReplay: boolean;
  record?: IdempotencyRecord;
  payloadMismatch?: boolean;
}

/**
 * Check if an idempotency key has been used before
 */
export async function checkIdempotencyKey(
  kv: KVNamespace,
  idempotencyKey: string,
  agencyId: string,
  clientId: string,
  requestPayload: any
): Promise<IdempotencyCheckResult> {
  // Construct KV key: idempotency:{agencyId}:{clientId}:{key}
  const kvKey = `idempotency:${agencyId}:${clientId}:${idempotencyKey}`;

  // Check if key exists
  const existingRecord = await kv.get(kvKey);

  if (!existingRecord) {
    // Key not found - this is a new request
    return { isReplay: false };
  }

  // Parse existing record
  const record: IdempotencyRecord = JSON.parse(existingRecord);

  // Compute hash of current request payload
  const currentHash = await hashPayload(requestPayload);

  // Check if payload matches
  if (record.requestHash !== currentHash) {
    // Key reused with different payload - conflict
    return {
      isReplay: true,
      record,
      payloadMismatch: true,
    };
  }

  // Payload matches - return cached response
  return {
    isReplay: true,
    record,
    payloadMismatch: false,
  };
}

/**
 * Store idempotency record for successful request
 */
export async function storeIdempotencyRecord(
  kv: KVNamespace,
  idempotencyKey: string,
  agencyId: string,
  clientId: string,
  requestPayload: any,
  response: any
): Promise<void> {
  const kvKey = `idempotency:${agencyId}:${clientId}:${idempotencyKey}`;

  const record: IdempotencyRecord = {
    key: idempotencyKey,
    agencyId,
    clientId,
    requestHash: await hashPayload(requestPayload),
    response,
    createdAt: new Date().toISOString(),
  };

  // Store with 86400s TTL (24 hours)
  await kv.put(kvKey, JSON.stringify(record), { expirationTtl: 86400 });
}

/**
 * Hash request payload for comparison
 * Uses SHA-256 to create deterministic hash
 */
async function hashPayload(payload: any): Promise<string> {
  // Normalize payload by sorting keys recursively and stringifying
  const normalized = JSON.stringify(payload, (key, value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      // Sort object keys alphabetically
      return Object.keys(value)
        .sort()
        .reduce((sorted: any, k) => {
          sorted[k] = value[k];
          return sorted;
        }, {});
    }
    return value;
  });

  // Use Web Crypto API (available in Cloudflare Workers)
  const encoder = new TextEncoder();
  const data = encoder.encode(normalized);

  // Compute SHA-256 hash
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);

  // Convert to hex string
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

  return hashHex;
}
