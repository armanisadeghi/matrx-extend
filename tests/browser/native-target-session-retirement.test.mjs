import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { attachTargetSession, captureTarget } from './native-sidepanel-qa-harness.mjs';
import { evaluate } from './settings-panel-driver.mjs';

const { connectOwnedCdp } = createRequire(import.meta.url)('./vault-owned-cdp.cjs');

// Guest switches Chat version and reopens the native panel. Chrome retires the
// old flattened session; a redundant detach returns a protocol error. Only the
// external browser socket, profile filesystem and owner lookup are doubled.
async function environment({
  retireDuringAttach = false,
  retireDuringScreenshot = false,
  retireDuringDetach = false,
  detachRetirementId = 'old-panel-session',
  detachError = { code: -32602, message: 'No session with given id' },
} = {}) {
  let socket;
  const active = new Set();
  const commands = [];
  class BrowserSocket {
    constructor() {
      socket = this;
      setImmediate(() => this.onopen());
    }
    event(method, params) {
      this.onmessage({ data: JSON.stringify({ method, params }) });
    }
    send(raw) {
      const request = JSON.parse(raw);
      commands.push(request);
      setImmediate(() => {
        let result = {};
        let error;
        if (request.method === 'Target.attachToTarget') {
          result = { sessionId: `${request.params.targetId}-session` };
          active.add(result.sessionId);
        } else if (request.method === 'Target.detachFromTarget') {
          if (retireDuringDetach) {
            active.delete(request.params.sessionId);
            this.event('Target.detachedFromTarget', { sessionId: detachRetirementId });
          }
          if (!active.delete(request.params.sessionId)) error = detachError;
          else this.event('Target.detachedFromTarget', { sessionId: request.params.sessionId });
        } else if (request.method === 'Runtime.evaluate') {
          result = { result: { value: request.sessionId === 'replacement-panel-session' ? 1 : 0 } };
        }
        if (request.method === 'Page.captureScreenshot')
          result = { data: Buffer.alloc(128, 7).toString('base64') };
        this.onmessage({
          data: JSON.stringify({
            id: request.id,
            ...(request.sessionId && { sessionId: request.sessionId }),
            ...(error ? { error } : { result }),
          }),
        });
        const retiredSession =
          retireDuringAttach && request.method === 'Target.attachToTarget'
            ? result.sessionId
            : retireDuringScreenshot && request.method === 'Page.captureScreenshot'
              ? request.sessionId
              : null;
        if (retiredSession) {
          active.delete(retiredSession);
          this.event('Target.detachedFromTarget', { sessionId: retiredSession });
        }
      });
    }
    close() {
      setImmediate(() => this.onclose());
    }
  }
  const cdp = await connectOwnedCdp({
    preparedProfile: { profile: '/owned-guest-profile' },
    chromeExecutable: '/owned-chrome',
    fileSystem: {
      readFile: async () => '9222\n/devtools/browser/owned-browser',
      readlink: async () => 'runner-123',
    },
    processInspector: async () => ({
      executable: '/owned-chrome',
      args: '--user-data-dir=/owned-guest-profile',
    }),
    WebSocketCtor: BrowserSocket,
  });
  return {
    cdp,
    commands,
    silentlyRetire(sessionId) {
      active.delete(sessionId);
    },
    retire(sessionId) {
      active.delete(sessionId);
      socket.event('Target.detachedFromTarget', { sessionId });
    },
  };
}

test('auto-retired old panel cleanup preserves replacement Settings evaluation transport', async () => {
  const env = await environment();
  const old = await attachTargetSession(env.cdp, 'old-panel');
  env.retire('old-panel-session');
  const replacement = await attachTargetSession(env.cdp, 'replacement-panel');
  try {
    await old.detach();
    assert.equal(
      await evaluate(
        replacement,
        `document.querySelectorAll('button[role="tab"][title="Settings"]').length`,
      ),
      1,
    );
    assert.equal(env.cdp.fatal, false);
    assert.equal(
      env.commands.filter((call) => call.method === 'Target.detachFromTarget').length,
      0,
    );
  } finally {
    await env.cdp.detach().catch(() => {});
  }
});

test('foreign session retirement leaves live panel cleanup required and repeated cleanup harmless', async () => {
  const env = await environment();
  const panel = await attachTargetSession(env.cdp, 'old-panel');
  env.retire('sibling-panel-session');
  try {
    assert.equal(
      await evaluate(
        panel,
        `document.querySelectorAll('button[role="tab"][title="Settings"]').length`,
      ),
      0,
    );
    await panel.detachVerified();
    await panel.detach();
    await panel.detachVerified();
    assert.deepEqual(
      env.commands
        .filter((call) => call.method === 'Target.detachFromTarget')
        .map((call) => call.params),
      [{ sessionId: 'old-panel-session' }],
    );
    assert.equal(env.cdp.fatal, false);
  } finally {
    await env.cdp.detach().catch(() => {});
  }
});

test('unobserved retirement still rejects verified detach and preserves strict transport failure', async () => {
  const env = await environment();
  const panel = await attachTargetSession(env.cdp, 'old-panel');
  env.silentlyRetire('old-panel-session');
  try {
    await assert.rejects(panel.detachVerified(), /owned_cdp_transport_failed/);
    assert.equal(env.cdp.fatal, true);
    assert.equal(env.cdp.failureClass, 'protocol_error');
    await assert.rejects(panel.detachVerified(), /owned_cdp_transport_failed/);
  } finally {
    await env.cdp.detach().catch(() => {});
  }
});

test('concurrent cleanup sends one detach and retired session refuses further input locally', async () => {
  const env = await environment();
  const panel = await attachTargetSession(env.cdp, 'old-panel');
  try {
    await Promise.all([panel.detach(), panel.detachVerified()]);
    assert.equal(
      env.commands.filter((call) => call.method === 'Target.detachFromTarget').length,
      1,
    );
    await assert.rejects(
      evaluate(panel, `document.querySelectorAll('button[role="tab"][title="Settings"]').length`),
      /native_target_session_retired/,
    );
    assert.equal(env.cdp.fatal, false);
  } finally {
    await env.cdp.detach().catch(() => {});
  }
});

test('retirement delivered before attach continuation prevents stale cleanup and input', async () => {
  const env = await environment({ retireDuringAttach: true });
  try {
    const panel = await attachTargetSession(env.cdp, 'old-panel');
    await panel.detachVerified();
    await assert.rejects(evaluate(panel, 'document.readyState'), /native_target_session_retired/);
    assert.equal(
      env.commands.filter((call) => call.method === 'Target.detachFromTarget').length,
      0,
    );
    assert.equal(env.cdp.fatal, false);
  } finally {
    await env.cdp.detach().catch(() => {});
  }
});

test('screenshot capture cleans a retired session without poisoning browser transport', async () => {
  const env = await environment({ retireDuringScreenshot: true });
  const directory = await mkdtemp(join(tmpdir(), 't93-screenshot-'));
  try {
    const output = join(directory, 'panel.png');
    await captureTarget(env.cdp, 'old-panel', output);
    assert.equal((await readFile(output)).length, 128);
    await env.cdp.send('Browser.getVersion');
    assert.equal(env.cdp.fatal, false);
    assert.equal(
      env.commands.filter((call) => call.method === 'Target.detachFromTarget').length,
      0,
    );
  } finally {
    await env.cdp.detach().catch(() => {});
    await rm(directory, { recursive: true, force: true });
  }
});

test('retirement racing an in-flight detach completes cleanup without fatal transport', async () => {
  const env = await environment({ retireDuringDetach: true });
  try {
    const panel = await attachTargetSession(env.cdp, 'old-panel');
    await panel.detachVerified();
    await env.cdp.send('Browser.getVersion');
    assert.equal(env.cdp.fatal, false);
  } finally {
    await env.cdp.detach().catch(() => {});
  }
});

for (const options of [
  { detachRetirementId: 'foreign-panel-session' },
  { detachError: { code: -32000, message: 'No session with given id' } },
  { detachError: { code: -32602, message: 'Unexpected detach refusal' } },
]) {
  test(`detach race remains fatal without exact retirement/error evidence ${JSON.stringify(options)}`, async () => {
    const env = await environment({ retireDuringDetach: true, ...options });
    try {
      const panel = await attachTargetSession(env.cdp, 'old-panel');
      await assert.rejects(panel.detachVerified(), /owned_cdp_transport_failed/);
      assert.equal(env.cdp.fatal, true);
    } finally {
      await env.cdp.detach().catch(() => {});
    }
  });
}
