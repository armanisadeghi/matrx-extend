import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import {
  observeNativeCdpStartup,
  observeNativeStartupBoundary,
  safeEndpointObservation,
} from './native-cdp-startup-diagnostic.mjs';

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

// D298: the diagnostic uses the real endpoint/parser/owner boundary, without
// attaching to Chrome. Files are isolated and all endpoint values remain local.
const fsPromises = await import('node:fs/promises');
const { inspectOwnedCdpEndpointRecord } = require('./vault-owned-cdp.cjs');
const { safeEndpointWaitDiagnostic, observeOwnedEndpointAfterTimeout } = await import(
  './native-sidepanel-qa-harness.mjs'
);

async function recordFixture(action) {
  const profile = await mkdtemp(join(tmpdir(), 'owned-endpoint-observation-'));
  try {
    const preparedProfile = await prepareOwnedProfile(profile);
    await symlink('host-123', join(profile, 'SingletonLock'));
    const endpoint = join(profile, 'DevToolsActivePort');
    const owner = async () => ({ executable: '/owned/chrome', args: `--user-data-dir=${profile}` });
    await action({ profile, preparedProfile, endpoint, owner });
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
}

test('diagnostic validates the canonical owned record without constructing a socket', async () => {
  await recordFixture(async ({ preparedProfile, endpoint, owner }) => {
    let sockets = 0;
    const previous = globalThis.WebSocket;
    globalThis.WebSocket = class {
      constructor() {
        sockets++;
        throw new Error('socket forbidden');
      }
    };
    try {
      const input = {
        preparedProfile,
        chromeExecutable: '/owned/chrome',
        processInspector: owner,
        budgetMs: 1000,
      };
      for (const [raw, expected] of [
        ['9222\n/devtools/browser/captured-owned\n', 'validated_owned_record'],
        ['64231\n/devtools/browser/another-owned', 'validated_owned_record'],
        ['65536\n/devtools/browser/private-record', 'record_refused'],
        ['9222\n/devtools/browser/private-record\nextra', 'record_refused'],
      ]) {
        await writeFile(endpoint, raw);
        const value = await inspectOwnedCdpEndpointRecord(input);
        assert.equal(value.outcome, expected);
        assert.deepEqual(Object.keys(value).sort(), ['outcome', 'timing']);
        assert.doesNotMatch(
          JSON.stringify(value),
          /9222|64231|65536|devtools|captured-owned|private-record/,
        );
      }
      await writeFile(endpoint, '9222\n/devtools/browser/owned\n');
      assert.equal(
        (
          await inspectOwnedCdpEndpointRecord({
            ...input,
            processInspector: async () => ({
              executable: '/foreign/chrome',
              args: '--user-data-dir=/foreign',
            }),
          })
        ).outcome,
        'owner_refused',
      );
      await rm(endpoint);
      assert.equal((await inspectOwnedCdpEndpointRecord(input)).outcome, 'missing');
      assert.equal(sockets, 0, 'inspection must never enter socket or handshake path');
    } finally {
      globalThis.WebSocket = previous;
    }
  });
});

test('expired diagnostic cannot inspect a later filesystem result or advance to owner lookup', async () => {
  await recordFixture(async ({ preparedProfile, endpoint, owner }) => {
    await writeFile(endpoint, '9222\n/devtools/browser/owned\n');
    let release;
    let entered;
    let returned;
    let reads = 0;
    let owners = 0;
    const readEntered = new Promise((resolve) => {
      entered = resolve;
    });
    const readReturned = new Promise((resolve) => {
      returned = resolve;
    });
    const pendingRead = new Promise((resolve) => {
      release = resolve;
    });
    const input = {
      preparedProfile,
      chromeExecutable: '/owned/chrome',
      budgetMs: 50,
      processInspector: async (...args) => {
        owners++;
        return owner(...args);
      },
      fileSystem: {
        ...fsPromises,
        readFile: async (path) => {
          // Deliberately non-abortable external I/O: cancellation cannot make
          // this fixture skip the late-completion stage fence it must prove.
          const value = await fsPromises.readFile(path, 'utf8');
          entered();
          await pendingRead;
          returned();
          return value;
        },
        readlink: async (...args) => {
          reads++;
          return fsPromises.readlink(...args);
        },
      },
    };
    const pending = inspectOwnedCdpEndpointRecord(input);
    await readEntered;
    const value = await pending;
    assert.equal(value.outcome, 'budget_expired');
    release();
    await readReturned;
    await new Promise(setImmediate);
    assert.equal(reads, 0);
    assert.equal(owners, 0);
    assert.equal(value.outcome, 'budget_expired', 'late completion cannot change evidence');
  });
});

test('expired process inspection cannot turn a diagnostic into validated evidence', async () => {
  await recordFixture(async ({ preparedProfile, endpoint, owner }) => {
    await writeFile(endpoint, '9222\n/devtools/browser/owned\n');
    let release;
    let entered;
    const started = new Promise((resolve) => {
      entered = resolve;
    });
    const delayed = new Promise((resolve) => {
      release = resolve;
    });
    const pending = inspectOwnedCdpEndpointRecord({
      preparedProfile,
      chromeExecutable: '/owned/chrome',
      budgetMs: 200,
      processInspector: async () => {
        entered();
        await delayed;
        return owner();
      },
    });
    await Promise.race([started, pending.then(() => assert.fail('process fixture never entered'))]);
    const value = await pending;
    assert.equal(value.outcome, 'budget_expired');
    release();
    await new Promise(setImmediate);
    assert.equal(value.outcome, 'budget_expired');
  });
});

test('actual connector failures retain last-read intervals through the safe serializer', async () => {
  await recordFixture(async ({ preparedProfile, endpoint }) => {
    for (const [kind, expectedError, outcome] of [
      ['missing', 'owned_cdp_endpoint_timeout', 'missing'],
      ['denied', 'owned_cdp_endpoint_refused', 'read_error'],
      ['malformed', 'owned_cdp_endpoint_refused', 'read'],
    ]) {
      if (kind === 'malformed') await writeFile(endpoint, 'not-an-endpoint');
      else await rm(endpoint, { force: true });
      let error;
      try {
        await connectOwnedCdp({
          preparedProfile,
          chromeExecutable: '/owned/chrome',
          startupDeadlineMs: 5,
          WebSocketCtor: class {
            constructor() {
              assert.fail('failed record must not connect');
            }
          },
          fileSystem: {
            ...fsPromises,
            readFile: async (...args) => {
              // Deliberately straddle the polling-entry deadline, matching the
              // real long-read pattern. This is a timing test, not a readiness sleep.
              await new Promise((resolve) => setTimeout(resolve, 15));
              if (kind === 'denied')
                throw Object.assign(new Error('private denied'), { code: 'EACCES' });
              return fsPromises.readFile(...args);
            },
          },
        });
      } catch (caught) {
        error = caught;
      }
      assert.equal(error?.message, expectedError);
      const value = safeEndpointWaitDiagnostic(error);
      assert.equal(value.polls, 1);
      assert.equal(value.lastRead.outcome, outcome);
      assert.ok(value.lastRead.completedElapsedMs >= 5);
      assert.ok(value.lastRead.completedElapsedMs >= value.lastRead.startedElapsedMs);
      error.endpointWaitDiagnostic = {
        ...error.endpointWaitDiagnostic,
        privatePath: endpoint,
        lastRead: { ...value.lastRead, raw: 'private endpoint contents' },
      };
      assert.doesNotMatch(
        JSON.stringify(safeEndpointWaitDiagnostic(error)),
        /private|devtools|DevToolsActivePort/,
      );
      error.endpointWaitDiagnostic = {
        ...error.endpointWaitDiagnostic,
        lastRead: { ...value.lastRead, outcome: 'private' },
      };
      assert.equal(safeEndpointWaitDiagnostic(error), null);
    }
  });
});

test('post-timeout lstat completed after window remains unknown without starting record inspection', async () => {
  await recordFixture(async ({ profile, endpoint }) => {
    await writeFile(endpoint, '9222\n/devtools/browser/owned\n');
    let elapsed = 0;
    const value = await observeOwnedEndpointAfterTimeout({
      profile,
      chromeExecutable: '/owned/chrome',
      child: { exitCode: null, signalCode: null },
      windowMs: 10,
      clock: { now: () => elapsed },
      fileSystem: {
        ...fsPromises,
        lstat: async (...args) => {
          const value = await fsPromises.lstat(...args);
          elapsed = 12;
          return value;
        },
      },
    });
    assert.equal(value.endpointPresent, null);
    assert.equal(value.presenceBasis, 'unobserved');
    assert.equal(value.sampleTiming, null);
    assert.equal(value.inspectionFailed, true);
    assert.equal(value.recordInspection.outcome, 'not_attempted');
    assert.equal(value.elapsedMs, 12);
  });
});

test('diagnostic abort drains both owned process-inspection children before returning', async () => {
  await recordFixture(async ({ preparedProfile, endpoint }) => {
    await writeFile(endpoint, '9222\n/devtools/browser/owned\n');
    const source = await readFile(new URL('./vault-owned-cdp.cjs', import.meta.url), 'utf8');
    const { execFile } = require('node:child_process');
    const exercise = async (body) => {
      const children = new Set();
      const closes = [];
      const exports = {};
      let spawned = 0;
      const slowPs = (_file, _args, options, callback) => {
        // External ps stand-in: real owned foreground children stalled until
        // production abort. Parser, stage fencing and cleanup stay real.
        const child = execFile(
          process.execPath,
          ['-e', 'setInterval(() => {}, 1000)'],
          options,
          callback,
        );
        spawned++;
        children.add(child);
        closes.push(
          new Promise((resolve) =>
            child.once('close', () => {
              children.delete(child);
              resolve();
            }),
          ),
        );
        return child;
      };
      slowPs[require('node:util').promisify.custom] = (...args) => {
        let child;
        const pending = new Promise((resolve, reject) => {
          child = slowPs(...args, (error, stdout, stderr) => {
            if (error) reject(error);
            else resolve({ stdout, stderr });
          });
        });
        pending.child = child;
        return pending;
      };
      runInNewContext(body, {
        require: (name) => (name === 'node:child_process' ? { execFile: slowPs } : require(name)),
        exports,
        Error,
        performance,
        AbortController,
        setTimeout,
        clearTimeout,
      });
      try {
        const value = await exports.inspectOwnedCdpEndpointRecord({
          preparedProfile,
          chromeExecutable: '/owned/chrome',
          budgetMs: 300,
        });
        assert.equal(value.outcome, 'budget_expired');
        assert.equal(spawned, 2, 'both actual default ps children must be exercised');
        assert.equal(children.size, 0, 'abort must drain the actual child close events');
      } finally {
        // Even a deliberately broken drain must leave no owned process behind.
        await Promise.all(closes);
      }
    };
    await exercise(source);
    const mutated = source.replace('return pending.finally(() => closed);', 'return pending;');
    assert.notEqual(mutated, source, 'mutation must remove the actual default-inspector drain');
    await assert.rejects(exercise(mutated), /abort must drain the actual child close events/);
  });
});

test('record validation guard rejects a constant validated-result mutation', async () => {
  await recordFixture(async ({ preparedProfile, endpoint, owner }) => {
    await writeFile(endpoint, '65536\n/devtools/browser/owned\n');
    const source = await readFile(new URL('./vault-owned-cdp.cjs', import.meta.url), 'utf8');
    const start = source.indexOf('async function inspectOwnedCdpEndpointRecord(');
    const end = source.indexOf('async function connectOwnedCdp(', start);
    assert.ok(start >= 0 && end > start, 'mutation must target actual diagnostic entry point');
    const mutated = `${source.slice(0, start)}async function inspectOwnedCdpEndpointRecord() {
      return { outcome: 'validated_owned_record', timing: null };
    }\n${source.slice(end)}`;
    const exports = {};
    runInNewContext(mutated, {
      require,
      exports,
      Error,
      performance,
      AbortController,
      setTimeout,
      clearTimeout,
    });
    const assertRefusal = async (inspect) => {
      const value = await inspect({
        preparedProfile,
        chromeExecutable: '/owned/chrome',
        processInspector: owner,
        budgetMs: 1000,
      });
      assert.equal(
        value.outcome,
        'record_refused',
        'malformed record cannot become validated evidence',
      );
    };
    await assertRefusal(inspectOwnedCdpEndpointRecord);
    await assert.rejects(
      assertRefusal(exports.inspectOwnedCdpEndpointRecord),
      /malformed record cannot become validated evidence/,
    );
  });
});

test('actual failed-read timing guard rejects dropped last-read metadata', async () => {
  await recordFixture(async ({ preparedProfile }) => {
    const source = await readFile(new URL('./vault-owned-cdp.cjs', import.meta.url), 'utf8');
    const mutated = source.replace('    lastRead,', '    lastRead: null,');
    assert.notEqual(mutated, source, 'mutation must drop the actual failure metadata field');
    const exports = {};
    runInNewContext(mutated, {
      require,
      exports,
      Error,
      performance,
      AbortController,
      setTimeout,
      clearTimeout,
    });
    const assertRead = async (connect) => {
      let error;
      try {
        await connect({
          preparedProfile,
          chromeExecutable: '/owned/chrome',
          startupDeadlineMs: 5,
          WebSocketCtor: class {
            constructor() {
              assert.fail('missing record cannot construct socket');
            }
          },
        });
      } catch (caught) {
        error = caught;
      }
      assert.equal(error?.message, 'owned_cdp_endpoint_timeout');
      const safe = safeEndpointWaitDiagnostic(error);
      assert.equal(
        safe?.lastRead?.outcome,
        'missing',
        'last completed read must survive actual error serialization',
      );
    };
    await assertRead(connectOwnedCdp);
    await assert.rejects(
      assertRead(exports.connectOwnedCdp),
      /last completed read must survive actual error serialization/,
    );
  });
});

test('failed filesystem observation guard rejects manufactured absence mutation', async () => {
  const source = observeOwnedEndpointAfterTimeout.toString();
  const mutated = source.replace(
    "if (sample.failed && sample.error?.code !== 'ENOENT') {\n      endpointPresent = null;",
    "if (sample.failed && sample.error?.code !== 'ENOENT') {\n      endpointPresent = false;",
  );
  assert.notEqual(mutated, source, 'mutation must target the real inspection error branch');
  const inspect = runInNewContext(`(${mutated})`, {
    join,
    performance,
    wait: async () => {},
    setTimeout,
    clearTimeout,
  });
  const assertUnknown = async (observe) => {
    const result = await observe({
      profile: '/owned/profile',
      windowMs: 100,
      child: { exitCode: null, signalCode: null },
      sleep: async () => {},
      fileSystem: {
        lstat: async () => {
          throw Object.assign(new Error('private denied'), { code: 'EACCES' });
        },
      },
    });
    assert.equal(result.endpointPresent, null, 'inspection failure cannot prove absence');
  };
  await assertUnknown(observeOwnedEndpointAfterTimeout);
  await assert.rejects(assertUnknown(inspect), /inspection failure cannot prove absence/);
});

// Break: an awaited noncancelable lstat can retain the owned browser forever.
async function assertExpiredOuterLstat(observe, { rejectLate = false, afterMissing = false } = {}) {
  let resolveRead;
  let rejectRead;
  let entered;
  let calls = 0;
  let recordReads = 0;
  let lockReads = 0;
  const readEntered = new Promise((resolve) => {
    entered = resolve;
  });
  const deferred = new Promise((resolve, reject) => {
    resolveRead = resolve;
    rejectRead = reject;
  });
  const pending = observe({
    profile: '/owned/profile',
    chromeExecutable: '/owned/chrome',
    child: { exitCode: null, signalCode: null },
    windowMs: 40,
    sleep: async () => {},
    fileSystem: {
      lstat: () => {
        calls++;
        if (afterMissing && calls === 1)
          return Promise.reject(Object.assign(new Error('missing'), { code: 'ENOENT' }));
        entered();
        return deferred;
      },
      readFile: async () => {
        recordReads++;
        return '9222\n/devtools/browser/private\n';
      },
      readlink: async () => {
        lockReads++;
        return 'private-123';
      },
    },
  });
  let watchdog;
  const noUnhandled = [];
  const onUnhandled = (error) => noUnhandled.push(error);
  process.on('unhandledRejection', onUnhandled);
  try {
    await readEntered;
    const value = await Promise.race([
      pending,
      new Promise((resolve) => {
        watchdog = setTimeout(() => resolve('still_pending'), 250);
      }),
    ]);
    assert.notEqual(
      value,
      'still_pending',
      'outer lstat must release original failure cleanup within its existing observation window',
    );
    assert.equal(value.endpointPresent, null);
    assert.equal(value.presenceBasis, 'unobserved');
    assert.equal(value.sampleTiming, null);
    assert.equal(value.inspectionFailed, true);
    assert.deepEqual(value.recordInspection, { outcome: 'not_attempted', timing: null });
    safeEndpointObservation(value);
    const before = JSON.stringify(value);
    if (rejectLate) rejectRead(new Error('late private lstat rejection'));
    else resolveRead({});
    await new Promise(setImmediate);
    await new Promise(setImmediate);
    assert.equal(JSON.stringify(value), before, 'late lstat cannot mutate returned observation');
    assert.equal(recordReads, 0, 'late lstat cannot launch canonical record parsing');
    assert.equal(lockReads, 0, 'late lstat cannot launch owner inspection');
    assert.deepEqual(noUnhandled, [], 'late rejected lstat must stay handled');
  } finally {
    clearTimeout(watchdog);
    resolveRead({});
    await pending;
    process.removeListener('unhandledRejection', onUnhandled);
  }
}

test('outer post-timeout lstat expiry releases cleanup and fences late resolution', async () => {
  await assertExpiredOuterLstat(observeOwnedEndpointAfterTimeout);
});
test('outer post-timeout lstat expiry handles late rejection without leaking an earlier missing sample', async () => {
  await assertExpiredOuterLstat(observeOwnedEndpointAfterTimeout, {
    rejectLate: true,
    afterMissing: true,
  });
});

async function assertTimelyOuterPresence(observe) {
  let recordReads = 0;
  const value = await observe({
    profile: '/owned/profile',
    chromeExecutable: '/owned/chrome',
    child: { exitCode: null, signalCode: null },
    windowMs: 1000,
    fileSystem: {
      lstat: async () => ({}),
      readFile: async () => {
        recordReads++;
        throw Object.assign(new Error('denied'), { code: 'EACCES' });
      },
    },
  });
  assert.equal(
    value.endpointPresent,
    true,
    'timely real presence must not become constant unknown',
  );
  assert.equal(value.presenceBasis, 'lstat');
  assert.equal(value.inspectionFailed, false);
  assert.equal(value.recordInspection.outcome, 'inspection_failed');
  assert.equal(recordReads, 1, 'timely real presence must reach canonical record inspection');
  safeEndpointObservation(value);
}

test('outer lstat guard distinguishes timely presence from constant unknown and omitted bound mutants', async () => {
  await assertTimelyOuterPresence(observeOwnedEndpointAfterTimeout);
  await assert.rejects(
    assertTimelyOuterPresence(async () => ({ endpointPresent: null })),
    /timely real presence/,
  );
  const source = observeOwnedEndpointAfterTimeout.toString();
  const omitted = source
    .replace('sample = await Promise.race([', 'sample = await pending; /*')
    .replace(
      '    } finally {\n      clearTimeout(timer);',
      '*/\n    } finally {\n      clearTimeout(timer);',
    );
  assert.notEqual(omitted, source, 'in-memory mutation must remove outer lstat race');
  const inspect = runInNewContext(`(${omitted})`, {
    join,
    performance,
    wait: async () => {},
    setTimeout,
    clearTimeout,
    inspectOwnedCdpEndpointRecord,
  });
  await assert.rejects(
    assertExpiredOuterLstat(inspect),
    /outer lstat must release original failure cleanup/,
  );
});

test('passive child snapshot compares only sampled original child and fences stalled readlink', async () => {
  await recordFixture(async ({ preparedProfile }) => {
    const child = {
      pid: 123,
      exitCode: null,
      signalCode: null,
      stderr: { destroyed: false, readableEnded: false },
    };
    const same = await observeNativeStartupBoundary({ preparedProfile, startupChild: child }, 1000);
    assert.deepEqual(same, {
      profileLock: 'spawned_child',
      childExitObserved: false,
      stderrClosed: false,
      stderrReadableEnded: false,
    });
    const other = await observeNativeStartupBoundary(
      { preparedProfile, startupChild: { ...child, pid: 456, exitCode: 1 } },
      1000,
    );
    assert.equal(other.profileLock, 'other_owner');
    assert.equal(other.childExitObserved, true);
    let resolveRead;
    const delayed = new Promise((resolve) => {
      resolveRead = resolve;
    });
    const value = await observeNativeStartupBoundary(
      { preparedProfile, startupChild: child, fileSystem: { readlink: () => delayed } },
      20,
    );
    const before = JSON.stringify(value);
    assert.deepEqual(value, {
      profileLock: 'unavailable',
      childExitObserved: null,
      stderrClosed: null,
      stderrReadableEnded: null,
    });
    resolveRead('private-lock-123');
    await new Promise(setImmediate);
    assert.equal(JSON.stringify(value), before, 'late snapshot cannot mutate returned unknown');
    assert.doesNotMatch(
      JSON.stringify([same, other, value]),
      /private-lock|\/owned\/profile|123|456/,
    );
  });
});

async function assertLstatRejectionKinds(observe) {
  for (const reason of [
    null,
    undefined,
    false,
    0,
    '',
    Object.assign(new Error('missing'), { code: 'ENOENT' }),
  ]) {
    const missing = reason?.code === 'ENOENT';
    const value = await observe({
      profile: '/owned/profile',
      chromeExecutable: '/owned/chrome',
      child: { exitCode: 1, signalCode: null },
      windowMs: 1000,
      fileSystem: { lstat: () => Promise.reject(reason) },
    });
    assert.equal(
      value.endpointPresent,
      missing ? false : null,
      'only actual ENOENT may become measured absence',
    );
    assert.equal(
      value.inspectionFailed,
      !missing,
      'every other rejected value is failed measurement',
    );
    assert.equal(value.presenceBasis, missing ? 'lstat' : 'unobserved');
    safeEndpointObservation(value);
  }
}

test('outer lstat rejects falsy failure reasons as unknown and reserves absence for ENOENT', async () => {
  await assertLstatRejectionKinds(observeOwnedEndpointAfterTimeout);
  const source = observeOwnedEndpointAfterTimeout.toString();
  const omitted = source
    .replace('return { failed: true, error };', 'return { error };')
    .replace(
      "if (sample.failed && sample.error?.code !== 'ENOENT') {",
      "if (sample.error && sample.error.code !== 'ENOENT') {",
    );
  assert.notEqual(omitted, source, 'mutation must remove rejection tagging');
  const inspect = runInNewContext(`(${omitted})`, {
    join,
    performance,
    wait: async () => {},
    setTimeout,
    clearTimeout,
    inspectOwnedCdpEndpointRecord,
  });
  await assert.rejects(assertLstatRejectionKinds(inspect), /only actual ENOENT/);
  await assert.rejects(
    assertLstatRejectionKinds(async () => ({
      phase: 'post_timeout',
      endpointPresent: null,
      presenceBasis: 'unobserved',
      sampleTiming: null,
      inspectionFailed: true,
      recordInspection: { outcome: 'not_attempted', timing: null },
      exitObserved: true,
      elapsedMs: 0,
      polls: 1,
    })),
    /only actual ENOENT/,
  );
});
