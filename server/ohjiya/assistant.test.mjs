import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { AssistantError, cleanProposals, createAssistant, summarizeLibrary } from './assistant.js';
import { loadOhjiyaConfig } from './config.js';
import { SESSION_COOKIE, signValue } from './cookies.js';
import { createAuthHandler } from './plugin.js';
import { createStore } from './store.js';

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

test('proposals: only the two known kinds survive, cleaned and bounded', () => {
  const out = cleanProposals([
    { kind: 'add_place', title: 'Add Rival', place: { name: ' Rival  Cafe ', tag: 'competitor', status: 'attention', lat: 24.7, lon: 46.7 } },
    { kind: 'add_place', place: { name: 'Odd tag', tag: 'secret', status: 'nope', lat: 1, lon: 2 } },
    { kind: 'add_place', place: { name: 'Off globe', lat: 95, lon: 2 } },
    { kind: 'add_place', place: { name: '', lat: 1, lon: 2 } },
    { kind: 'set_status', item_id: 4, status: 'closed' },
    { kind: 'set_status', item_id: 0, status: 'closed' },
    { kind: 'set_status', item_id: 5, status: 'melting' },
    { kind: 'delete_everything', item_id: 1 },
    'not an object',
    null,
  ]);
  assert.equal(out.length, 3);
  assert.deepEqual(out.map((p) => p.id), ['p1', 'p2', 'p3']);
  assert.equal(out[0].place.name, 'Rival Cafe');
  assert.equal(out[1].place.tag, 'other');
  assert.equal(out[1].place.status, 'active');
  assert.equal(out[1].title, 'Odd tag', 'title falls back to the place name');
  assert.equal(out[2].kind, 'set_status');
  assert.equal(cleanProposals('nope').length, 0);
  const many = Array.from({ length: 50 }, (_, i) => ({ kind: 'add_place', place: { name: `p${i}`, lat: 1, lon: 1 } }));
  assert.equal(cleanProposals(many).length, 20);
});

test('only ids, names, tags, statuses and positions are sent upstream', () => {
  const summary = summarizeLibrary([
    { id: 1, kind: 'place', name: 'HQ', tag: 'branch', status: 'active', geom: { lat: 1, lon: 2 }, notes: 'secret notes', fields: [{ key: 'Salary', value: '1' }] },
    { id: 2, kind: 'area', name: 'Zone', tag: 'branch', status: 'active', geom: { type: 'circle', lat: 1, lon: 2, radius_m: 100 } },
  ]);
  assert.deepEqual(summary, [{ id: 1, name: 'HQ', tag: 'branch', status: 'active', lat: 1, lon: 2 }]);
});

test('gateway: sends the question with a key, and maps failures', async () => {
  const calls = [];
  const answer = (over) => async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, json: async () => over };
  };
  const a = createAssistant({ url: 'https://atlas.example/ask', key: 'KEY', fetchImpl: answer({ reply: 'Two rivals nearby.', proposals: [{ kind: 'set_status', item_id: 1, status: 'closed' }], extra: 'ignored' }) });
  const result = await a.ask({ message: 'who is near?', language: 'ar', view: { lat: '1' }, library: [] });
  assert.equal(result.reply, 'Two rivals nearby.');
  assert.equal(result.proposals.length, 1);
  assert.equal(calls[0].init.headers.Authorization, 'Bearer KEY');
  const sent = JSON.parse(calls[0].init.body);
  assert.equal(sent.language, 'ar');
  assert.deepEqual(Object.keys(sent).sort(), ['context', 'language', 'message']);

  const code = async (fetchImpl) => {
    try {
      await createAssistant({ url: 'https://atlas.example/ask', fetchImpl }).ask({ message: 'x' });
    } catch (e) {
      assert.ok(e instanceof AssistantError);
      return `${e.code}:${e.status}`;
    }
    return 'ok';
  };
  assert.equal(await code(async () => ({ ok: false, status: 500 })), 'upstream_error:502');
  assert.equal(await code(async () => { throw new Error('down'); }), 'upstream_error:502');
  assert.equal(await code(async () => { const e = new Error('t'); e.name = 'TimeoutError'; throw e; }), 'upstream_timeout:504');
  assert.equal(await code(async () => ({ ok: true, json: async () => { throw new Error('html'); } })), 'upstream_error:502');
  assert.equal(await code(async () => ({ ok: true, json: async () => ({}) })), 'upstream_error:502');
  const off = createAssistant({ url: '' });
  assert.equal(off.connected, false);
  await assert.rejects(off.ask({ message: 'x' }), (e) => e.code === 'not_connected' && e.status === 503);
});

test('config: Atlas AI address must be https (or this machine)', () => {
  assert.equal(loadOhjiyaConfig(ENV).assistantUrl, '');
  assert.equal(loadOhjiyaConfig({ ...ENV, ATLAS_AI_URL: 'https://atlas.example/v1/ask' }).assistantUrl, 'https://atlas.example/v1/ask');
  assert.equal(loadOhjiyaConfig({ ...ENV, ATLAS_AI_URL: 'http://127.0.0.1:9000/ask' }).assistantUrl, 'http://127.0.0.1:9000/ask');
  assert.throws(() => loadOhjiyaConfig({ ...ENV, ATLAS_AI_URL: 'http://atlas.example/ask' }), /ATLAS_AI_URL/);
  assert.throws(() => loadOhjiyaConfig({ ...ENV, ATLAS_AI_URL: 'ftp://x' }), /ATLAS_AI_URL/);
});

const cookieFor = (uid) => {
  const iat = Math.floor(Date.now() / 1000);
  return `${SESSION_COOKIE}=${signValue({ uid, name: 'U', email: 'u@x.sa', locale: 'en', iat, exp: iat + 600 }, S('k'))}`;
};

test('HTTP: assistant needs the chat feature, is rate limited, and returns proposals', async () => {
  const docs = {
    1: { company: { id: 10, name: 'A', role: 'owner' }, plan: { edition: 'retail', status: 'active', expires: '2027-01-01', seats: 3 }, features: ['voice', 'chat'] },
    2: { company: { id: 10, name: 'A', role: 'owner' }, plan: { edition: 'retail', status: 'active', expires: '2027-01-01', seats: 3 }, features: ['voice'] },
    3: { company: { id: 10, name: 'A', role: 'owner' }, plan: { edition: 'retail', status: 'expired', expires: '2025-01-01', seats: 3 }, features: [] },
  };
  const fetchImpl = async (url) => ({ ok: true, status: 200, json: async () => docs[new URL(url).searchParams.get('user')] });
  const seen = [];
  const fake = {
    connected: true,
    async ask(input) {
      seen.push(input);
      return { reply: 'Done.', proposals: [{ id: 'p1', kind: 'set_status', title: 'Close it', item_id: 1, status: 'closed' }] };
    },
  };
  const config = loadOhjiyaConfig(ENV);
  const { handler, store } = createAuthHandler(config, { store: createStore(), fetchImpl, assistant: fake });
  const server = http.createServer((req, res) => handler(req, res, () => { res.writeHead(404); res.end(); }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const json = { 'content-type': 'application/json', origin: 'https://x.ohjiya.sa' };
  const post = (cookie, body, headers = json) => fetch(`${base}/api/assistant/message`, { method: 'POST', headers: { ...(cookie ? { cookie } : {}), ...headers }, body: JSON.stringify(body) });
  try {
    assert.equal((await post(null, { message: 'hi' })).status, 401);
    assert.equal((await post(cookieFor(2), { message: 'hi' })).status, 402, 'plan without chat');
    assert.equal((await post(cookieFor(3), { message: 'hi' })).status, 402, 'expired plan');
    assert.equal((await fetch(`${base}/api/assistant/status`, { headers: { cookie: cookieFor(1) } }).then((r) => r.json())).connected, true);

    // Add a library item so the context has something to summarize.
    await fetch(`${base}/api/library/items`, { method: 'POST', headers: { cookie: cookieFor(1), ...json }, body: JSON.stringify({ kind: 'place', name: 'HQ', tag: 'branch', geom: { lat: 24.7, lon: 46.7 }, notes: 'private' }) });

    const ok = await post(cookieFor(1), { message: 'close the HQ', language: 'ar', view: 'v=2&lat=24.7&lon=46.7&alt=2000' });
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.equal(body.reply, 'Done.');
    assert.equal(body.proposals[0].kind, 'set_status');
    assert.equal(seen[0].library.length, 1, 'company library is the context');
    assert.equal(seen[0].view.lat, '24.7');
    assert.equal(seen[0].language, 'ar');

    assert.equal((await post(cookieFor(1), { message: '' })).status, 400);
    assert.equal((await post(cookieFor(1), { message: 'x'.repeat(2001) })).status, 400);
    assert.equal((await post(cookieFor(1), { message: 'hi' }, { ...json, origin: 'https://evil.example' })).status, 403);
    assert.equal((await post(cookieFor(1), { message: 'hi' }, { 'content-type': 'text/plain', origin: 'https://x.ohjiya.sa' })).status, 415);
    assert.equal((await fetch(`${base}/api/assistant/other`, { headers: { cookie: cookieFor(1) } })).status, 404);

    let last = 200;
    for (let i = 0; i < 25 && last === 200; i += 1) last = (await post(cookieFor(1), { message: `q${i}` })).status;
    assert.equal(last, 429, 'per-user limit');
    assert.equal((await post(cookieFor(2), { message: 'hi' })).status, 402, 'other users are unaffected');
  } finally {
    server.close();
    store.close();
  }
});

test('HTTP: not connected answers 503 with a clear code', async () => {
  const doc = { company: { id: 10, name: 'A', role: 'owner' }, plan: { edition: 'retail', status: 'active', expires: '2027-01-01', seats: 3 }, features: ['chat'] };
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => doc });
  const { handler, store } = createAuthHandler(loadOhjiyaConfig(ENV), { store: createStore(), fetchImpl });
  const server = http.createServer((req, res) => handler(req, res, () => { res.writeHead(404); res.end(); }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const status = await fetch(`${base}/api/assistant/status`, { headers: { cookie: cookieFor(1) } }).then((r) => r.json());
    assert.equal(status.connected, false);
    const res = await fetch(`${base}/api/assistant/message`, { method: 'POST', headers: { cookie: cookieFor(1), 'content-type': 'application/json', origin: 'https://x.ohjiya.sa' }, body: JSON.stringify({ message: 'hi' }) });
    assert.equal(res.status, 503);
    assert.equal((await res.json()).error, 'not_connected');
  } finally {
    server.close();
    store.close();
  }
});
