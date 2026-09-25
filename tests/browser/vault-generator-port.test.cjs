'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('./vault-generator-acceptance.cjs'), 'utf8');
const expression = source.match(
  /const next = await panel\.evaluate\(`(new Promise\([\s\S]*?)`\);/,
)?.[1];
assert.ok(expression, 'actual port handshake expression missing');
function setup() {
  const messages = new Set(),
    disconnects = new Set();
  let disconnected = 0,
    timeout,
    timerCleared = false;
  const port = {
    onMessage: { addListener: (f) => messages.add(f), removeListener: (f) => messages.delete(f) },
    onDisconnect: {
      addListener: (f) => disconnects.add(f),
      removeListener: (f) => disconnects.delete(f),
    },
    disconnect() {
      disconnected++;
      for (const f of [...disconnects]) f();
    },
  };
  const sandbox = {
    chrome: { runtime: { connect: () => port } },
    setTimeout(f, ms) {
      assert.equal(ms, 10000);
      timeout = f;
      return 1;
    },
    clearTimeout(id) {
      assert.equal(id, 1);
      timerCleared = true;
    },
  };
  const promise = vm.runInNewContext(expression, sandbox);
  return {
    sandbox,
    port,
    promise,
    messages,
    disconnects,
    fireMessage: (m) => {
      for (const f of [...messages]) f(m);
    },
    timeout: () => timeout(),
    assertClean() {
      assert.equal(messages.size, 0);
      assert.equal(disconnects.size, 0);
      assert.equal(timerCleared, true);
    },
    disconnected: () => disconnected,
  };
}
(async () => {
  const success = setup();
  success.fireMessage({
    __matrxCredentialGeneration: true,
    operation: 'connected',
    connectionId: 'a'.repeat(36),
  });
  assert.equal(await success.promise, 'a'.repeat(36));
  success.assertClean();
  assert.equal(success.disconnected(), 0);
  assert.equal(success.sandbox.__vaultCanaryGeneratorPort, success.port);
  const timed = setup();
  timed.timeout();
  assert.equal(await timed.promise, null);
  timed.assertClean();
  assert.equal(timed.disconnected(), 1);
  assert.equal(timed.sandbox.__vaultCanaryGeneratorPort, undefined);
  timed.fireMessage({
    __matrxCredentialGeneration: true,
    operation: 'connected',
    connectionId: 'b'.repeat(36),
  });
  assert.equal(timed.sandbox.__vaultCanaryGeneratorPort, undefined);
  const early = setup();
  early.port.disconnect();
  assert.equal(await early.promise, null);
  early.assertClean();
  assert.equal(early.sandbox.__vaultCanaryGeneratorPort, undefined);
  const invalid = setup();
  invalid.fireMessage({
    __matrxCredentialGeneration: true,
    operation: 'connected',
    connectionId: 'not-a-valid-id',
  });
  assert.equal(await invalid.promise, null);
  invalid.assertClean();
  assert.equal(invalid.disconnected(), 1);
  assert.equal(invalid.sandbox.__vaultCanaryGeneratorPort, undefined);
  const malformed = setup();
  malformed.fireMessage({ operation: 'connected', connectionId: 'c'.repeat(36) });
  assert.equal(malformed.messages.size, 1);
  malformed.timeout();
  assert.equal(await malformed.promise, null);
  malformed.assertClean();
  process.stdout.write(
    'PASS: actual generator handshake settles once and disposes failed ports/listeners\n',
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
