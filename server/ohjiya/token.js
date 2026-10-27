/**
 * Verify the sign-in token issued by the WordPress plugin
 * (wordpress/ohjiya-x-entitlements/includes/class-oxe-token.php).
 *
 * Format: base64url(json) . base64url(hmac_sha256(body, secret)).
 * Valid 120 s after issue, bound to this app's host, single use (jti).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const TOKEN_TTL_SECONDS = 120;
export const TOKEN_LEEWAY_SECONDS = 60;

export class TokenError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export function b64url(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

export function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

/** @returns {object} The verified payload; throws TokenError otherwise. */
export function verifyToken(
  token,
  secret,
  audience,
  nowSeconds = Math.floor(Date.now() / 1000),
) {
  if (
    typeof token !== 'string' ||
    !token.includes('.') ||
    token.length > 4096
  ) {
    throw new TokenError('malformed');
  }
  const [body, signature] = token.split('.', 2);
  const expected = createHmac('sha256', secret)
    .update(body)
    .digest('base64url');
  if (!signature || !safeEqual(expected, signature))
    throw new TokenError('bad_signature');

  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    throw new TokenError('bad_payload');
  }
  if (!payload || typeof payload !== 'object')
    throw new TokenError('bad_payload');

  const iat = Number(payload.iat);
  if (!Number.isFinite(iat) || iat <= 0) throw new TokenError('expired');
  if (
    nowSeconds - iat > TOKEN_TTL_SECONDS ||
    iat - nowSeconds > TOKEN_LEEWAY_SECONDS
  ) {
    throw new TokenError('expired');
  }
  if (typeof payload.jti !== 'string' || payload.jti.length < 16)
    throw new TokenError('bad_payload');
  if (
    String(payload.aud ?? '').toLowerCase() !== String(audience).toLowerCase()
  ) {
    throw new TokenError('bad_audience');
  }
  if (!Number.isInteger(payload.user_id) || payload.user_id <= 0)
    throw new TokenError('bad_payload');
  return payload;
}

/** Test helper that builds a token the way the WordPress plugin does. */
export function signToken(payload, secret) {
  const body = b64url(JSON.stringify(payload));
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}
