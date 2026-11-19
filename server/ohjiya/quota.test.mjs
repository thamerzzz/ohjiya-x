import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createQuota, quotasFromEnv } from './quota.js';

test('a company gets its daily allowance, then is refused; days and companies are separate', () => {
  const q = createQuota(new DatabaseSync(':memory:'), { places: 2 });
  const t = Date.UTC(2026, 10, 19, 12);
  assert.equal(q.take(1, 'places', t).ok, true);
  assert.equal(q.take(1, 'places', t).ok, true);
  const third = q.take(1, 'places', t);
  assert.deepEqual([third.ok, third.used, third.limit], [false, 2, 2]);
  assert.equal(q.take(2, 'places', t).ok, true);
  assert.equal(q.take(1, 'places', t + 86_400_000).ok, true);
  assert.equal(q.take(1, 'unmetered', t).ok, true);
  assert.equal(q.usage(1, t).places.used, 2);
});

test('env overrides: valid numbers only', () => {
  const l = quotasFromEnv({ OX_QUOTA_PLACES: '5', OX_QUOTA_TOMTOM: 'abc', OX_QUOTA_VOICE: '-3' });
  assert.equal(l.places, 5);
  assert.equal(l.tomtom, 2000);
  assert.equal(l.voice, 60);
});
