import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LibraryError,
  TAG_IDS,
  createLibraryClient,
  distanceM,
  errorText,
  filterItems,
  hasView,
  hashParams,
  STATUS_IDS,
  legendCounts,
  pointOf,
  statusColor,
  statusName,
  tagColor,
  tagName,
} from './libraryModel.js';

test('tags have a colour and English and Arabic names, with a safe fallback', () => {
  for (const id of TAG_IDS) {
    assert.match(tagColor(id), /^#[0-9a-f]{6}$/);
    assert.ok(tagName(id, 'en') && tagName(id, 'ar'));
  }
  assert.equal(tagColor('mystery'), tagColor('other'));
  assert.equal(tagName('branch', 'ar'), 'فرع');
});

test('an empty filter shows everything; a filter shows only its tags', () => {
  const items = [{ tag: 'branch' }, { tag: 'competitor' }, { tag: 'listing' }];
  assert.equal(filterItems(items, []).length, 3);
  assert.equal(filterItems(items, undefined).length, 3);
  assert.deepEqual(filterItems(items, ['competitor', 'listing']).map((i) => i.tag), ['competitor', 'listing']);
});

test('distance and area centre', () => {
  const a = { lat: 24.7136, lon: 46.6753 };
  assert.equal(Math.round(distanceM(a, a)), 0);
  const km = distanceM(a, { lat: 24.7136, lon: 46.7753 }) / 1000;
  assert.ok(km > 9.9 && km < 10.3, `about 10 km east, got ${km}`);
  assert.deepEqual(pointOf({ geom: { lat: 1, lon: 2 } }), { lat: 1, lon: 2 });
  assert.deepEqual(
    pointOf({ geom: { type: 'polygon', points: [{ lat: 0, lon: 0 }, { lat: 2, lon: 0 }, { lat: 1, lon: 3 }] } }),
    { lat: 1, lon: 1 },
  );
});

test('a tactic needs a view with a camera', () => {
  assert.equal(hashParams('#v=2&lat=1&lon=2'), 'v=2&lat=1&lon=2');
  assert.equal(hasView('#v=2&lat=24.7&lon=46.7'), true);
  assert.equal(hasView('#v=2&lat=24.7'), false);
  assert.equal(hasView(''), false);
});

test('client: sends JSON, reads errors, and handles 204', async () => {
  const seen = [];
  const answers = [
    { status: 200, ok: true, json: async () => ({ items: [], tactics: [] }) },
    { status: 201, ok: true, json: async () => ({ id: 5 }) },
    { status: 204, ok: true },
    { status: 402, ok: false, json: async () => ({ error: 'plan_required' }) },
    { status: 502, ok: false, json: async () => { throw new Error('html'); } },
  ];
  const client = createLibraryClient(async (url, init) => {
    seen.push([url, init.method, init.body]);
    return answers.shift();
  });
  assert.deepEqual(await client.load(), { items: [], tactics: [] });
  assert.equal((await client.addItem({ kind: 'place' })).id, 5);
  assert.equal(seen[1][2], '{"kind":"place"}');
  assert.equal(await client.removeItem(5), null);
  assert.equal(seen[2][0], '/api/library/items/5');
  await assert.rejects(client.removeTactic(1), (e) => e instanceof LibraryError && e.code === 'plan_required' && e.status === 402);
  await assert.rejects(client.load(), (e) => e.code === 'default');
});

test('error text exists in both languages and falls back', () => {
  assert.match(errorText('limit_reached', 'ar'), /[؀-ۿ]/);
  assert.equal(errorText('limit_reached', 'en'), 'Your company library is full.');
  assert.equal(errorText('whatever', 'en'), errorText('default', 'en'));
});

test('statuses have colours and both languages, and the legend counts them', () => {
  for (const id of STATUS_IDS) {
    assert.match(statusColor(id), /^#[0-9a-f]{6}$/);
    assert.ok(statusName(id, 'en') && statusName(id, 'ar'));
  }
  assert.equal(statusName('mystery', 'en'), 'Active');
  const counts = legendCounts([
    { tag: 'branch', status: 'active' },
    { tag: 'branch', status: 'attention' },
    { tag: 'competitor' },
    { tag: 'weird', status: 'closed' },
  ]);
  assert.equal(counts.tags.branch, 2);
  assert.equal(counts.tags.competitor, 1);
  assert.equal(counts.statuses.active, 2, 'a missing status counts as active');
  assert.equal(counts.statuses.attention, 1);
  assert.equal(counts.statuses.closed, 1);
});

test('client can edit an item', async () => {
  let seen;
  const client = createLibraryClient(async (url, init) => {
    seen = [url, init.method, init.body];
    return { status: 200, ok: true, json: async () => ({ id: 3 }) };
  });
  await client.updateItem(3, { status: 'closed' });
  assert.deepEqual(seen, ['/api/library/items/3', 'PATCH', '{"status":"closed"}']);
});
