/** Signed cookies and Set-Cookie helpers. */
import { createHmac } from 'node:crypto';
import { b64url, safeEqual } from './token.js';

export const SESSION_COOKIE = 'ox_session';
export const STATE_COOKIE = 'ox_state';

export function parseCookies(header) {
  const out = {};
  for (const part of String(header ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0)
      out[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  return out;
}

/** value = base64url(json).base64url(hmac) */
export function signValue(payload, secret) {
  const body = b64url(JSON.stringify(payload));
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}

/** @returns {object|null} Payload if the signature holds and it has not expired. */
export function verifyValue(
  value,
  secret,
  nowSeconds = Math.floor(Date.now() / 1000),
) {
  if (typeof value !== 'string' || !value.includes('.') || value.length > 4096)
    return null;
  const [body, signature] = value.split('.', 2);
  const expected = createHmac('sha256', secret)
    .update(body)
    .digest('base64url');
  if (!signature || !safeEqual(expected, signature)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload || typeof payload !== 'object') return null;
    if (!Number.isFinite(payload.exp) || payload.exp <= nowSeconds) return null;
    return payload;
  } catch {
    return null;
  }
}

export function serializeCookie(name, value, { maxAge, secure }) {
  return [
    `${name}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    secure ? 'Secure' : '',
    `Max-Age=${maxAge}`,
  ]
    .filter(Boolean)
    .join('; ');
}

export function clearCookie(name, secure) {
  return serializeCookie(name, '', { maxAge: 0, secure });
}
