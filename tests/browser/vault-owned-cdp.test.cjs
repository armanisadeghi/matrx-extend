'use strict';
const assert = require('node:assert/strict');
const { prepareOwnedProfile, connectOwnedCdp } = require('./vault-owned-cdp.cjs');
const files = new Map();
const fs = {
  async lstat(p) {
    if (p === '/p') return { isSymbolicLink: () => false, isDirectory: () => true };
    const e = new Error();
    e.code = 'ENOENT';
    throw e;
  },
  async readFile(p) {
    if (!files.has(p)) {
      const e = new Error();
      e.code = 'ENOENT';
      throw e;
    }
    return files.get(p);
  },
  async readlink() {
    return 'host-123';
  },
};
class WS {
  constructor() {
    setImmediate(() => this.onopen());
  }
  send(raw) {
    const m = JSON.parse(raw);
    setImmediate(() =>
      this.onmessage({
        data: JSON.stringify({
          id: m.id,
          result: {},
          ...(m.sessionId ? { sessionId: m.sessionId } : {}),
        }),
      }),
    );
  }
  close() {
    setImmediate(() => this.onclose());
  }
}
class NeverOpenWS {
  close() {
    setImmediate(() => this.onclose());
  }
}
class ThrowingWS {
  constructor() {
    throw new Error('private socket construction detail');
  }
}
(async () => {
  const p = await prepareOwnedProfile('/p', fs);
  files.set('/p/DevToolsActivePort', '9222\n/devtools/browser/a-b');
  const c = await connectOwnedCdp({
    preparedProfile: p,
    chromeExecutable:
      '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    fileSystem: fs,
    WebSocketCtor: WS,
    processInspector: async () => ({
      executable:
        '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
      args: '\0--user-data-dir=/p\0--headless',
    }),
  });
  await c.send('Browser.getVersion');
  await c.detach();
  assert.equal(c.ownerVerified, true);
  files.delete('/p/DevToolsActivePort');
  await assert.rejects(
    () =>
      connectOwnedCdp({
        preparedProfile: p,
        chromeExecutable:
          '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
        fileSystem: fs,
        WebSocketCtor: WS,
        timeoutMs: 40,
      }),
    (error) => {
      assert.equal(error.message, 'owned_cdp_endpoint_timeout');
      assert.ok(error.endpointWaitDiagnostic.polls >= 1);
      assert.ok(error.endpointWaitDiagnostic.elapsedMs >= 0);
      assert.ok(error.endpointWaitDiagnostic.longestReadMs >= 0);
      return true;
    },
  );
  files.set('/p/DevToolsActivePort', '9222\n/devtools/browser/a-b');
  await assert.rejects(
    () =>
      connectOwnedCdp({
        preparedProfile: p,
        chromeExecutable:
          '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
        fileSystem: fs,
        WebSocketCtor: WS,
        processInspector: async () => ({
          executable:
            '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
          args: '\0--user-data-dir=/prefix/p',
        }),
      }),
    /owner/,
  );
  await assert.rejects(
    () =>
      connectOwnedCdp({
        preparedProfile: p,
        chromeExecutable:
          '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
        fileSystem: fs,
        WebSocketCtor: WS,
        processInspector: async () => {
          throw new Error('private process inspection detail');
        },
      }),
    /owned_cdp_process_inspection_failed/,
  );
  await assert.rejects(
    () =>
      connectOwnedCdp({
        preparedProfile: p,
        chromeExecutable:
          '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
        fileSystem: fs,
        WebSocketCtor: NeverOpenWS,
        processInspector: async () => ({
          executable:
            '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
          args: '\0--user-data-dir=/p\0--headless',
        }),
        timeoutMs: 5,
      }),
    /owned_cdp_open_timeout/,
  );
  await assert.rejects(
    () =>
      connectOwnedCdp({
        preparedProfile: p,
        chromeExecutable:
          '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
        fileSystem: fs,
        WebSocketCtor: ThrowingWS,
        processInspector: async () => ({
          executable:
            '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
          args: '\0--user-data-dir=/p\0--headless',
        }),
      }),
    /owned_cdp_socket_construction_failed/,
  );
  process.stdout.write('PASS: owned flat CDP validates profile and correlates responses\n');
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
