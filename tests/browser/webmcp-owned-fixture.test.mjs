import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { webmcpOwnedFixture } from './webmcp-owned-fixture.mjs';

test('owned fixture registers through document.modelContext and two calls advance visible state', async () => {
  const html = webmcpOwnedFixture('aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa');
  const source = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(source, 'webmcp_fixture_script_missing');
  const registrations = [];
  const output = { textContent: '0' };
  const document = {
    modelContext: { registerTool: async (spec) => registrations.push(spec) },
    getElementById: (id) => (id === 'intake-count' ? output : null),
  };
  const window = {};
  runInNewContext(source, { document, window });
  assert.equal(await window.__webmcpOwned.ready, true);
  assert.equal(registrations.length, 1);
  assert.equal(
    registrations[0].name,
    'harbor_dental_intake_count_aaaaaaaa_aaaa_4aaa_aaaa_aaaaaaaaaaaa',
  );
  assert.equal(registrations[0].inputSchema.required[0], 'nonce');
  const first = await registrations[0].execute({ nonce: 'intake-morning' });
  assert.equal(first.nonce, 'intake-morning');
  assert.equal(first.count, 1);
  assert.equal(output.textContent, '1');
  const second = await registrations[0].execute({ nonce: 'intake-afternoon' });
  assert.equal(second.nonce, 'intake-afternoon');
  assert.equal(second.count, 2);
  assert.equal(output.textContent, '2');
  await assert.rejects(registrations[0].execute({ nonce: 4 }), /nonce required/);
  assert.equal(output.textContent, '2');
});

test('owned fixture refuses an invalid run id', () => {
  assert.throws(() => webmcpOwnedFixture('not-a-run-id'), /webmcp_fixture_run_id_refused/);
});
