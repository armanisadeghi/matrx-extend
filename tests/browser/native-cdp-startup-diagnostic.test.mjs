import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { observeNativeCdpStartup } from './native-cdp-startup-diagnostic.mjs';

const require = createRequire(import.meta.url);
const { prepareOwnedProfile, connectOwnedCdp } = require('./vault-owned-cdp.cjs');
const source = await readFile(
  new URL('./native-sidepanel-qa-harness.mjs', import.meta.url),
  'utf8',
);
const callsite = source
  .slice(
    source.indexOf('export async function connectNativeStartupOwnedCdp'),
    source.indexOf('\nconst wait ='),
  )
  .replace('export ', '');

// SUT: real native startup callsite -> diagnostic -> real owned-CDP connector.
// The local HTTP server stands in for Chrome; only the external WebSocket can
// be stalled independently, as in the captured open-timeout failure.
async function drive({
  stalled = false,
  enabled = true,
  sinkFails = false,
  blockEventLoop = false,
  ownerRefused = false,
} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'native-cdp-diagnostic-'));
  const profile = join(root, 'profile');
  const sockets = new Set();
  const server = createServer();
  let handshakes = 0;
  const observations = [];
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
  });
  server.on('upgrade', (req, socket) => {
    handshakes++;
    const accept = createHash('sha1')
      .update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest('base64');
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    socket.on('data', () => socket.end(Buffer.from([0x88, 0x00])));
  });
  class StalledSocket extends EventTarget {
    constructor() {
      super();
      if (blockEventLoop) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 40);
    }
    close() {
      setImmediate(() => {
        this.dispatchEvent(new Event('close'));
        this.onclose?.();
      });
    }
  }
  try {
    await mkdir(profile);
    const preparedProfile = await prepareOwnedProfile(profile);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    await writeFile(
      join(profile, 'DevToolsActivePort'),
      `${server.address().port}\n/devtools/browser/owned-id\n`,
    );
    await symlink('host-123', join(profile, 'SingletonLock'));
    const invoke = runInNewContext(`${callsite}; connectNativeStartupOwnedCdp`, {
      connectOwnedCdp,
      nativeCdpStartupDeadlineMs: async () => 500,
      observeNativeCdpStartup: (options, connect) =>
        observeNativeCdpStartup(options, connect, {
          enabled,
          emit(value) {
            if (sinkFails) throw new Error('private sink');
            observations.push(value);
          },
        }),
    });
    const pending = invoke({
      preparedProfile,
      chromeExecutable: '/owned/chrome',
      timeoutMs: 80,
      processInspector: async () => ({
        executable: ownerRefused ? '/other/chrome' : '/owned/chrome',
        args: `--user-data-dir=${profile}`,
      }),
      ...(stalled ? { WebSocketCtor: StalledSocket } : {}),
    });
    if (ownerRefused) await assert.rejects(pending, /^Error: owned_cdp_owner_refused$/);
    else if (stalled) await assert.rejects(pending, /^Error: owned_cdp_open_timeout$/);
    else {
      const result = await pending;
      assert.equal(result.ownerVerified, true);
      await result.detach();
    }
    return { observations, handshakes };
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
}

test('real startup callsite distinguishes native open from a stalled native socket with healthy owned loopback', async () => {
  for (const stalled of [false, true]) {
    const { observations, handshakes } = await drive({ stalled });
    assert.equal(
      observations.length,
      1,
      'owned CDP boundary diagnostic missing at actual native startup callsite',
    );
    const receipt = observations[0];
    assert.equal(receipt.outcome, stalled ? 'failed' : 'connected');
    const phases = receipt.phases.map((item) => item.phase);
    for (const phase of [
      'endpoint_read',
      'owner_check_started',
      'owner_verified',
      'socket_constructed',
      'connector_settled',
    ])
      assert.ok(phases.includes(phase), `diagnostic lost ${phase}`);
    assert.equal(phases.includes('socket_open'), !stalled);
    if (stalled) {
      assert.equal(handshakes, 1, 'independent probe must perform real owned-loopback work');
      assert.equal(receipt.phases.find((item) => item.phase === 'probe_http_status')?.status, 101);
      assert.ok(phases.includes('probe_tcp_connected'));
      assert.ok(phases.includes('socket_close_requested'));
      assert.ok(phases.indexOf('socket_close_requested') < phases.indexOf('connector_settled'));
    }
    assert.doesNotMatch(
      JSON.stringify(receipt),
      /owned-id|127\.0\.0\.1|\/profile|\/devtools|Sec-WebSocket|private/,
    );
    assert.ok(
      receipt.phases.every((item) => Number.isSafeInteger(item.elapsedMs) && item.elapsedMs >= 0),
    );
  }
});

test('disabled startup keeps the real connector result with no extra loopback handshake', async () => {
  const { observations, handshakes } = await drive({ enabled: false });
  assert.deepEqual(observations, []);
  assert.equal(handshakes, 1);
});

test('diagnostic sink failure preserves the real owned socket timeout', async () => {
  await drive({ stalled: true, sinkFails: true });
});

test('startup captures actual timer lateness when the Node event loop is blocked', async () => {
  const { observations } = await drive({ stalled: true, blockEventLoop: true });
  assert.ok(
    observations[0].longestTimerDelayMs >= 20,
    'diagnostic lost real event-loop starvation',
  );
});

test('refused ownership cannot start an independent loopback probe', async () => {
  const { observations, handshakes } = await drive({ ownerRefused: true });
  assert.equal(handshakes, 0);
  assert.equal(observations[0].outcome, 'failed');
  assert.equal(
    observations[0].phases.some((item) => item.phase === 'socket_constructed'),
    false,
  );
});
