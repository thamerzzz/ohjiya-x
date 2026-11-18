import assert from 'node:assert/strict';
import test from 'node:test';
import { applyProposal, assistantErrorText, createAssistantClient } from './assistantModel.js';

test('add_place proposal goes through addItem', async () => {
  const calls = [];
  const lib = { addItem: async (x) => calls.push(['add', x]), updateItem: async (...a) => calls.push(['upd', ...a]) };
  await applyProposal({ kind: 'add_place', place: { name: 'A', tag: 'branch', status: 'planned', lat: 1, lon: 2 } }, lib);
  await applyProposal({ kind: 'set_status', item_id: 7, status: 'closed' }, lib);
  assert.deepEqual(calls[0][1].geom, { lat: 1, lon: 2 });
  assert.deepEqual(calls[1], ['upd', 7, { status: 'closed' }]);
  await assert.rejects(applyProposal({ kind: 'x' }, lib), { code: 'bad_proposal' });
});

test('client maps errors to codes and text is translated', async () => {
  const f = async () => ({ ok: false, status: 503, json: async () => ({ error: 'not_connected' }) });
  await assert.rejects(createAssistantClient(f).status(), { code: 'not_connected' });
  assert.match(assistantErrorText('not_connected', 'ar'), /أطلس/);
  assert.equal(assistantErrorText('zzz', 'en'), 'Something went wrong. Try again.');
});
