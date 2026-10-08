import assert from 'node:assert/strict';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  connectNativeStartupOwnedCdp,
  nativeCdpStartupDeadlineMs,
} from './native-sidepanel-qa-harness.mjs';

const require = createRequire(import.meta.url);
const { prepareOwnedProfile, connectOwnedCdp } = require('./vault-owned-cdp.cjs');
const chromeExecutable = '/owned/chrome';

class OpeningSocket {
  constructor() {
    setImmediate(() => this.onopen());
  }
  close() {
    setImmediate(() => this.onclose());
  }
}

test('native startup admits an owned endpoint arriving after the old 5-second cutoff', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'native-cdp-late-endpoint-'));
  let endpointTimer;
  try {
    const preparedProfile = await prepareOwnedProfile(profile);
    const endpoint = join(profile, 'DevToolsActivePort');
    const endpointRecord = '9222\n/devtools/browser/owned-id\n';
    const owner = async () => ({
      executable: chromeExecutable,
      args: `--user-data-dir=${profile} --remote-debugging-port=0`,
    });
    // The captured hosted run's endpoint appeared 1,145 ms after a 5,024 ms cutoff.
    // Exercise the same real file-read boundary with no Chrome or heavy job.
    let endpointWritten;
    const firstEndpoint = new Promise((resolve, reject) => {
      endpointTimer = setTimeout(() => {
        endpointWritten = writeFile(endpoint, endpointRecord).then(resolve, reject);
      }, 6_100);
    });
    await assert.rejects(
      connectOwnedCdp({
        preparedProfile,
        chromeExecutable,
        WebSocketCtor: OpeningSocket,
        processInspector: owner,
      }),
      /owned_cdp_endpoint_timeout/,
    );
    await firstEndpoint;
    clearTimeout(endpointTimer);
    await rm(endpoint);
    await symlink('host-123', join(profile, 'SingletonLock'));
    const configuredDeadlineMs = await nativeCdpStartupDeadlineMs();
    assert.ok(configuredDeadlineMs >= 6_200);
    endpointTimer = setTimeout(() => {
      endpointWritten = writeFile(endpoint, endpointRecord);
    }, 6_100);
    const connected = await connectNativeStartupOwnedCdp({
      preparedProfile,
      chromeExecutable,
      WebSocketCtor: OpeningSocket,
      processInspector: owner,
    });
    assert.equal(connected.ownerVerified, true);
    assert.equal(connected.timeoutMs, 5_000, 'socket commands retain their existing timeout');
    await connected.detach();
    await endpointWritten;
  } finally {
    clearTimeout(endpointTimer);
    await rm(profile, { recursive: true, force: true });
  }
});
