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
