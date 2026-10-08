import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import {
  auditFaultSource,
  awaitAuditNewDocument,
  classifyAuditNativeFailure,
  reloadAuditPrelude,
  retryAuditDetailsReadOnly,
} from './audit-key-native-faults.mjs';

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

test('details retry keeps write instrumentation until read-only verdict', async () => {
  const oldOrder = browser('read-once');
  await assert.rejects(oldOrder.area.get(ACTIVE), /controlled read refusal/);
  oldOrder.window.__auditNativeFault.restore();
  const removedFault = oldOrder.window.__auditNativeFault?.state() ?? null;
  assert.equal(removedFault, null);
  assert.throws(() => removedFault.activeWrites, TypeError);

  for (const writesOnRetry of [false, true]) {
    const b = browser('read-once');
    await assert.rejects(b.area.get(ACTIVE), /controlled read refusal/);
    const before = { activeId: b.saved.get(ACTIVE).publicKeyId, historyIds: ['old'] };
    const operations = {
      panel: b,
      evaluate: async (_panel, source) => runInNewContext(source, { window: b.window }),
      click: async (_panel, kind, label) => {
        assert.equal(kind, 'button-text');
        assert.equal(label, 'Retry audit details');
        await b.area.get(ACTIVE);
        if (writesOnRetry) await b.area.set({ [ACTIVE]: { publicKeyId: 'new' } });
      },
      expectCard: async (_panel, label, accepts) => {
        assert.equal(label, 'audit_load_recovered');
        const card = { keyId: before.activeId, detailsUnavailable: false };
        assert.equal(accepts(card), true);
        return card;
      },
      snapshot: async () => ({ activeId: before.activeId, historyIds: ['old'] }),
      fault: async () => b.window.__auditNativeFault?.state() ?? null,
      before,
    };
    if (writesOnRetry) {
      await assert.rejects(
        retryAuditDetailsReadOnly(operations),
        /audit_T86_active_write_on_retry/,
      );
    } else {
      assert.equal((await retryAuditDetailsReadOnly(operations)).keyId, 'old');
    }
    assert.equal(b.window.__auditNativeFault, undefined);
    assert.equal(b.area.get, b.original.get);
    assert.equal(b.area.set, b.original.set);
  }
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
  const pair = await webcrypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
  const publicKeyJwk = await webcrypto.subtle.exportKey('jwk', pair.publicKey);
  assert.deepEqual(publicKeyJwk.key_ops, ['verify']);
  b.saved.set(ACTIVE, { publicKeyId: 'old', publicKeyJwk });
  await assert.rejects(b.navigator.clipboard.writeText('first'), /controlled clipboard refusal/);
  assert.deepEqual(b.clipboard, []);
  b.window.__auditNativeFault.disarm();
  const publicText = JSON.stringify(b.saved.get(ACTIVE).publicKeyJwk);
  await b.navigator.clipboard.writeText(publicText);
  assert.deepEqual(b.clipboard, [publicText]);
  assert.equal(b.window.__auditNativeFault.state().clipboardSucceeded, 1);
  assert.equal(await b.window.__auditNativeFault.copiedPublicJwk(), true);
  await b.navigator.clipboard.writeText(
    JSON.stringify({ ...b.saved.get(ACTIVE).publicKeyJwk, key_ops: ['sign'] }),
  );
  assert.equal(await b.window.__auditNativeFault.copiedPublicJwk(), false);
  await b.navigator.clipboard.writeText(
    JSON.stringify({ ...b.saved.get(ACTIVE).publicKeyJwk, d: 'private' }),
  );
  assert.equal(await b.window.__auditNativeFault.copiedPublicJwk(), false);
  b.window.__auditNativeFault.restore();
  assert.equal(b.navigator.clipboard.writeText, b.original.writeText);
});

test('native details failure reports a bounded step and wait label without observation data', () => {
  assert.equal(
    classifyAuditNativeFailure(
      'details_failure',
      'card_failed_load',
      new Error('audit_load_failure_not_observed:{"privateKeyJwk":{"d":"secret"}}'),
    ),
    'audit_load_failure_not_observed',
  );
  assert.equal(
    classifyAuditNativeFailure(
      'details_failure',
      'reload_with_prelude',
      new Error('Protocol error with sensitive URL'),
    ),
    'audit_reload_with_prelude_failed',
  );
});

test('reload keeps fault prelude installed until the old document is gone', async () => {
  let origin = 1000;
  let removed = false;
  let pageEnabled = false;
  const panel = {
    async send(method, payload) {
      if (method === 'Page.enable') {
        pageEnabled = true;
        return {};
      }
      if (method === 'Page.addScriptToEvaluateOnNewDocument') {
        assert.equal(pageEnabled, true, 'Page agent must be enabled in the same session');
        assert.match(payload.source, /__auditPreludeInstalled/);
        return { identifier: 'prelude-1' };
      }
      if (method === 'Page.enable' || method === 'Page.reload') return {};
      if (method === 'Page.removeScriptToEvaluateOnNewDocument') {
        assert.equal(payload.identifier, 'prelude-1');
        assert.equal(origin, 2000, 'must not remove while old Settings DOM is still visible');
        removed = true;
        return {};
      }
      throw new Error('unexpected protocol command');
    },
  };
  const evaluate = async (_panel, expression) => {
    if (expression === 'performance.timeOrigin') return origin;
    assert.match(expression, /performance\.timeOrigin !== 1000/);
    return { newDocument: origin === 2000, settingsReady: true, preludeInstalled: true };
  };
  const waitFor = async (_label, read, accept) => {
    assert.equal(accept(await read()), false, 'old Settings button cannot satisfy reload');
    origin = 2000;
    const current = await read();
    assert.equal(accept(current), true);
    return current;
  };
  await reloadAuditPrelude(panel, auditFaultSource('read-once'), { evaluate, waitFor });
  assert.equal(removed, true);
});

test('reload refuses a new document where fault prelude did not execute', async () => {
  const commands = [];
  const panel = {
    send: async (method) => {
      commands.push(method);
      return method === 'Page.addScriptToEvaluateOnNewDocument' ? { identifier: 'prelude-2' } : {};
    },
  };
  const evaluate = async (_panel, expression) =>
    expression === 'performance.timeOrigin' ? 1000 : null;
  const waitFor = async () => ({ newDocument: true, settingsReady: true, preludeInstalled: false });
  await assert.rejects(
    reloadAuditPrelude(panel, auditFaultSource('read-once'), { evaluate, waitFor }),
    /audit_reload_check_marker/,
  );
  assert.equal(commands.at(-1), 'Page.removeScriptToEvaluateOnNewDocument');
});

test('plain panel reload waits for a distinct document without requiring a prelude', async () => {
  let origin = 5;
  const evaluate = async (_panel, expression) => {
    assert.match(expression, /performance\.timeOrigin !== 5/);
    return { newDocument: origin === 6, settingsReady: true, preludeInstalled: false };
  };
  const waitFor = async (_label, read, accept) => {
    assert.equal(accept(await read()), false);
    origin = 6;
    const next = await read();
    assert.equal(accept(next), true);
    return next;
  };
  const result = await awaitAuditNewDocument({}, 5, { evaluate, waitFor });
  assert.equal(result.newDocument, true);
  assert.equal(result.preludeInstalled, false);
});

for (const method of [
  'Page.enable',
  'Page.addScriptToEvaluateOnNewDocument',
  'Page.reload',
  'Page.removeScriptToEvaluateOnNewDocument',
]) {
  test(`reload retains safe boundary for ${method}`, async () => {
    const events = [];
    const panel = {
      send: async (name) => {
        if (name === method) throw new Error('private protocol details');
        return { identifier: 'script' };
      },
    };
    await assert.rejects(
      reloadAuditPrelude(panel, 'true', {
        evaluate: async () => 1,
        waitFor: async () => ({ preludeInstalled: true }),
        onBoundary: (event) => events.push(event),
      }),
      /^Error: audit_reload_(enable_page|install_script|request_reload|remove_script)$/,
    );
    assert.equal(JSON.stringify(events).includes('private'), false);
    assert.ok(events.some((event) => event.outcome === 'failed'));
  });
}

test('cleanup failure does not mask the first failed reload boundary', async () => {
  const panel = {
    send: async (name) => {
      if (name === 'Page.reload' || name === 'Page.removeScriptToEvaluateOnNewDocument')
        throw new Error('private');
      return { identifier: 'script' };
    },
  };
  await assert.rejects(
    reloadAuditPrelude(panel, 'true', { evaluate: async () => 1, waitFor: async () => null }),
    /audit_reload_request_reload/,
  );
});
