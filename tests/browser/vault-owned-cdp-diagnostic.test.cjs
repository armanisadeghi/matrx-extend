'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { prepareOwnedProfile, connectOwnedCdp } = require('./vault-owned-cdp.cjs');

async function withProfile(run) {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'owned-cdp-diagnostic-'));
  try {
    const preparedProfile = await prepareOwnedProfile(profile);
    await run({ profile, preparedProfile });
  } finally {
    await fs.rm(profile, { recursive: true, force: true });
  }
}

function connect(
  preparedProfile,
  processInspector = async () => ({ executable: '/foreign', args: '' }),
) {
  return connectOwnedCdp({
    preparedProfile,
    chromeExecutable: '/owned-chrome',
    WebSocketCtor: class {},
    processInspector,
    timeoutMs: 50,
  });
}

test('reports read boundary when endpoint path cannot be read as a file', async () => {
  await withProfile(async ({ profile, preparedProfile }) => {
    await fs.mkdir(path.join(profile, 'DevToolsActivePort'));
    await assert.rejects(connect(preparedProfile), (error) => {
      assert.equal(error.message, 'owned_cdp_endpoint_refused');
      assert.deepEqual(error.endpointDiagnostic, {
        boundary: 'read',
        reason: 'read_failed',
      });
      return true;
    });
  });
});

test('reports incomplete endpoint record and then reaches ownership validation after completion', async () => {
  await withProfile(async ({ profile, preparedProfile }) => {
    const endpoint = path.join(profile, 'DevToolsActivePort');
    await fs.writeFile(endpoint, '9222\n');
    await assert.rejects(connect(preparedProfile), (error) => {
      assert.equal(error.message, 'owned_cdp_endpoint_refused');
      assert.deepEqual(error.endpointDiagnostic, {
        boundary: 'record_validation',
        reason: 'browser_path_missing',
        shape: {
          lineCount: 2,
          hasTrailingNewline: true,
          portTokenDigits: true,
          browserPathShape: false,
        },
      });
      assert.equal(JSON.stringify(error.endpointDiagnostic).includes(profile), false);
      return true;
    });
    await fs.writeFile(endpoint, '9222\n/devtools/browser/owned-id\n');
    await fs.symlink('host-123', path.join(profile, 'SingletonLock'));
    await assert.rejects(connect(preparedProfile), /owned_cdp_owner_refused/);
  });
});

test('rejects out-of-range port with a fixed shape-only diagnostic', async () => {
  await withProfile(async ({ profile, preparedProfile }) => {
    await fs.writeFile(
      path.join(profile, 'DevToolsActivePort'),
      '65536\n/devtools/browser/owned-id\n',
    );
    await assert.rejects(connect(preparedProfile), (error) => {
      assert.equal(error.message, 'owned_cdp_endpoint_refused');
      assert.equal(error.endpointDiagnostic.reason, 'port_range');
      assert.equal(error.endpointDiagnostic.shape.browserPathShape, true);
      return true;
    });
  });
});

test('rejects foreign browser endpoint shape before ownership inspection', async () => {
  await withProfile(async ({ profile, preparedProfile }) => {
    await fs.writeFile(
      path.join(profile, 'DevToolsActivePort'),
      '9222\n/devtools/page/foreign-id\n',
    );
    await assert.rejects(connect(preparedProfile), (error) => {
      assert.equal(error.message, 'owned_cdp_endpoint_refused');
      assert.equal(error.endpointDiagnostic.reason, 'browser_path_shape');
      assert.equal(error.endpointDiagnostic.shape.browserPathShape, false);
      return true;
    });
  });
});
