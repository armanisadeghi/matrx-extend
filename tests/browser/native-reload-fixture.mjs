import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { reloadOwnedExtension } from './native-sidepanel-qa-harness.mjs';

const extensionId = 'cihdmkcdjjckfhjpgoedmgfpoljebaml';

export async function reloadCase({
  initiallyEnabled,
  disabledAfter = false,
  contextResults,
  retireBeforeClick = false,
  clickFailure = false,
  skipDestroyed = false,
  retainedHost = false,
  multipleWorkers = false,
  executionEvidence = 'valid',
  freshSnapshot = null,
  openReply = { ok: true, result: { opened: true } },
  openPanelClickFailure = false,
  panelAppears = true,
  expectedCategory = 'opened',
  replyDelayTargetReads = 0,
  expectFailure = false,
  failOperation = null,
  cleanupThrows = false,
  workerRuntime = null,
}) {
  let developerMode = initiallyEnabled;
  let reloaded = false;
  let opened = false;
  let openResult = '{"ok":true,"result":{"opened":true}}'; // stale initial-open reply
  let resolveReplyWait;
  let postOpenTargetReads = 0;
  const publishOpenReply = () => {
    if (openReply === null) return;
    openResult = openReply === 'malformed' ? '{malformed' : JSON.stringify(openReply);
    resolveReplyWait?.();
  };
  let toggles = 0;
  let contextReads = 0;
  let targetReads = 0;
  const events = new Map();
  const independent = new EventEmitter();
  independent.send = async (method, args) => {
    if (method === 'Browser.getVersion')
      return { protocolVersion: '1.3', product: 'Chrome/141.0.7390.37', revision: '@12345' };
    if (method === 'Target.getTargets') return { targetInfos: [oldWorker, oldPanel] };
    if (method === 'Target.getTargetInfo') {
      if (args.targetId === 'old-worker') {
        if (skipDestroyed && !retainedHost) throw new Error('No target with given id found');
        return { targetInfo: oldWorker };
      }
      if (args.targetId === 'new-worker') return { targetInfo: worker };
    }
    return {};
  };
  independent.detach = async () => {};
  if (cleanupThrows)
    independent.off = () => {
      throw new RangeError('private cleanup');
    };
  const pageSession = new EventEmitter();
  pageSession.send = async (method) => {
    if (method === 'ServiceWorker.enable' && executionEvidence === 'unavailable')
      throw new Error('ServiceWorker domain unavailable');
    if (method === 'ServiceWorker.enable')
      pageSession.emit('ServiceWorker.workerVersionUpdated', {
        versions: [
          {
            versionId: 'version-old',
            registrationId: 'registration-1',
            scriptURL: `chrome-extension://${extensionId}/background.js`,
            targetId: 'old-worker',
            runningStatus: 'running',
            status: 'activated',
          },
          ...(executionEvidence === 'ambiguous'
            ? [
                {
                  versionId: 'version-other',
                  registrationId: 'registration-1',
                  scriptURL: `chrome-extension://${extensionId}/background.js`,
                  targetId: 'old-worker',
                  runningStatus: 'running',
                  status: 'activated',
                },
              ]
            : []),
        ],
      });
    return {};
  };
  pageSession.detach = async () => {};
  const panelUrl = `chrome-extension://${extensionId}/sidepanel.html`;
  const oldWorker = {
    type: 'service_worker',
    targetId: 'old-worker',
    url: `chrome-extension://${extensionId}/background.js`,
    attached: true,
  };
  const worker = { ...oldWorker, targetId: 'new-worker', attached: false };
  const oldPanel = { type: 'page', targetId: 'old-panel', url: panelUrl, attached: false };
  const panel = { ...oldPanel, targetId: 'new-panel' };
  const details = {
    goto: async () => {},
    close: async () => {},
    evaluate: async () => {
      if (reloaded && failOperation === 'management_recheck')
        throw new TypeError('private management');
      return {
        state: reloaded && disabledAfter ? 'DISABLED' : 'ENABLED',
        unsupported_developer_extension: reloaded && disabledAfter,
      };
    },
    locator(selector) {
      if (selector === 'extensions-toolbar #devMode')
        return {
          evaluate: async () => developerMode,
          click: async () => {
            developerMode = !developerMode;
            toggles += 1;
          },
        };
      assert.equal(selector, 'extensions-detail-view #dev-reload-button');
      return {
        count: async () => 1,
        isVisible: async () => true,
        click: async () => {
          assert.equal(
            developerMode,
            true,
            'native reload must enable Developer mode before reload',
          );
          reloaded = true;
          events.get('Target.targetInfoChanged')({ targetInfo: oldWorker });
          if (!skipDestroyed)
            events.get('Target.targetDestroyed')({ targetId: oldWorker.targetId });
          if (!retainedHost)
            independent.emit('Target.targetDestroyed', { targetId: oldWorker.targetId });
          pageSession.emit('ServiceWorker.workerVersionUpdated', {
            versions: [
              {
                versionId: 'version-old',
                registrationId: 'registration-1',
                scriptURL: `chrome-extension://${extensionId}/background.js`,
                runningStatus: 'stopped',
                status: 'activated',
              },
            ],
          });
          if (
            executionEvidence === 'valid' ||
            executionEvidence === 'noReplacementVersion' ||
            executionEvidence === 'replacementStarting'
          ) {
            pageSession.emit('ServiceWorker.workerVersionUpdated', {
              versions: [
                {
                  versionId: 'version-old',
                  registrationId: 'registration-1',
                  scriptURL: oldWorker.url,
                  runningStatus: 'stopped',
                  status: 'redundant',
                },
                ...(executionEvidence === 'valid' || executionEvidence === 'replacementStarting'
                  ? [
                      {
                        versionId: 'version-new',
                        registrationId: 'registration-2',
                        scriptURL: worker.url,
                        targetId: worker.targetId,
                        runningStatus:
                          executionEvidence === 'replacementStarting' ? 'starting' : 'running',
                        status: executionEvidence === 'replacementStarting' ? 'new' : 'activated',
                      },
                    ]
                  : []),
              ],
            });
          }
          events.get('Target.targetCreated')({ targetInfo: worker });
          if (clickFailure) throw new Error('native_reload_click_interrupted');
        },
      };
    },
  };
  const cdp = {
    on: (event, listener) => events.set(event, listener),
    off: (event) => events.delete(event),
    async send(method, args, sessionId) {
      if (
        workerRuntime &&
        sessionId === 'diagnostic-worker-session' &&
        method === 'Runtime.evaluate'
      )
        return { result: { value: await workerRuntime.evaluate(args.expression) } };
      if (method === 'Target.getTargets') {
        if (opened && failOperation === 'panel_poll') throw new TypeError('private poll');
        if (reloaded && opened && ++postOpenTargetReads === replyDelayTargetReads)
          publishOpenReply();
        return {
          targetInfos: reloaded
            ? [
                worker,
                ...(multipleWorkers ? [{ ...worker, targetId: 'third-worker' }] : []),
                ...(opened ? [panel] : []),
              ]
            : retireBeforeClick && ++targetReads >= 2
              ? [oldPanel]
              : [oldWorker, oldPanel],
        };
      }
      if (method === 'Target.attachToTarget') {
        if (args.targetId === 'new-panel' && failOperation === 'panel_attach')
          throw new ReferenceError('private attach');
        return {
          sessionId:
            workerRuntime && args.targetId === 'new-worker'
              ? 'diagnostic-worker-session'
              : 'owned-session',
        };
      }
      if (method === 'Runtime.evaluate')
        return (
          contextResults?.[Math.min(contextReads++, contextResults.length - 1)] ?? {
            result: { value: [{ contextType: 'SIDE_PANEL', documentUrl: panelUrl, tabId: -1 }] },
          }
        );
      assert.ok(
        ['Target.setDiscoverTargets', 'Target.detachFromTarget', 'Page.bringToFront'].includes(
          method,
        ),
      );
      return {};
    },
  };
  const freshSession = new EventEmitter();
  freshSession.send = async (method) => {
    if (method === 'ServiceWorker.enable' && freshSnapshot)
      freshSession.emit('ServiceWorker.workerVersionUpdated', {
        versions: [
          {
            versionId: 'version-new',
            registrationId: 'registration-2',
            scriptURL: worker.url,
            targetId: worker.targetId,
            ...freshSnapshot,
          },
        ],
      });
    return {};
  };
  freshSession.detach = async () => {};
  let pageSessionCount = 0;
  const resultPromise = reloadOwnedExtension({
    cdp,
    browser: { newBrowserCDPSession: async () => independent },
    context: {
      newPage: async () => details,
      newCDPSession: async () => (pageSessionCount++ === 0 ? pageSession : freshSession),
    },
    page: {
      bringToFront: async () => {
        if (failOperation === 'fixture_focus') throw new TypeError('private focus');
      },
      locator: (selector) => {
        assert.ok(['#open-panel', '#result'].includes(selector));
        const locator = {
          evaluate: async (mutate) => {
            assert.equal(selector, '#result');
            if (failOperation === 'fixture_reply_clear') throw new ReferenceError('private clear');
            const element = { textContent: openResult };
            mutate(element);
            openResult = element.textContent;
          },
          click: async () => {
            assert.equal(selector, '#open-panel');
            assert.equal(openResult, '', 'reload must clear the initial-open callback');
            if (failOperation === 'fixture_open_click') throw new TypeError('private click');
            if (openPanelClickFailure)
              throw new Error('private URL token: panel click interrupted');
            await workerRuntime?.click();
            opened = panelAppears;
            if (replyDelayTargetReads === 0) publishOpenReply();
          },
          filter: ({ hasText }) => {
            assert.equal(hasText.test(''), false);
            return locator;
          },
          waitFor: async () => {
            assert.equal(selector, '#result');
            if (!openResult.trim()) {
              await new Promise((resolve) => {
                resolveReplyWait = resolve;
              });
            }
          },
          textContent: async () => openResult,
        };
        return locator;
      },
    },
    extensionId,
    oldPanelId: oldPanel.targetId,
    scrapeOpenDiagnostic: workerRuntime !== null,
  });
  if (expectFailure) return resultPromise;
  const result = await resultPromise;
  assert.equal(result.management_reload_clicked, true);
  assert.equal(result.retirement_evidence.reload_lifetime.old_version_mapping, 'correlated');
  assert.equal(result.old_targets_retired, true);
  assert.equal(result.worker_replaced, true);
  assert.equal(result.panel_replaced, true);
  assert.equal(result.retirement_evidence.open_panel_request.category, expectedCategory);
  assert.deepEqual(result.retirement_evidence.open_panel_request.worker_at_click, {
    status: 'activated',
    running_status: 'running',
  });
  assert.equal(
    Number.isSafeInteger(result.retirement_evidence.open_panel_request.click_monotonic_ms),
    true,
  );
  const timeline = result.retirement_evidence.timeline;
  assert.equal(timeline.old_worker_id, oldWorker.targetId);
  assert.equal(timeline.replacement_worker_id, worker.targetId);
  assert.equal(timeline.pre_click_old_worker_present, true);
  assert.equal(timeline.final_predicate, true);
  assert.deepEqual(timeline.final_snapshot, [
    { target_id: worker.targetId, type: 'service_worker', kind: 'worker', attached: false },
    { target_id: panel.targetId, type: 'page', kind: 'panel', attached: false },
  ]);
  const phases = timeline.entries.map((entry) => entry.phase);
  assert.ok(phases.indexOf('discovery_enabled') < phases.indexOf('listeners_registered'));
  assert.ok(phases.indexOf('listeners_registered') < phases.indexOf('pre_click_snapshot'));
  assert.ok(phases.indexOf('pre_click_snapshot') < phases.indexOf('click_started'));
  assert.ok(phases.indexOf('click_started') < phases.indexOf('target_info_changed'));
  if (!skipDestroyed)
    assert.ok(phases.indexOf('target_destroyed') < phases.indexOf('target_created'));
  assert.ok(phases.indexOf('target_created') < phases.indexOf('click_resolved'));
  assert.ok(timeline.entries.every((entry) => /^\d{4}-/.test(entry.at)));
  assert.ok(
    timeline.entries.every((entry) => !JSON.stringify(entry).includes('chrome-extension://')),
  );
  if (contextResults) assert.equal(result.context_boundary.attempts, contextResults.length);
  assert.equal(
    toggles,
    initiallyEnabled ? 0 : 1,
    'native reload preserves existing Developer mode',
  );
  return result;
}
