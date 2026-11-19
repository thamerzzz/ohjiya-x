/**
 * Ohjiya X account configuration. Off unless OHJIYA_AUTH is on, so the app
 * still runs locally and in Pinokio exactly as upstream does.
 *
 * Turned on, every secret must be present and at least 32 characters, or the
 * server refuses to start: a half-configured sign-in must never fall back to
 * open access.
 */
import { quotasFromEnv } from './quota.js';

const MIN_SECRET = 32;
const SECRETS = [
  'OXE_SSO_SECRET',
  'OXE_API_SECRET',
  'OXE_WEBHOOK_SECRET',
  'OHJIYA_SESSION_SECRET',
];

export function authEnabled(env = process.env) {
  return /^(1|on|true|yes)$/i.test(String(env.OHJIYA_AUTH ?? '').trim());
}

/** @returns {object|null} Config, or null when accounts are off. */
export function loadOhjiyaConfig(env = process.env) {
  if (!authEnabled(env)) return null;

  const problems = [];
  const url = (name) => {
    try {
      const parsed = new URL(String(env[name] ?? ''));
      if (!/^https?:$/.test(parsed.protocol)) throw new Error('scheme');
      return parsed;
    } catch {
      problems.push(`${name} must be an http(s) URL`);
      return null;
    }
  };
  const appUrl = url('OHJIYA_APP_URL');
  const wpUrl = url('OHJIYA_WP_URL');
  for (const name of SECRETS) {
    if (String(env[name] ?? '').length < MIN_SECRET) {
      problems.push(`${name} must be at least ${MIN_SECRET} characters`);
    }
  }
  // Atlas AI endpoint: optional. https only (plain http only for this machine).
  let assistantUrl = '';
  if (String(env.ATLAS_AI_URL ?? '').trim()) {
    try {
      const parsed = new URL(env.ATLAS_AI_URL);
      const local = ['localhost', '127.0.0.1', '[::1]'].includes(
        parsed.hostname,
      );
      if (
        parsed.protocol !== 'https:' &&
        !(parsed.protocol === 'http:' && local)
      )
        throw new Error('scheme');
      assistantUrl = parsed.href;
    } catch {
      problems.push('ATLAS_AI_URL must be an https URL');
    }
  }
  if (problems.length) {
    throw new Error(
      `Ohjiya accounts are on but misconfigured: ${problems.join('; ')}`,
    );
  }

  return Object.freeze({
    appUrl: appUrl.origin,
    appHost: appUrl.hostname.toLowerCase(),
    secureCookies: appUrl.protocol === 'https:',
    wpUrl: wpUrl.origin,
    ssoSecret: env.OXE_SSO_SECRET,
    apiSecret: env.OXE_API_SECRET,
    webhookSecret: env.OXE_WEBHOOK_SECRET,
    sessionSecret: env.OHJIYA_SESSION_SECRET,
    assistantUrl,
    assistantKey: String(env.ATLAS_AI_KEY ?? ''),
    quotas: quotasFromEnv(env),
    dbPath: env.OHJIYA_DB_PATH || '.gev-cache/ohjiya-auth.db',
    sessionTtlSeconds: 12 * 60 * 60,
    entitlementTtlMs: 10 * 60 * 1000,
    entitlementStaleMs: 24 * 60 * 60 * 1000,
  });
}
