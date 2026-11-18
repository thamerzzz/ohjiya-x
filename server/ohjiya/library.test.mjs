import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { loadOhjiyaConfig } from './config.js';
import { SESSION_COOKIE, signValue } from './cookies.js';
import { FREE } from './entitlements.js';
import { LIMITS, STATUSES, cleanHash, createLibrary } from './library.js';
import { DatabaseSync } from 'node:sqlite';
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
const config = () => loadOhjiyaConfig(ENV);
const HASH = 'v=2&lat=24.7136&lon=46.6753&alt=12000&heading=0&pitch=-55&roll=0';

function lib() {
  const store = createStore();
  return { library: createLibrary(store.db), store };
}
const call = (library, method, path, body, companyId = 1) =>
  library.handle({ method, path, body, companyId, userId: 7 });

test('places and areas: validated, stored per company, deletable only by their company', () => {
  const { library, store } = lib();
  const place = call(library, 'POST', '/api/library/items', {
    kind: 'place',
    name: '  Olaya   branch ',
    tag: 'branch',
    geom: { lat: 24.69, lon: 46.685 },
  });
  assert.equal(place.status, 201);
  assert.equal(place.body.name, 'Olaya branch');

  const circle = call(library, 'POST', '/api/library/items', {
    kind: 'area',
    name: '3 km catchment',
    geom: { type: 'circle', lat: 24.69, lon: 46.685, radius_m: 3000 },
  });
  assert.equal(circle.status, 201);
  assert.equal(circle.body.tag, 'other');
  const polygon = call(library, 'POST', '/api/library/items', {
    kind: 'area',
    name: 'District',
    geom: {
      type: 'polygon',
      points: [
        { lat: 24.7, lon: 46.6 },
        { lat: 24.7, lon: 46.7 },
        { lat: 24.6, lon: 46.7 },
      ],
    },
  });
  assert.equal(polygon.status, 201);
  const repeated = call(library, 'POST', '/api/library/items', {
    kind: 'area',
    name: 'Double-click repeat',
    geom: {
      type: 'polygon',
      points: [
        { lat: 24.7, lon: 46.6 },
        { lat: 24.7, lon: 46.7 },
        { lat: 24.6, lon: 46.7 },
        { lat: 24.6, lon: 46.7 },
      ],
    },
  });
  assert.equal(repeated.body.geom.points.length, 3, 'repeated corner dropped');
  call(library, 'DELETE', `/api/library/items/${repeated.body.id}`);
  const sliver = call(library, 'POST', '/api/library/items', {
    kind: 'area',
    name: 'Two real corners',
    geom: {
      type: 'polygon',
      points: [
        { lat: 24.7, lon: 46.6 },
        { lat: 24.7, lon: 46.6 },
        { lat: 24.6, lon: 46.7 },
      ],
    },
  });
  assert.equal(sliver.body.error, 'bad_geometry', 'two distinct corners are not an area');

  const bad = (body) => call(library, 'POST', '/api/library/items', body).body.error;
  assert.equal(bad({ kind: 'sphere', name: 'x', geom: {} }), 'bad_kind');
  assert.equal(bad({ kind: 'place', name: '   ', geom: { lat: 1, lon: 1 } }), 'bad_name');
  assert.equal(bad({ kind: 'place', name: 'x', tag: 'secret', geom: { lat: 1, lon: 1 } }), 'bad_tag');
  assert.equal(bad({ kind: 'place', name: 'x', geom: { lat: 91, lon: 1 } }), 'bad_geometry');
  assert.equal(bad({ kind: 'place', name: 'x', geom: { lat: '1', lon: 1 } }), 'bad_geometry');
  assert.equal(
    bad({ kind: 'area', name: 'x', geom: { type: 'circle', lat: 1, lon: 1, radius_m: 5 } }),
    'bad_geometry',
    'radius below the minimum',
  );
  assert.equal(
    bad({ kind: 'area', name: 'x', geom: { type: 'polygon', points: [{ lat: 1, lon: 1 }] } }),
    'bad_geometry',
  );

  // Another company sees none of it and cannot delete it.
  assert.equal(call(library, 'GET', '/api/library', null, 2).body.items.length, 0);
  assert.equal(call(library, 'DELETE', `/api/library/items/${place.body.id}`, null, 2).status, 404);
  assert.equal(call(library, 'GET', '/api/library').body.items.length, 3);
  assert.equal(call(library, 'DELETE', `/api/library/items/${place.body.id}`).status, 204);
  assert.equal(call(library, 'GET', '/api/library').body.items.length, 2);
  assert.equal(call(library, 'DELETE', '/api/library/items/abc').status, 400);
  store.close();
});

test('tactics keep a view and a tag filter, with limits', () => {
  const { library, store } = lib();
  const made = call(library, 'POST', '/api/library/tactics', {
    name: 'Riyadh competitors',
    hash: `#${HASH}`,
    tags: ['competitor', 'nonsense', 'competitor'],
    edition: 'retail',
  });
  assert.equal(made.status, 201);
  assert.equal(made.body.hash, HASH);
  assert.deepEqual(made.body.tags, ['competitor']);
  assert.equal(made.body.edition, 'retail');

  const bad = (body) => call(library, 'POST', '/api/library/tactics', body).body.error;
  assert.equal(bad({ name: '', hash: HASH }), 'bad_name');
  assert.equal(bad({ name: 'x', hash: 'lat=1' }), 'bad_view');
  assert.equal(bad({ name: 'x', hash: 'lat=99&lon=1' }), 'bad_view');
  assert.equal(bad({ name: 'x', hash: `${HASH}&${'a'.repeat(LIMITS.hashChars)}=1` }), 'bad_view');
  assert.equal(cleanHash(`${HASH}\n`), null, 'control characters are refused');

  for (let i = 1; i < LIMITS.tactics; i += 1)
    assert.equal(call(library, 'POST', '/api/library/tactics', { name: `t${i}`, hash: HASH }).status, 201);
  const over = call(library, 'POST', '/api/library/tactics', { name: 'one too many', hash: HASH });
  assert.equal(over.status, 409);
  assert.equal(call(library, 'POST', '/api/library/tactics', { name: 'other co', hash: HASH }, 2).status, 201);
  assert.equal(call(library, 'DELETE', `/api/library/tactics/${made.body.id}`, null, 2).status, 404);
  assert.equal(call(library, 'DELETE', `/api/library/tactics/${made.body.id}`).status, 204);
  store.close();
});

test('item limit stops the 501st place', () => {
  const { library, store } = lib();
  const add = (i) =>
    call(library, 'POST', '/api/library/items', {
      kind: 'place',
      name: `p${i}`,
      geom: { lat: 24 + i / 1e5, lon: 46 },
    });
  for (let i = 0; i < LIMITS.items; i += 1) assert.equal(add(i).status, 201);
  assert.equal(add(LIMITS.items).status, 409);
  store.close();
});

async function serve(handler) {
  const server = http.createServer((req, res) =>
    handler(req, res, () => {
      res.writeHead(404);
      res.end();
    }),
  );
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

const cookieFor = (uid) => {
  const iat = Math.floor(Date.now() / 1000);
  return `${SESSION_COOKIE}=${signValue({ uid, name: 'U', email: 'u@x.sa', locale: 'en', iat, exp: iat + 600 }, S('k'))}`;
};
const paid = (companyId, status = 'active') => ({
  company: { id: companyId, name: `Co${companyId}`, role: 'owner' },
  plan: { edition: 'retail', status, expires: '2027-01-01', seats: 3 },
  features: status === 'active' ? ['voice'] : [],
});

test('HTTP: library needs sign-in and an active plan, is per company, and refuses cross-site writes', async () => {
  const docs = { 1: paid(10), 2: paid(20), 3: paid(10, 'expired'), 4: FREE };
  const fetchImpl = async (url) => ({
    ok: true,
    status: 200,
    json: async () => docs[new URL(url).searchParams.get('user')] ?? FREE,
  });
  const { handler, store } = createAuthHandler(config(), { store: createStore(), fetchImpl });
  const { server, base } = await serve(handler);
  const json = { 'content-type': 'application/json', origin: 'https://x.ohjiya.sa' };
  const send = (path, method, cookie, body, headers = json) =>
    fetch(`${base}${path}`, {
      method,
      headers: { ...(cookie ? { cookie } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  try {
    assert.equal((await send('/api/library', 'GET')).status, 401, 'signed out');
    assert.equal((await send('/api/library', 'GET', cookieFor(4))).status, 402, 'free user');
    assert.equal((await send('/api/library', 'GET', cookieFor(3))).status, 402, 'expired plan');

    const pin = { kind: 'place', name: 'HQ', tag: 'branch', geom: { lat: 24.7, lon: 46.7 } };
    const made = await send('/api/library/items', 'POST', cookieFor(1), pin);
    assert.equal(made.status, 201);
    const id = (await made.json()).id;

    // A second user in the same company sees it; another company does not.
    const sameCompany = await (await send('/api/library', 'GET', cookieFor(1))).json();
    assert.equal(sameCompany.items.length, 1);
    const other = await (await send('/api/library', 'GET', cookieFor(2))).json();
    assert.equal(other.items.length, 0);
    assert.equal((await send(`/api/library/items/${id}`, 'DELETE', cookieFor(2))).status, 404);

    // Writes must be same-origin JSON.
    const evil = { ...json, origin: 'https://evil.example' };
    assert.equal((await send('/api/library/items', 'POST', cookieFor(1), pin, evil)).status, 403);
    assert.equal((await send(`/api/library/items/${id}`, 'DELETE', cookieFor(1), undefined, evil)).status, 403);
    const form = { 'content-type': 'text/plain', origin: 'https://x.ohjiya.sa' };
    assert.equal((await send('/api/library/items', 'POST', cookieFor(1), pin, form)).status, 415);
    const garbage = await fetch(`${base}/api/library/items`, {
      method: 'POST',
      headers: { cookie: cookieFor(1), ...json },
      body: '{not json',
    });
    assert.equal(garbage.status, 400);
    const huge = await fetch(`${base}/api/library/items`, {
      method: 'POST',
      headers: { cookie: cookieFor(1), ...json },
      body: JSON.stringify({ ...pin, name: 'x'.repeat(40_000) }),
    });
    assert.equal(huge.status, 400);

    assert.equal((await send(`/api/library/items/${id}`, 'DELETE', cookieFor(1))).status, 204);
    assert.equal((await send('/api/library/nope', 'GET', cookieFor(1))).status, 404);

    // Data survives a lapse: the expired user is refused, the company keeps its items.
    await send('/api/library/items', 'POST', cookieFor(1), pin);
    assert.equal((await send('/api/library', 'GET', cookieFor(3))).status, 402);
    assert.equal((await (await send('/api/library', 'GET', cookieFor(1))).json()).items.length, 1);
  } finally {
    server.close();
    store.close();
  }
});

test('items carry a status, named fields and notes, and can be edited by their company only', () => {
  const { library, store } = lib();
  const made = call(library, 'POST', '/api/library/items', {
    kind: 'place',
    name: 'Olaya branch',
    tag: 'branch',
    geom: { lat: 24.69, lon: 46.685 },
    status: 'planned',
    fields: [
      { key: ' Manager ', value: 'Sara' },
      { key: 'Area', value: '420 m2' },
    ],
    notes: 'Opens in Q3.\n\n\n\nCheck parking.',
  });
  assert.equal(made.status, 201);
  assert.equal(made.body.status, 'planned');
  assert.deepEqual(made.body.fields[0], { key: 'Manager', value: 'Sara' });
  assert.equal(made.body.notes, 'Opens in Q3.\n\nCheck parking.');

  const plain = call(library, 'POST', '/api/library/items', { kind: 'place', name: 'Plain', geom: { lat: 1, lon: 1 } });
  assert.equal(plain.body.status, 'active', 'default status');
  assert.deepEqual(plain.body.fields, []);

  const bad = (body) => call(library, 'POST', '/api/library/items', { kind: 'place', name: 'x', geom: { lat: 1, lon: 1 }, ...body }).body.error;
  assert.equal(bad({ status: 'on-fire' }), 'bad_status');
  assert.equal(bad({ fields: 'nope' }), 'bad_fields');
  assert.equal(bad({ fields: [{ key: '', value: 'v' }] }), 'bad_fields');
  assert.equal(bad({ fields: Array.from({ length: LIMITS.fields + 1 }, (_, i) => ({ key: `k${i}`, value: '' })) }), 'bad_fields');
  assert.equal(bad({ notes: 42 }), 'bad_notes');
  assert.ok(STATUSES.includes('attention'));

  const patch = (id, body, company = 1) => call(library, 'PATCH', `/api/library/items/${id}`, body, company);
  const edited = patch(made.body.id, { status: 'attention', fields: [{ key: 'Manager', value: 'Huda' }] });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.status, 'attention');
  assert.equal(edited.body.fields[0].value, 'Huda');
  assert.equal(edited.body.notes, 'Opens in Q3.\n\nCheck parking.', 'untouched details stay');
  assert.deepEqual(edited.body.geom, { lat: 24.69, lon: 46.685 }, 'geometry cannot change');
  assert.equal(patch(made.body.id, { name: 'Olaya HQ', tag: 'competitor' }).body.tag, 'competitor');
  assert.equal(patch(made.body.id, { name: '  ' }).body.error, 'bad_name');
  assert.equal(patch(made.body.id, { tag: 'nope' }).body.error, 'bad_tag');
  assert.equal(patch(made.body.id, { geom: { lat: 5, lon: 5 } }).body.geom.lat, 24.69);
  assert.equal(patch(made.body.id, { status: 'x' }).body.error, 'bad_status');
  assert.equal(patch(made.body.id, { status: 'closed' }, 2).status, 404, 'another company cannot edit');
  assert.equal(patch(9999, { status: 'closed' }).status, 404);
  assert.equal(call(library, 'GET', '/api/library').body.items.find((i) => i.id === made.body.id).name, 'Olaya HQ');
  store.close();
});

test('a library created before details existed gains them without losing items', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE lib_item (id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL, tag TEXT NOT NULL, geom TEXT NOT NULL, created_by INTEGER NOT NULL, created_ms INTEGER NOT NULL)`);
  db.prepare('INSERT INTO lib_item (company_id, kind, name, tag, geom, created_by, created_ms) VALUES (1, ?, ?, ?, ?, 7, 1)').run('place', 'Old pin', 'branch', '{"lat":1,"lon":2}');
  const library = createLibrary(db);
  const item = library.handle({ method: 'GET', path: '/api/library', companyId: 1, userId: 7 }).body.items[0];
  assert.equal(item.name, 'Old pin');
  assert.equal(item.status, 'active');
  assert.deepEqual(item.fields, []);
  db.close();
});
