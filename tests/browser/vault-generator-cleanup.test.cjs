'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');
const { runGeneratorChecks } = require('./vault-generator-acceptance.cjs');

const harnessAssert = (condition, code) => {
  if (!condition) throw new Error(code);
};
const base = (overrides = {}) => ({
  context: { newPage: async () => { throw new Error('forced_body_failure'); } },
  worker: {}, panel: {}, assert: harnessAssert, wait: async () => {}, checkpoint: () => {},
  proof: {}, focusOwnedBrowser: async () => {}, screenshotPath: '/dev/null',
  verifyRealVaultPanel: async () => {}, displayMode: 'HEADLESS_NO_CLIPBOARD',
  ...overrides,
});

(async () => {
  const originalCreateServer = http.createServer;
  let serversCreated = 0;
  http.createServer = (...args) => {
    serversCreated += 1;
    return originalCreateServer(...args);
  };
  try {
    await assert.rejects(runGeneratorChecks(base({
      isolatedHeadlessClipboard: true,
      proof: { clipboardIsolation: { runtime: 'Chrome/152.0.0.0', ownedHeadlessProcess: true } },
    })), /generator_clipboard_isolation_not_admitted/);
    assert.equal(serversCreated, 0, 'admission refusal opened a fixture server');
  } finally {
    http.createServer = originalCreateServer;
  }

  const earlyFailureProof = {};
  await assert.rejects(runGeneratorChecks(base({ proof: earlyFailureProof })), /forced_body_failure/);
  assert.equal(earlyFailureProof.generator.ownedFixturePageClosed, true);
  assert.equal(earlyFailureProof.generator.ownedFixtureServersClosed, true);

  const pageFailureProof = {};
  await assert.rejects(runGeneratorChecks(base({
    proof: pageFailureProof,
    context: { newPage: async () => ({
      goto: async () => { throw new Error('forced_body_failure'); },
      isClosed: () => false,
      close: async () => { throw new Error('forced_page_close_failure'); },
    }) },
  })), /generator_fixture_cleanup_failed/);
  assert.equal(pageFailureProof.generator.ownedFixturePageClosed, false);
  assert.equal(pageFailureProof.generator.ownedFixtureServersClosed, true);

  let serverIndex = 0;
  http.createServer = (...args) => {
    const server = originalCreateServer(...args);
    serverIndex += 1;
    if (serverIndex === 2) {
      const realClose = server.close.bind(server);
      server.close = (callback) => realClose((error) => callback(error || new Error('forced_top_close_failure')));
    }
    return server;
  };
  const serverFailureProof = {};
  try {
    await assert.rejects(runGeneratorChecks(base({ proof: serverFailureProof })), /generator_fixture_cleanup_failed/);
    assert.equal(serverFailureProof.generator.ownedFixturePageClosed, true);
    assert.equal(serverFailureProof.generator.ownedFixtureServersClosed, false);
  } finally {
    http.createServer = originalCreateServer;
  }

  process.stdout.write('PASS: generator refuses before fixture custody and independently proves every cleanup branch\n');
})().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
