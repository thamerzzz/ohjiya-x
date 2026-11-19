import assert from 'node:assert/strict';
import test from 'node:test';
import { hexBins } from './hexModel.js';
import { distanceM } from './libraryModel.js';

const place = (lat, lon) => ({ kind: 'place', geom: { lat, lon } });

test('nearby places share a cell, far ones do not', () => {
  const { cells, max } = hexBins(
    [place(24.7136, 46.6753), place(24.7137, 46.6754), place(24.9, 46.9)],
    1000,
  );
  assert.equal(cells.length, 2);
  assert.equal(max, 2);
  assert.equal(cells.reduce((n, c) => n + c.count, 0), 3);
});

test('a cell is a regular hexagon of the asked radius', () => {
  const { cells } = hexBins([place(24.7136, 46.6753)], 1000);
  const c = cells[0].corners;
  assert.equal(c.length, 6);
  for (let i = 0; i < 6; i++) {
    const d = distanceM(c[i], c[(i + 1) % 6]);
    assert.ok(Math.abs(d - 1000) < 15, `side ${d}`);
  }
});

test('empty input and bad size give nothing', () => {
  assert.deepEqual(hexBins([], 1000), { cells: [], max: 0 });
  assert.equal(hexBins([place(1, 1)], 0).cells.length, 0);
});

test('areas count at their centre', () => {
  const area = { kind: 'area', geom: { type: 'polygon', points: [{ lat: 24.70, lon: 46.60 }, { lat: 24.72, lon: 46.60 }, { lat: 24.71, lon: 46.62 }] } };
  assert.equal(hexBins([area], 2000).cells[0].count, 1);
});
