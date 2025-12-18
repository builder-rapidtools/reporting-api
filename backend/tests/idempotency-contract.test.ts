/**
 * Contract test for idempotency 409 behavior
 *
 * Tests that the API correctly enforces idempotency semantics:
 * - Same key + same payload = cached response with replayed: true
 * - Same key + different payload = 409 IDEMPOTENCY_KEY_REUSE_MISMATCH
 */

import { describe, test, expect } from 'vitest';

const BASE_URL = process.env.TEST_BASE_URL || 'https://reporting-tool-api.jamesredwards89.workers.dev';
const API_KEY = process.env.TEST_API_KEY;
const CLIENT_ID = process.env.TEST_CLIENT_ID;

// Skip tests if environment variables are not set
const shouldSkip = !API_KEY || !CLIENT_ID;

describe('Idempotency Contract Tests', () => {
  test.skipIf(shouldSkip)('should return cached response when same idempotency key is used with same payload', async () => {
    const idempotencyKey = `test-replay-${Date.now()}`;
    const payload = { test: 'original' };

    // First request - should succeed
    const response1 = await fetch(`${BASE_URL}/api/client/${CLIENT_ID}/report/send`, {
      method: 'POST',
      headers: {
        'x-api-key': API_KEY!,
        'content-type': 'application/json',
        'idempotency-key': idempotencyKey,
      },
      body: JSON.stringify(payload),
    });

    const data1 = await response1.json();

    expect(response1.status).toBe(200);
    expect(data1.ok).toBe(true);
    expect(data1.data).toBeDefined();
    expect(data1.data.clientId).toBe(CLIENT_ID);
    expect(data1.data.replayed).toBeUndefined(); // First request should not be replayed

    // Second request with same key and same payload - should return cached response
    const response2 = await fetch(`${BASE_URL}/api/client/${CLIENT_ID}/report/send`, {
      method: 'POST',
      headers: {
        'x-api-key': API_KEY!,
        'content-type': 'application/json',
        'idempotency-key': idempotencyKey,
      },
      body: JSON.stringify(payload),
    });

    const data2 = await response2.json();

    expect(response2.status).toBe(200);
    expect(data2.ok).toBe(true);
    expect(data2.data).toBeDefined();
    expect(data2.data.clientId).toBe(CLIENT_ID);
    expect(data2.data.replayed).toBe(true); // Second request should be replayed
    expect(data2.data.sentAt).toBe(data1.data.sentAt); // Same timestamp
    expect(data2.data.pdfKey).toBe(data1.data.pdfKey); // Same PDF
  });

  test.skipIf(shouldSkip)('should return 409 when same idempotency key is used with different payload', async () => {
    const idempotencyKey = `test-mismatch-${Date.now()}`;

    // First request with original payload
    const response1 = await fetch(`${BASE_URL}/api/client/${CLIENT_ID}/report/send`, {
      method: 'POST',
      headers: {
        'x-api-key': API_KEY!,
        'content-type': 'application/json',
        'idempotency-key': idempotencyKey,
      },
      body: JSON.stringify({ test: 'original' }),
    });

    const data1 = await response1.json();

    expect(response1.status).toBe(200);
    expect(data1.ok).toBe(true);
    expect(data1.data).toBeDefined();

    // Second request with same key but different payload - should get 409
    const response2 = await fetch(`${BASE_URL}/api/client/${CLIENT_ID}/report/send`, {
      method: 'POST',
      headers: {
        'x-api-key': API_KEY!,
        'content-type': 'application/json',
        'idempotency-key': idempotencyKey,
      },
      body: JSON.stringify({ test: 'different' }),
    });

    const data2 = await response2.json();

    expect(response2.status).toBe(409);
    expect(data2.ok).toBe(false);
    expect(data2.error).toBeDefined();
    expect(data2.error.code).toBe('IDEMPOTENCY_KEY_REUSE_MISMATCH');
    expect(data2.error.message).toContain('different request payload');
  });

  test.skipIf(shouldSkip)('should return 409 when empty body is changed to non-empty body', async () => {
    const idempotencyKey = `test-empty-to-nonempty-${Date.now()}`;

    // First request with empty body
    const response1 = await fetch(`${BASE_URL}/api/client/${CLIENT_ID}/report/send`, {
      method: 'POST',
      headers: {
        'x-api-key': API_KEY!,
        'content-type': 'application/json',
        'idempotency-key': idempotencyKey,
      },
      body: JSON.stringify({}),
    });

    const data1 = await response1.json();

    expect(response1.status).toBe(200);
    expect(data1.ok).toBe(true);

    // Second request with same key but non-empty body - should get 409
    const response2 = await fetch(`${BASE_URL}/api/client/${CLIENT_ID}/report/send`, {
      method: 'POST',
      headers: {
        'x-api-key': API_KEY!,
        'content-type': 'application/json',
        'idempotency-key': idempotencyKey,
      },
      body: JSON.stringify({ extra: 'data' }),
    });

    const data2 = await response2.json();

    expect(response2.status).toBe(409);
    expect(data2.ok).toBe(false);
    expect(data2.error.code).toBe('IDEMPOTENCY_KEY_REUSE_MISMATCH');
  });

  test.skipIf(shouldSkip)('should allow different idempotency keys with same payload', async () => {
    const payload = { test: 'same-payload' };

    // First request with key1
    const response1 = await fetch(`${BASE_URL}/api/client/${CLIENT_ID}/report/send`, {
      method: 'POST',
      headers: {
        'x-api-key': API_KEY!,
        'content-type': 'application/json',
        'idempotency-key': `test-key1-${Date.now()}`,
      },
      body: JSON.stringify(payload),
    });

    const data1 = await response1.json();

    expect(response1.status).toBe(200);
    expect(data1.ok).toBe(true);
    expect(data1.data.replayed).toBeUndefined();

    // Second request with different key but same payload - should succeed
    const response2 = await fetch(`${BASE_URL}/api/client/${CLIENT_ID}/report/send`, {
      method: 'POST',
      headers: {
        'x-api-key': API_KEY!,
        'content-type': 'application/json',
        'idempotency-key': `test-key2-${Date.now()}`,
      },
      body: JSON.stringify(payload),
    });

    const data2 = await response2.json();

    expect(response2.status).toBe(200);
    expect(data2.ok).toBe(true);
    expect(data2.data.replayed).toBeUndefined(); // New key = not replayed
    expect(data2.data.sentAt).not.toBe(data1.data.sentAt); // Different timestamp
  });
});
