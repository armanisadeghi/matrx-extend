import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { captureReloadLifetime } from './profile-reload-capture.mjs';
import { startReloadLifetimeDiagnostic } from './reload-lifetime-diagnostic.mjs';

const extensionId = 'cihdmkcdjjckfhjpgoedmgfpoljebaml';
const prefix = `chrome-extension://${extensionId}/`;
class Session extends EventEmitter {
  constructor(send) {
    super();
    this.responses = send;
    this.detached = false;
    this.calls = [];
  }
  async send(method, args) {
    this.calls.push(method);
    return this.responses(method, args, this);
  }
  async detach() {
    this.detached = true;
  }
}
function fixture(hostOutcome = 'present') {
  const browserSession = new Session((method, args) => {
    if (method === 'Browser.getVersion')
      return {
        protocolVersion: '1.3',
        product: 'Chrome/141.0.7390.37',
        revision: '@12345',
        userAgent: 'private',
      };
    if (method === 'Target.setDiscoverTargets') return {};
    if (method === 'Target.getTargets')
      return {
        targetInfos: [
          {
            targetId: 'old-worker',
            type: 'service_worker',
            url: `${prefix}background.js`,
            attached: true,
            title: 'private',
          },
        ],
      };
    if (method === 'Target.getTargetInfo') {
      if (args.targetId === 'new-worker')
        return {
          targetInfo: {
            targetId: 'new-worker',
            type: 'service_worker',
            attached: false,
            url: `${prefix}background.js`,
          },
        };
      if (hostOutcome === 'absent') throw new Error('No target with given id found');
      if (hostOutcome === 'failure') throw new Error('WebSocket disconnected with private URL');
      return {
        targetInfo: {
          targetId: 'old-worker',
          type: 'service_worker',
          attached: true,
          url: `${prefix}background.js`,
        },
      };
    }
    throw new Error(`unexpected ${method}`);
  });
  const pageSession = new Session((method, _, session) => {
    if (method === 'ServiceWorker.enable') {
      session.emit('ServiceWorker.workerVersionUpdated', {
        versions: [
          {
            versionId: 'version-old',
            registrationId: 'registration-1',
            scriptURL: `${prefix}background.js`,
            targetId: 'old-worker',
            runningStatus: 'running',
            status: 'activated',
          },
        ],
      });
    }
    return {};
  });
  return {
    browserSession,
    pageSession,
    browser: { newBrowserCDPSession: async () => browserSession },
    context: { newCDPSession: async () => pageSession },
    page: {},
  };
}

test('old version survives stopped update without targetId and retained host differs from absent host', async () => {
  for (const [outcome, expected] of [
    ['present', 'present'],
    ['absent', 'target_absent'],
    ['failure', 'probe_failed'],
  ]) {
    const f = fixture(outcome);
    const diagnostic = await startReloadLifetimeDiagnostic({ ...f, extensionId });
    diagnostic.correlateOld('old-worker');
    f.pageSession.emit('ServiceWorker.workerVersionUpdated', {
      versions: [
        {
          versionId: 'version-old',
          registrationId: 'registration-1',
          scriptURL: `${prefix}background.js`,
          runningStatus: 'stopped',
          status: 'activated',
        },
      ],
    });
    f.browserSession.emit('Target.targetDestroyed', { targetId: 'old-worker' });
    await diagnostic.probe('old-worker', 'new-worker');
    const captured = captureReloadLifetime(diagnostic.evidence);
    assert.equal(captured.old_version_mapping, 'correlated');
    assert.equal(captured.old_version_id, 'version-old');
    assert.equal(captured.versions.at(-1).target_id, null);
    assert.equal(captured.versions.at(-1).running_status, 'stopped');
    assert.equal(captured.old_host_probe.outcome, expected);
    assert.equal(captured.replacement_host_probe.outcome, 'present');
    assert.equal(captured.independent_targets.at(-1).phase, 'destroyed');
    assert.doesNotMatch(JSON.stringify(captured), /private|background\.js|userAgent/);
    await diagnostic.close();
    assert.equal(f.pageSession.detached, true);
    assert.equal(f.browserSession.detached, true);
    assert.equal(f.pageSession.listenerCount('ServiceWorker.workerVersionUpdated'), 0);
    assert.equal(f.browserSession.listenerCount('Target.targetDestroyed'), 0);
    assert.deepEqual(f.pageSession.calls.slice(-1), ['ServiceWorker.disable']);
  }
});

test('missing pre-click mapping remains unmeasured and cleanup survives probe failure', async () => {
  const f = fixture('failure');
  const diagnostic = await startReloadLifetimeDiagnostic({ ...f, extensionId });
  diagnostic.correlateOld('unknown-worker');
  await diagnostic.probe('old-worker', null);
  assert.equal(diagnostic.evidence.old_version_mapping, 'unmeasured');
  assert.equal(diagnostic.evidence.old_host_probe.outcome, 'probe_failed');
  assert.equal(diagnostic.evidence.replacement_host_probe.outcome, 'unmeasured');
  await diagnostic.close();
  assert.equal(f.browserSession.detached, true);
});

test('fresh replacement observer distinguishes activation from stale, wrong, and unavailable status without accepting reload', async () => {
  const original = {
    versionId: 'version-new',
    registrationId: 'registration-2',
    scriptURL: `${prefix}background.js`,
    targetId: 'new-worker',
    runningStatus: 'starting',
    status: 'new',
  };
  for (const [name, update, expected] of [
    ['activated', { ...original, runningStatus: 'running', status: 'activated' }, 'activated'],
    ['still new', original, 'not_activated'],
    ['wrong version', { ...original, versionId: 'foreign-version' }, 'identity_mismatch'],
    [
      'wrong registration',
      { ...original, registrationId: 'foreign-registration' },
      'identity_mismatch',
    ],
    ['wrong target', { ...original, targetId: 'foreign-worker' }, 'identity_mismatch'],
    ['unavailable', null, 'unavailable'],
  ]) {
    const f = fixture();
    const diagnostic = await startReloadLifetimeDiagnostic({ ...f, extensionId });
    diagnostic.correlateOld('old-worker');
    f.pageSession.emit('ServiceWorker.workerVersionUpdated', { versions: [original] });
    const fresh = new Session((method, _, session) => {
      if (method === 'ServiceWorker.enable') {
        if (!update) throw new Error('private protocol failure');
        session.emit('ServiceWorker.workerVersionUpdated', { versions: [update] });
      }
      return {};
    });
    f.context.newCDPSession = async () => fresh;
    const result = await diagnostic.observeFreshReplacement('new-worker');
    assert.equal(result.outcome, expected, name);
    assert.equal(diagnostic.executionRetired('old-worker', 'new-worker'), false, name);
    const captured = captureReloadLifetime(diagnostic.evidence);
    assert.equal(captured.fresh_replacement.outcome, expected);
    assert.doesNotMatch(JSON.stringify(captured), /private|background\.js/);
    assert.equal(fresh.detached, true);
    assert.equal(fresh.listenerCount('ServiceWorker.workerVersionUpdated'), 0);
    assert.deepEqual(fresh.calls, ['ServiceWorker.enable', 'ServiceWorker.disable']);
    await diagnostic.close();
  }
});

test('fresh replacement observation bounds nonsettling create, enable, disable, and detach', async () => {
  const never = new Promise(() => {});
  for (const phase of ['create', 'enable', 'disable', 'detach']) {
    const f = fixture();
    const diagnostic = await startReloadLifetimeDiagnostic({ ...f, extensionId });
    diagnostic.correlateOld('old-worker');
    f.pageSession.emit('ServiceWorker.workerVersionUpdated', {
      versions: [
        {
          versionId: 'version-new',
          registrationId: 'registration-2',
          scriptURL: `${prefix}background.js`,
          targetId: 'new-worker',
          runningStatus: 'starting',
          status: 'new',
        },
      ],
    });
    const fresh = new Session((method, _, session) => {
      if (method === 'ServiceWorker.enable') {
        if (phase === 'enable') return never;
        session.emit('ServiceWorker.workerVersionUpdated', {
          versions: [
            {
              versionId: 'version-new',
              registrationId: 'registration-2',
              scriptURL: `${prefix}background.js`,
              targetId: 'new-worker',
              runningStatus: 'running',
              status: 'activated',
            },
          ],
        });
      }
      if (method === 'ServiceWorker.disable' && phase === 'disable') return never;
      return {};
    });
    if (phase === 'detach') fresh.detach = async () => never;
    f.context.newCDPSession = async () => (phase === 'create' ? never : fresh);
    const started = performance.now();
    const result = await diagnostic.observeFreshReplacement('new-worker', 45);
    assert.ok(performance.now() - started < 250, `${phase} exceeded bounded observation`);
    assert.equal(result.outcome, 'unavailable', phase);
    assert.equal(
      result.cleanup,
      phase === 'create' || phase === 'disable' || phase === 'detach' ? 'unconfirmed' : 'confirmed',
    );
    if (phase !== 'create')
      assert.equal(fresh.listenerCount('ServiceWorker.workerVersionUpdated'), 0);
    if (phase === 'disable') assert.equal(fresh.detached, true);
    assert.equal(diagnostic.executionRetired('old-worker', 'new-worker'), false);
    await diagnostic.close();
  }
});

test('late session creation attempts bounded cleanup without claiming it succeeded', async () => {
  const f = fixture();
  const diagnostic = await startReloadLifetimeDiagnostic({ ...f, extensionId });
  diagnostic.correlateOld('old-worker');
  f.pageSession.emit('ServiceWorker.workerVersionUpdated', {
    versions: [
      {
        versionId: 'version-new',
        registrationId: 'registration-2',
        scriptURL: `${prefix}background.js`,
        targetId: 'new-worker',
        runningStatus: 'starting',
        status: 'new',
      },
    ],
  });
  let resolveCreation;
  f.context.newCDPSession = async () =>
    new Promise((resolve) => {
      resolveCreation = resolve;
    });
  const result = await diagnostic.observeFreshReplacement('new-worker', 45);
  assert.equal(result.outcome, 'unavailable');
  assert.equal(result.cleanup, 'unconfirmed');
  const late = new Session(() => ({}));
  resolveCreation(late);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(late.calls, ['ServiceWorker.disable']);
  assert.equal(late.detached, true);
  assert.equal(late.listenerCount('ServiceWorker.workerVersionUpdated'), 0);
  await diagnostic.close();
});
