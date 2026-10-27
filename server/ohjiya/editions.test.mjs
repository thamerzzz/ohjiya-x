import assert from 'node:assert/strict';
import test from 'node:test';
import { EDITIONS, EDITION_IDS, editionCatalog, editionFor, lensPath, publicEdition } from './editions.js';
import { REGISTERED_LAYER_IDS } from '../../src/data/layerState.js';

test('there are exactly the three sold editions, matching the WordPress plugin', () => {
  assert.deepEqual([...EDITION_IDS].sort(), ['digital_business', 'real_estate', 'retail']);
});

test('every edition has Arabic and English text and a valid starter lens', () => {
  for (const id of EDITION_IDS) {
    const e = EDITIONS[id];
    for (const text of [e.name, e.tagline, ...e.tools.map((t) => t.label)]) {
      assert.ok(text.en && text.ar, `${id} text needs en and ar`);
    }
    // The lens must only name layers the app really has, or the view silently drops them.
    for (const layer of e.lens.layers) assert.ok(REGISTERED_LAYER_IDS.includes(layer), `${id}: unknown layer ${layer}`);
    const path = lensPath(id);
    assert.match(path, /^\/#v=2&lat=[\d.]+&lon=[\d.]+/);
    assert.ok(e.tools.some((t) => t.id === 'lens' && t.status === 'ready'));
    assert.ok(e.tools.every((t) => ['ready', 'soon'].includes(t.status)));
  }
});

test('the lens link carries the chosen layers and map', () => {
  const path = lensPath('digital_business');
  assert.match(path, /map=esri-imagery/);
  assert.match(path, /l=/);
  assert.equal(lensPath('nope'), null);
});

test('only an active plan gets its edition; the catalog is always public', () => {
  const active = { plan: { status: 'active', edition: 'retail' } };
  assert.equal(editionFor(active).id, 'retail');
  assert.equal(editionFor({ plan: { status: 'grace', edition: 'retail' } }), null);
  assert.equal(editionFor({ plan: { status: 'expired', edition: 'retail' } }), null);
  assert.equal(editionFor({ plan: { status: 'none' } }), null);
  assert.equal(editionFor({ plan: { status: 'active', edition: 'unknown' } }), null);
  assert.equal(editionCatalog().length, 3);
  assert.equal(Object.keys(publicEdition('retail')).sort().join(), 'id,lens,name,tagline,tools');
});
