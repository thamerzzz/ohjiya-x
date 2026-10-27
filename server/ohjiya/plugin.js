/**
 * Vite plugin: Ohjiya X accounts. Works under `vite` and `vite preview`.
 *
 *   GET  /auth/start?redirect_to=/path   begin sign-in at ohjiya.sa
 *   GET  /auth/consume                   return leg: verify token, set session
 *   POST /auth/logout                    end this site's session
 *   GET  /api/me                         who am I and what do I get
 *   POST /api/hooks/entitlement          signed notice from WordPress
 *   (all other /api routes)              gated by gate.js
 */
import { createHmac, randomBytes } from 'node:crypto';
import {
  SESSION_COOKIE,
  STATE_COOKIE,
  clearCookie,
  parseCookies,
  serializeCookie,
  signValue,
  verifyValue,
} from './cookies.js';
import { createEntitlementClient, FREE } from './entitlements.js';
import { decide, ruleForRequest, stripForwardingHeaders } from './gate.js';
import { createStore } from './store.js';
import { TokenError, safeEqual, verifyToken } from './token.js';

const STATE_TTL_SECONDS = 300;
const HOOK_WINDOW_SECONDS = 300;
const HOOK_MAX_BYTES = 8 * 1024;

const nowSeconds = () => Math.floor(Date.now() / 1000);

function json(res, status, body, extra = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extra,
  });
  res.end(JSON.stringify(body));
}

function redirect(res, location, cookies = []) {
  res.writeHead(302, {
    Location: location,
    'Cache-Control': 'no-store',
    ...(cookies.length ? { 'Set-Cookie': cookies } : {}),
  });
  res.end();
}

function failPage(res, status = 403) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">' +
      '<title>Ohjiya X</title><body style="font-family:system-ui;background:#0a0a0f;color:#e8eaed;padding:2rem">' +
      '<p>Sign-in could not be completed. <a style="color:#00d4ff" href="/auth/start">Try again</a>.</p>' +
      '<p dir="rtl">تعذّر إكمال تسجيل الدخول. <a style="color:#00d4ff" href="/auth/start">حاول مرة أخرى</a>.</p>',
  );
}

/** A local path only: leading single slash, no scheme, no backslash, no control characters. */
export function safeReturnPath(value) {
  const path = String(value ?? '/');
  if (
    !path.startsWith('/') ||
    path.startsWith('//') ||
    /[\\\u0000-\u001f]/.test(path) ||
    path.length > 512
  )
    return '/';
  if (path.startsWith('/auth/')) return '/';
  return path;
}

async function readBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('body too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function createAuthHandler(
  config,
  { store = createStore(config.dbPath), fetchImpl } = {},
) {
  const entitlements = createEntitlementClient({ config, store, fetchImpl });
  const secure = config.secureCookies;

  function session(req) {
    const cookies = parseCookies(req.headers.cookie);
    return verifyValue(cookies[SESSION_COOKIE], config.sessionSecret);
  }

  function sessionCookie(user) {
    const iat = nowSeconds();
    const value = signValue(
      {
        uid: user.uid,
        name: user.name,
        email: user.email,
        locale: user.locale,
        iat,
        exp: iat + config.sessionTtlSeconds,
      },
      config.sessionSecret,
    );
    return serializeCookie(SESSION_COOKIE, value, {
      maxAge: config.sessionTtlSeconds,
      secure,
    });
  }

  function sameOrigin(req) {
    const site = req.headers['sec-fetch-site'];
    if (site && site !== 'same-origin') return false;
    const origin = req.headers.origin;
    if (!origin) return true;
    try {
      return new URL(origin).hostname.toLowerCase() === config.appHost;
    } catch {
      return false;
    }
  }

  async function start(req, res, url) {
    const state = randomBytes(24).toString('base64url');
    const exp = nowSeconds() + STATE_TTL_SECONDS;
    const stateCookie = serializeCookie(
      STATE_COOKIE,
      signValue(
        {
          s: state,
          r: safeReturnPath(url.searchParams.get('redirect_to')),
          exp,
        },
        config.sessionSecret,
      ),
      { maxAge: STATE_TTL_SECONDS, secure },
    );
    const issue = new URL('/', config.wpUrl);
    issue.searchParams.set('oxe_sso', 'issue');
    issue.searchParams.set('return', `${config.appUrl}/auth/consume`);
    issue.searchParams.set('state', state);
    redirect(res, issue.toString(), [stateCookie]);
  }

  async function consume(req, res, url) {
    const cookies = parseCookies(req.headers.cookie);
    const pending = verifyValue(cookies[STATE_COOKIE], config.sessionSecret);
    const clearState = clearCookie(STATE_COOKIE, secure);
    const state = url.searchParams.get('state') ?? '';
    if (!pending || !safeEqual(pending.s, state)) return failPage(res);

    let payload;
    try {
      payload = verifyToken(
        url.searchParams.get('oxe_token'),
        config.ssoSecret,
        config.appHost,
      );
    } catch (error) {
      if (!(error instanceof TokenError)) throw error;
      return failPage(res);
    }
    if (!safeEqual(payload.state ?? '', pending.s)) return failPage(res);
    if (!store.markTokenUsed(payload.jti, nowSeconds() + 600))
      return failPage(res);

    redirect(res, safeReturnPath(pending.r), [
      sessionCookie({
        uid: payload.user_id,
        name: String(payload.name ?? '').slice(0, 120),
        email: String(payload.email ?? '').slice(0, 190),
        locale: String(payload.locale ?? 'en').slice(0, 16),
      }),
      clearState,
    ]);
  }

  async function me(req, res) {
    const current = session(req);
    if (!current)
      return json(res, 200, {
        signedIn: false,
        ...FREE,
        loginUrl: '/auth/start',
        registerUrl: `${config.wpUrl}/my-account/`,
      });
    const doc = await entitlements.get(current.uid);
    json(res, 200, {
      signedIn: true,
      user: {
        name: current.name,
        email: current.email,
        locale: current.locale,
      },
      company: doc.company,
      plan: doc.plan,
      features: doc.features,
      accountUrl: `${config.wpUrl}/my-account/ohjiya-x/`,
    });
  }

  async function hook(req, res) {
    let raw;
    try {
      raw = await readBody(req, HOOK_MAX_BYTES);
    } catch {
      return json(res, 413, { error: 'too_large' });
    }
    const ts = String(req.headers['x-oxe-timestamp'] ?? '');
    const given = String(req.headers['x-oxe-signature'] ?? '');
    const expected = createHmac('sha256', config.webhookSecret)
      .update(`${ts}.${raw}`)
      .digest('hex');
    if (
      !/^\d+$/.test(ts) ||
      Math.abs(nowSeconds() - Number(ts)) > HOOK_WINDOW_SECONDS ||
      !given ||
      !safeEqual(expected, given)
    ) {
      return json(res, 401, { error: 'bad_signature' });
    }
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return json(res, 400, { error: 'bad_json' });
    }
    const ids = (Array.isArray(body.user_ids) ? body.user_ids : [])
      .filter((id) => Number.isInteger(id) && id > 0)
      .slice(0, 500);
    entitlements.invalidate(ids);
    res.writeHead(204, { 'Cache-Control': 'no-store' });
    res.end();
  }

  async function gate(req, res, next) {
    const rule = ruleForRequest(req.url);
    if (!rule) return next();
    const current = session(req);
    const doc =
      current && !rule.deny ? await entitlements.get(current.uid) : FREE;
    const verdict = decide(rule, doc, Boolean(current));
    if (!verdict.ok)
      return json(res, verdict.status, {
        error: verdict.error,
        ...(verdict.feature ? { feature: verdict.feature } : {}),
      });
    if (rule.forwarded) stripForwardingHeaders(req.headers);
    next();
  }

  const handler = async (req, res, next) => {
    try {
      const url = new URL(req.url, config.appUrl);
      const { pathname } = url;
      const method = req.method;

      if (pathname === '/auth/start' && method === 'GET')
        return await start(req, res, url);
      if (pathname === '/auth/consume' && method === 'GET')
        return await consume(req, res, url);
      if (pathname === '/auth/logout' && method === 'POST') {
        if (!sameOrigin(req)) return json(res, 403, { error: 'cross_site' });
        return json(
          res,
          200,
          { ok: true },
          { 'Set-Cookie': clearCookie(SESSION_COOKIE, secure) },
        );
      }
      if (pathname === '/api/me' && method === 'GET') return await me(req, res);
      if (pathname === '/api/hooks/entitlement' && method === 'POST')
        return await hook(req, res);
      return await gate(req, res, next);
    } catch (error) {
      console.error('[ohjiya] request failed:', error);
      if (!res.headersSent) json(res, 500, { error: 'server_error' });
    }
  };
  return { handler, store, entitlements };
}

export function ohjiyaAuthPlugin(config) {
  const { handler } = createAuthHandler(config);
  const install = (server) => {
    server.middlewares.use(handler);
  };
  return {
    name: 'ohjiya-auth',
    configureServer: install,
    configurePreviewServer: install,
  };
}
