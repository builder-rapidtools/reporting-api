/**
 * PDF Token Signing and Verification
 * Hostile Audit Phase 2: Secure PDF access with signed URLs
 *
 * Token format: base64url(payload).base64url(signature)
 * Payload: { agencyId, clientId, filename, exp }
 * Signature: HMAC-SHA256(payload, PDF_SIGNING_SECRET)
 */

export interface PdfTokenPayload {
  agencyId: string;
  clientId: string;
  filename: string;
  exp: number; // Unix timestamp (seconds)
}

/**
 * Base64 URL encoding (RFC 4648)
 */
function base64urlEncode(data: ArrayBuffer): string {
  const base64 = btoa(String.fromCharCode(...new Uint8Array(data)));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Base64 URL decoding
 */
function base64urlDecode(str: string): ArrayBuffer {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(base64 + padding);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Sign a PDF token
 * Returns: token string (payload.signature)
 */
export async function signPdfToken(
  payload: PdfTokenPayload,
  secret: string
): Promise<string> {
  const payloadJson = JSON.stringify(payload);
  const payloadBytes = new TextEncoder().encode(payloadJson);
  const payloadB64 = base64urlEncode(payloadBytes);

  // Import secret key
  const keyData = new TextEncoder().encode(secret);
  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  // Sign payload
  const signature = await crypto.subtle.sign('HMAC', key, payloadBytes);
  const signatureB64 = base64urlEncode(signature);

  return `${payloadB64}.${signatureB64}`;
}

/**
 * Verify a PDF token
 * Returns: payload if valid, throws error if invalid
 */
export async function verifyPdfToken(
  token: string,
  secret: string
): Promise<PdfTokenPayload> {
  const parts = token.split('.');
  if (parts.length !== 2) {
    throw new Error('INVALID_TOKEN_FORMAT');
  }

  const [payloadB64, signatureB64] = parts;

  // Decode payload
  let payloadJson: string;
  let payload: PdfTokenPayload;
  try {
    const payloadBytes = base64urlDecode(payloadB64);
    payloadJson = new TextDecoder().decode(payloadBytes);
    payload = JSON.parse(payloadJson);
  } catch (error) {
    throw new Error('INVALID_TOKEN_PAYLOAD');
  }

  // Validate payload structure
  if (!payload.agencyId || !payload.clientId || !payload.filename || !payload.exp) {
    throw new Error('INVALID_TOKEN_PAYLOAD');
  }

  // Check expiration
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp <= now) {
    throw new Error('TOKEN_EXPIRED');
  }

  // Verify signature
  const payloadBytes = new TextEncoder().encode(payloadJson);

  const keyData = new TextEncoder().encode(secret);
  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );

  const providedSignature = base64urlDecode(signatureB64);
  const isValid = await crypto.subtle.verify('HMAC', key, providedSignature, payloadBytes);

  if (!isValid) {
    throw new Error('INVALID_TOKEN_SIGNATURE');
  }

  return payload;
}

/**
 * Generate a signed PDF URL
 * ttlSeconds: How long the URL is valid (default 15 minutes, max 60 minutes)
 */
export async function generateSignedPdfUrl(
  baseUrl: string,
  agencyId: string,
  clientId: string,
  filename: string,
  secret: string,
  ttlSeconds: number = 900 // 15 minutes default
): Promise<{ url: string; expiresAt: string }> {
  // Cap TTL at 60 minutes
  const cappedTtl = Math.min(ttlSeconds, 3600);
  const exp = Math.floor(Date.now() / 1000) + cappedTtl;

  const payload: PdfTokenPayload = {
    agencyId,
    clientId,
    filename,
    exp,
  };

  const token = await signPdfToken(payload, secret);

  // Construct URL: /reports/:agencyId/:clientId/:filename?token=...
  const url = `${baseUrl}/reports/${agencyId}/${clientId}/${filename}?token=${token}`;
  const expiresAt = new Date(exp * 1000).toISOString();

  return { url, expiresAt };
}
