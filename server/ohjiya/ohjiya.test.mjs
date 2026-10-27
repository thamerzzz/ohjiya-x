import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import http from 'node:http';
import test from 'node:test';
import { authEnabled, loadOhjiyaConfig } from './config.js';
import { createAuthHandler, safeReturnPath } from './plugin.js';
import { createEntitlementClient, FREE } from './entitlements.js';
import { decide, ruleForRequest, stripForwardingHeaders } from './gate.js';
import { createStore } from './store.js';
import { TokenError, signToken, verifyToken } from './token.js';

const S = (c) => c.repeat(40);
const ENV = {
  OHJIYA_AUTH: 'on',
  OHJIYA_APP_URL: 'https://x.ohjiya.sa',
  OHJIYA_WP_URL: 'https://ohjiya.sa',
  OXE_SSO_SECRET: S('s'),
  OXE_API_SECRET: S('a'),
  OXE_WEBHOOK_SECRET: S('w'),
  OHJIYA_SESSION_SECRET: S('k'),
  OHJIYA_DB_PATH: ':memory:',
};
const config = () => loadOhjiyaConfig(ENV);
const now = () => Math.floor(Date.now() / 1000);
const goodPayload = (over = {}) => ({ user_id: 42, email: 'a@b.sa', name: 'Ali', locale: 'ar', state: 'st'.repeat(16), iat: now(), jti: 'j'.repeat(32), aud: 'x.ohjiya.sa', ...over });

test('config is off by default and fails closed when half-configured', () => {
  assert.equal(authEnabled({}), false);
  assert.equal(loadOhjiyaConfig({}), null);
  assert.throws(() => loadOhjiyaConfig({ OHJIYA_AUTH: 'on' }), /misconfigured/);
  assert.throws(() => loadOhjiyaConfig({ ...ENV, OXE_SSO_SECRET: 'short' }), /OXE_SSO_SECRET/);
  assert.equal(config().appHost, 'x.ohjiya.sa');
  assert.equal(config().secureCookies, true);
});

test('token: accepts a good token and rejects every bad one', () => {
  const secret = S('s');
  const t = signToken(goodPayload(), secret);
  assert.equal(verifyToken(t, secret, 'x.ohjiya.sa').user_id, 42);
  const code = (fn) => { try { fn(); } catch (e) { assert.ok(e instanceof TokenError); return e.code; } return 'accepted'; };
  assert.equal(code(() => verifyToken(t, S('z'), 'x.ohjiya.sa')), 'bad_signature');
  assert.equal(code(() => verifyToken(t, secret, 'evil.example')), 'bad_audience');
  assert.equal(code(() => verifyToken(signToken(goodPayload({ iat: now() - 500 }), secret), secret, 'x.ohjiya.sa')), 'expired');
  assert.equal(code(() => verifyToken(signToken(goodPayload({ iat: now() + 500 }), secret), secret, 'x.ohjiya.sa')), 'expired');
  assert.equal(code(() => verifyToken(signToken(goodPayload({ user_id: 'x' }), secret), secret, 'x.ohjiya.sa')), 'bad_payload');
  assert.equal(code(() => verifyToken('nodot', secret, 'x.ohjiya.sa')), 'malformed');
  const tampered = t.replace(/^[^.]+/, (b) => Buffer.from(Buffer.from(b, 'base64url').toString().replace('42', '43')).toString('base64url'));
  assert.equal(code(() => verifyToken(tampered, secret, 'x.ohjiya.sa')), 'bad_signature');
});

test('return path is always local', () => {
  assert.equal(safeReturnPath('/#v=2&lat=1'), '/#v=2&lat=1');
  for (const bad of ['//evil.example', 'https://evil.example', '/\\evil', 'javascript:1', '/auth/start', '/a\nb', '']) {
    assert.equal(safeReturnPath(bad), '/', bad);
  }
});

test('gate: routes, bypass attempts, and verdicts', () => {
  assert.equal(ruleForRequest('/api/launches'), null);
  for (const u of ['/api/realtime/token', '/API/REALTIME/token', '/api\\realtime\\token', 'http://h/api/realtime/token?a=1', '/api/x/../realtime/token', '/api/%72ealtime/token', '/api/gemini/token', '/api/openai/hud-summary', '/api/tomtom/t/1/2/3', '/api/mapillary/tiles']) {
    assert.ok(ruleForRequest(u), u);
  }
  assert.equal(ruleForRequest('/api/setup/keys').deny, true);
  const voice = ruleForRequest('/api/realtime/token');
  const paid = ruleForRequest('/api/mapillary/tiles');
  const active = { plan: { status: 'active' }, features: ['voice', 'chat'] };
  const grace = { plan: { status: 'grace' }, features: [] };
  assert.equal(decide(voice, FREE, false).status, 401);
  assert.equal(decide(voice, FREE, true).status, 402);
  assert.equal(decide(voice, grace, true).status, 402);
  assert.equal(decide(voice, active, true).ok, true);
  assert.equal(decide(paid, { plan: { status: 'active' }, features: [] }, true).ok, true);
  assert.equal(decide(paid, grace, true).status, 402);
  assert.equal(decide(ruleForRequest('/api/setup/x'), active, true).status, 404);
  const headers = { 'x-forwarded-for': '1.1.1.1', via: 'x', 'x-real-ip': '1', cookie: 'a=b' };
  stripForwardingHeaders(headers);
  assert.deepEqual(headers, { cookie: 'a=b' });
});

function fakeWp(docs) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    const u = new URL(url);
    const user = u.searchParams.get('user');
    const ts = opts.headers['X-OXE-Timestamp'];
    const expect = createHmac('sha256', S('a')).update(`${ts}.${user}`).digest('hex');
    calls.push({ user, ok: expect === opts.headers['X-OXE-Signature'] });
    if (docs.fail) throw new Error('down');
    return { ok: true, status: 200, json: async () => docs[user] ?? FREE };
  };
  return { fetchImpl, calls };
}
const PAID = { company: { id: 1, name: 'Co', role: 'owner' }, plan: { edition: 'real_estate', status: 'active', expires: '2027-01-01', seats: 5 }, features: ['voice', 'chat'] };

test('entitlement client: signs requests, caches, serves stale, then falls to free', async () => {
  let t = 1_000_000;
  const docs = { 42: PAID };
  const wp = fakeWp(docs);
  const store = createStore();
  const c = createEntitlementClient({ config: config(), store, fetchImpl: wp.fetchImpl, now: () => t, log() {} });
  assert.deepEqual((await c.get(42)).features, ['voice', 'chat']);
  assert.equal(wp.calls[0].ok, true);
  await c.get(42);
  assert.equal(wp.calls.length, 1, 'second call is cached');
  c.invalidate([42]);
  await c.get(42);
  assert.equal(wp.calls.length, 2, 'invalidate forces a refetch');
  docs.fail = true;
  t += config().entitlementTtlMs + 1;
  assert.equal((await c.get(42)).plan.status, 'active', 'stale answer while WordPress is down');
  t += config().entitlementStaleMs + 1;
  assert.equal((await c.get(42)).plan.status, 'none', 'free after the stale window');
  assert.equal((await c.get(99)).plan.status, 'none', 'unknown user while down is free');
});

async function serve(handler) {
  const server = http.createServer((req, res) => handler(req, res, () => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ reached: req.url, fwd: req.headers['x-forwarded-for'] ?? null })); }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}
const get = (url, headers = {}, method = 'GET', body) => fetch(url, { method, headers, body, redirect: 'manual' });
const cookieOf = (res, name) => (res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`)) ?? '').split(';')[0];

test('end to end: sign-in flow, session, gating, replay and webhook', async () => {
  const docs = { 42: PAID };
  const wp = fakeWp(docs);
  const { handler, store } = createAuthHandler(config(), { store: createStore(), fetchImpl: wp.fetchImpl });
  const { server, base } = await serve(handler);
  try {
    // Anonymous: /api/me is free, open routes pass, gated routes want sign-in.
    const anon = await (await get(`${base}/api/me`)).json();
    assert.equal(anon.signedIn, false);
    assert.equal((await get(`${base}/api/launches`)).status, 200);
    assert.equal((await get(`${base}/api/realtime/token`)).status, 401);
    assert.equal((await get(`${base}/api/setup/status`)).status, 404);

    // Start: redirect to WordPress with state, state cookie set.
    const start = await get(`${base}/auth/start?redirect_to=/%23v=2`);
    assert.equal(start.status, 302);
    const issue = new URL(start.headers.get('location'));
    assert.equal(issue.origin, 'https://ohjiya.sa');
    assert.equal(issue.searchParams.get('oxe_sso'), 'issue');
    assert.equal(issue.searchParams.get('return'), 'https://x.ohjiya.sa/auth/consume');
    const state = issue.searchParams.get('state');
    const stateCookie = cookieOf(start, 'ox_state');

    // Wrong browser (no state cookie) and wrong state are refused.
    const token = signToken(goodPayload({ state }), S('s'));
    assert.equal((await get(`${base}/auth/consume?oxe_token=${token}&state=${state}`)).status, 403);
    assert.equal((await get(`${base}/auth/consume?oxe_token=${token}&state=other`, { cookie: stateCookie })).status, 403);

    // Good return leg: session cookie, redirected to the saved local path.
    const ok = await get(`${base}/auth/consume?oxe_token=${token}&state=${state}`, { cookie: stateCookie });
    assert.equal(ok.status, 302);
    assert.equal(ok.headers.get('location'), '/#v=2');
    const session = cookieOf(ok, 'ox_session');
    assert.ok(session.length > 20);
    assert.ok(ok.headers.getSetCookie().find((c) => c.startsWith('ox_session=')).includes('HttpOnly'));

    // The same token cannot be replayed.
    assert.equal((await get(`${base}/auth/consume?oxe_token=${token}&state=${state}`, { cookie: stateCookie })).status, 403);

    // Signed in and paid: /api/me shows the plan; voice passes with forwarding headers stripped.
    const me = await (await get(`${base}/api/me`, { cookie: session })).json();
    assert.equal(me.signedIn, true);
    assert.equal(me.plan.edition, 'real_estate');
    assert.deepEqual(me.features, ['voice', 'chat']);
    const voice = await (await get(`${base}/api/realtime/token`, { cookie: session, 'x-forwarded-for': '9.9.9.9' })).json();
    assert.equal(voice.reached, '/api/realtime/token');
    assert.equal(voice.fwd, null);

    // A forged session cookie is just anonymous.
    const forged = session.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'));
    assert.equal((await get(`${base}/api/realtime/token`, { cookie: forged })).status, 401);

    // Plan lapses: webhook (signed) clears the cache, voice then needs a plan.
    docs[42] = { company: PAID.company, plan: { ...PAID.plan, status: 'expired' }, features: [] };
    const send = (ts, sig, body) => get(`${base}/api/hooks/entitlement`, { 'x-oxe-timestamp': String(ts), 'x-oxe-signature': sig, 'content-type': 'application/json' }, 'POST', body);
    const body = JSON.stringify({ user_ids: [42], version: 5 });
    const sig = (ts, b) => createHmac('sha256', S('w')).update(`${ts}.${b}`).digest('hex');
    assert.equal((await send(now(), 'bad', body)).status, 401);
    assert.equal((await send(now() - 3600, sig(now() - 3600, body), body)).status, 401, 'stale timestamp');
    assert.equal((await send(now(), sig(now(), body), body)).status, 204);
    assert.equal((await get(`${base}/api/realtime/token`, { cookie: session })).status, 402);

    // Logout needs a same-origin request.
    assert.equal((await get(`${base}/auth/logout`, { origin: 'https://evil.example' }, 'POST')).status, 403);
    const out = await get(`${base}/auth/logout`, { origin: 'https://x.ohjiya.sa' }, 'POST');
    assert.equal(out.status, 200);
    assert.match(out.headers.getSetCookie()[0], /ox_session=;.*Max-Age=0/);
  } finally {
    server.close();
    store.close();
  }
});
