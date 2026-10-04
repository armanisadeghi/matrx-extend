import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { observeStartupGpu } from './startup-gpu-observation.mjs';

const require = createRequire(import.meta.url);
const { connectOwnedCdp } = require('../tests/browser/vault-owned-cdp.cjs');
const profile = '/verified/native-profile';
const executable = '/owned/Chromium';
const fileSystem = {
  async readFile() {
    return '9222\n/devtools/browser/owned-123';
  },
  async readlink() {
    return 'host-123';
  },
};
const processInspector = async () => ({
  executable,
  args: `--user-data-dir=${profile} --headless=new`,
});

class BrowserSocket {
  static sockets = [];
  constructor(url) {
    assert.equal(url, 'ws://127.0.0.1:9222/devtools/browser/owned-123');
    BrowserSocket.sockets.push(this);
    setImmediate(() => this.onopen());
  }
  send(raw) {
    const message = JSON.parse(raw);
    if (message.method === 'SystemInfo.getInfo') return; // Actual command deadline fires.
    setImmediate(() => this.onmessage({ data: JSON.stringify({ id: message.id, result: {} }) }));
  }
  close() {
    setImmediate(() => this.onclose());
  }
}

const connect = () =>
  connectOwnedCdp({
    preparedProfile: { profile },
    chromeExecutable: executable,
    fileSystem,
    processInspector,
    WebSocketCtor: BrowserSocket,
    timeoutMs: 25,
  });

test('timed out optional GPU transport records UNKNOWN while primary CDP keeps working', async () => {
  BrowserSocket.sockets.length = 0;
  const primary = await connect();
  try {
    const observed = [];
    const observation = observeStartupGpu(connect, (value) => observed.push(value));
    assert.equal(observed[0].status, 'UNKNOWN');
    assert.deepEqual(await primary.send('Target.getTargets'), {});
    await observation;
    assert.equal(observed[1].status, 'UNKNOWN');
    assert.match(observed[1].failedAt, /^20\d\d-/);
    assert.equal(primary.failureClass, 'none');
    assert.deepEqual(await primary.send('Target.getTargets'), {});
    assert.equal(BrowserSocket.sockets.length, 2);
  } finally {
    await primary.detach();
  }
});

test('required command timeout still poisons its own CDP transport', async () => {
  const primary = await connect();
  await assert.rejects(primary.send('SystemInfo.getInfo'), /owned_cdp_transport_failed/);
  assert.equal(primary.failureClass, 'command_timeout');
  await assert.rejects(primary.send('Target.getTargets'), /owned_cdp_transport_failed/);
  await assert.rejects(primary.detach(), /owned_cdp_transport_failed/);
});
