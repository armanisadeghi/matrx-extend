import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { auditFaultSource } from './audit-key-native-faults.mjs';

const ACTIVE = 'matrx.audit.deviceKey';
const HISTORY = 'matrx.audit.publicKeyHistory';
const gut = process.env.AUDIT_FAULT_GUT === 'no-op';

function browser(mode) {
  const saved = new Map([
    [ACTIVE, { publicKeyId: 'old' }],
    [HISTORY, [{ publicKeyId: 'old' }]],
  ]);
  const writes = [];
  const clipboard = [];
  const area = {
    async get(keys) {
      const selected = typeof keys === 'string' ? [keys] : keys;
      return Object.fromEntries(selected.map((key) => [key, saved.get(key)]));
    },
    async set(items) {
      writes.push(Object.keys(items));
      for (const [key, value] of Object.entries(items)) saved.set(key, value);
    },
  };
  const navigator = {
    clipboard: {
      async writeText(value) {
        clipboard.push(value);
      },
    },
  };
  const original = { get: area.get, set: area.set, writeText: navigator.clipboard.writeText };
  const window = {};
  const source = auditFaultSource(gut ? 'off' : mode);
  assert.equal(
    runInNewContext(source, { chrome: { storage: { local: area } }, navigator, window }),
    true,
  );
  return { area, navigator, original, window, saved, writes, clipboard };
}

test('refused history write leaves active and history unchanged; unrelated write passes', async () => {
  const b = browser('reject-history');
  await b.area.set({ other: 'kept' });
  await assert.rejects(
    b.area.set({ [HISTORY]: [{ publicKeyId: 'new' }] }),
    /controlled history refusal/,
  );
  assert.equal(b.saved.get('other'), 'kept');
  assert.equal(b.saved.get(ACTIVE).publicKeyId, 'old');
  assert.deepEqual(b.saved.get(HISTORY), [{ publicKeyId: 'old' }]);
  assert.equal(b.window.__auditNativeFault.state().historyWrites, 1);
  b.window.__auditNativeFault.restore();
  assert.equal(b.area.set, b.original.set);
  assert.equal(b.area.get, b.original.get);
});

test('uncertain active write persists then rejects; readback rejects once', async () => {
  const b = browser('unknown-write');
  await assert.rejects(
    b.area.set({ [ACTIVE]: { publicKeyId: 'new' } }),
    /controlled post-write refusal/,
  );
  assert.equal(b.saved.get(ACTIVE).publicKeyId, 'new');
  await assert.rejects(b.area.get(ACTIVE), /controlled read refusal/);
  assert.equal((await b.area.get(ACTIVE))[ACTIVE].publicKeyId, 'new');
  assert.equal(b.window.__auditNativeFault.state().activeWrites, 1);
});

test('held active write persists only after release and release is idempotent', async () => {
  const b = browser('hold-active');
  const pending = b.area.set({ [ACTIVE]: { publicKeyId: 'new' } });
  assert.equal(b.saved.get(ACTIVE).publicKeyId, 'old');
  assert.equal(b.window.__auditNativeFault.state().held, true);
  b.window.__auditNativeFault.release();
  b.window.__auditNativeFault.release();
  await pending;
  assert.equal(b.saved.get(ACTIVE).publicKeyId, 'new');
  assert.equal(b.writes.filter((keys) => keys.includes(ACTIVE)).length, 1);
  b.window.__auditNativeFault.restore();
  assert.equal(b.writes.filter((keys) => keys.includes(ACTIVE)).length, 1);
});

test('clipboard failure clears only on a second real write; restore reinstates native API', async () => {
  const b = browser('clipboard-once');
  b.saved.set(ACTIVE, {
    publicKeyId: 'old',
    publicKeyJwk: { kty: 'OKP', crv: 'Ed25519', x: 'public' },
  });
  await assert.rejects(b.navigator.clipboard.writeText('first'), /controlled clipboard refusal/);
  assert.deepEqual(b.clipboard, []);
  b.window.__auditNativeFault.disarm();
  const publicText = JSON.stringify(b.saved.get(ACTIVE).publicKeyJwk);
  await b.navigator.clipboard.writeText(publicText);
  assert.deepEqual(b.clipboard, [publicText]);
  assert.equal(b.window.__auditNativeFault.state().clipboardSucceeded, 1);
  assert.equal(await b.window.__auditNativeFault.copiedPublicJwk(), true);
  await b.navigator.clipboard.writeText(
    JSON.stringify({ ...b.saved.get(ACTIVE).publicKeyJwk, d: 'private' }),
  );
  assert.equal(await b.window.__auditNativeFault.copiedPublicJwk(), false);
  b.window.__auditNativeFault.restore();
  assert.equal(b.navigator.clipboard.writeText, b.original.writeText);
});
