const VISIBILITY_PHASES = new Set([
  'before_reopen',
  'after_root_foreground',
  'after_demo_foreground',
  'after_trusted_open',
  'after_target_activation',
]);

function boundedElapsed(start, now) {
  return Math.max(0, Math.min(60_000, Math.round(now() - start)));
}

export function recordMemberForegroundVisibility(diagnostic, observation) {
  if (!VISIBILITY_PHASES.has(observation?.phase) || diagnostic.visibility_observations.length >= 4)
    return;
  diagnostic.visibility_observations.push({
    phase: observation.phase,
    measured: observation.measured === true,
    visible: observation.measured === true && observation.visibility === 'visible',
    hidden: observation.measured === true && observation.visibility === 'hidden',
  });
}

export function classifyMemberForegroundFailure(error, transportFailureClass) {
  const message = String(error?.message ?? '');
  if (/native_sidepanel_open_refused/.test(message)) return 'opener_refused';
  if (/visibility_unavailable/.test(message)) return 'visibility_unavailable';
  if (/Target closed|Session closed|WebSocket closed|detached|retired|No target/i.test(message))
    return 'target_closed';
  if (/_not_observed/.test(message) || /timeout|timed out/i.test(message)) return 'timeout';
  if (
    transportFailureClass === 'protocol_error' ||
    /protocol error|Protocol error|CDP connection/i.test(message)
  )
    return 'protocol_failure';
  return 'other';
}

async function boundedObservation(read, timeoutMs = 500) {
  let timer;
  try {
    return await Promise.race([
      read(),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Read only opaque browser identities and fixed visibility/topology fields. */
export async function sampleMemberAuthTopology(native, panel, phase) {
  const panelId = native.panelTarget.targetId;
  const targets = await boundedObservation(() => native.browserSession.send('Target.getTargets'));
  const panelTargets = Array.isArray(targets?.targetInfos)
    ? targets.targetInfos.filter((target) => target.url === native.panelTarget.url)
    : null;
  const renderer = await boundedObservation(() =>
    panel.send('Runtime.evaluate', {
      expression: '({ visibility: document.visibilityState, focused: document.hasFocus() })',
      returnByValue: true,
    }),
  );
  const worker = await boundedObservation(() => native.attachWorker());
  let topology = null;
  if (worker) {
    try {
      topology = await boundedObservation(() =>
        worker.send('Runtime.evaluate', {
          expression: `(async () => {
            const [contexts, windows, tabs] = await Promise.all([
              chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] }),
              chrome.windows.getAll(), chrome.tabs.query({})
            ]);
            return {
              contexts: contexts.map(c => ({
                contextId: c.contextId, documentId: c.documentId,
                windowId: c.windowId, tabId: c.tabId,
                exactPanel: c.documentUrl === ${JSON.stringify(native.panelTarget.url)}
              })),
              windows: windows.map(w => ({ id: w.id, focused: w.focused, state: w.state })),
              tabs: tabs.map(t => ({ id: t.id, windowId: t.windowId, active: t.active }))
            };
          })()`,
          awaitPromise: true,
          returnByValue: true,
        }),
      );
    } finally {
      await worker.detach().catch(() => {});
    }
  }
  const value = topology?.exceptionDetails ? null : topology?.result?.value;
  const safeId = (id) => (typeof id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(id) ? id : null);
  const safeNumber = (id) => (Number.isSafeInteger(id) ? id : null);
  return {
    phase,
    panel_target_id: safeId(panelId),
    panel_targets_measured: panelTargets !== null,
    panel_target_ids: panelTargets?.map((target) => safeId(target.targetId)) ?? [],
    panel_visibility: ['visible', 'hidden', 'prerender'].includes(
      renderer?.result?.value?.visibility,
    )
      ? renderer.result.value.visibility
      : null,
    panel_has_focus:
      typeof renderer?.result?.value?.focused === 'boolean' ? renderer.result.value.focused : null,
    topology_measured:
      Array.isArray(value?.contexts) && Array.isArray(value?.windows) && Array.isArray(value?.tabs),
    panel_contexts: (Array.isArray(value?.contexts) ? value.contexts : [])
      .filter((context) => context.exactPanel === true)
      .map((context) => ({
        context_id: safeId(context.contextId),
        document_id: safeId(context.documentId),
        window_id: safeNumber(context.windowId),
        tab_id: safeNumber(context.tabId),
      })),
    windows: (Array.isArray(value?.windows) ? value.windows : []).map((window) => ({
      id: safeNumber(window.id),
      focused: window.focused === true,
      state: ['normal', 'minimized', 'maximized', 'fullscreen'].includes(window.state)
        ? window.state
        : null,
    })),
    tabs: (Array.isArray(value?.tabs) ? value.tabs : []).map((tab) => ({
      id: safeNumber(tab.id),
      window_id: safeNumber(tab.windowId),
      active: tab.active === true,
    })),
  };
}

/** Flush every boundary before the next auth action can retire its targets. */
export async function recordMemberAuthTopologyBoundary({
  native,
  panel,
  phase,
  report,
  output,
  writeReport,
}) {
  report.auth_topology ??= [];
  try {
    report.auth_topology.push(await sampleMemberAuthTopology(native, panel, phase));
  } catch {
    report.auth_topology.push({ phase, topology_measured: false, probe_failed: true });
  }
  await writeReport(output, report);
}

async function failureSnapshot({ web, page, native, panel, evaluate }) {
  const targets = await boundedObservation(() => native.browserSession.send('Target.getTargets'));
  const visibility = await boundedObservation(() => evaluate(panel, 'document.visibilityState'));
  return {
    web_closed: web.isClosed(),
    root_closed: page.isClosed(),
    targets_measured: Array.isArray(targets?.targetInfos),
    exact_panel_target_present:
      Array.isArray(targets?.targetInfos) &&
      targets.targetInfos.some((target) => target.targetId === native.panelTarget.targetId),
    visibility_measured: ['visible', 'hidden', 'prerender'].includes(visibility),
    panel_visible: visibility === 'visible',
    panel_hidden: visibility === 'hidden',
  };
}

export async function restoreMemberForeground({
  web,
  page,
  native,
  panel,
  waitFor,
  evaluate,
  diagnostic,
  onFailure = async () => {},
  now = () => performance.now(),
}) {
  const origin = now();
  const step = async (name, action) => {
    const row = {
      name,
      started_ms: boundedElapsed(origin, now),
      completed_ms: null,
      failed_ms: null,
    };
    diagnostic.steps.push(row);
    try {
      await action();
      row.completed_ms = boundedElapsed(origin, now);
    } catch (error) {
      row.failed_ms = boundedElapsed(origin, now);
      diagnostic.failure_substep = name;
      diagnostic.failure_class = classifyMemberForegroundFailure(
        error,
        native.transportFailureClass?.(),
      );
      diagnostic.failure_snapshot = await failureSnapshot({
        web,
        page,
        native,
        panel,
        evaluate,
      });
      // Preserve the bounded observation before the harness begins cleanup.
      await onFailure(error).catch(() => {});
      throw error;
    }
  };
  await step('demo_foreground', () => web.bringToFront());
  await step('panel_reopen', () => native.reopenPanel({ page: web }));
  await step('visibility_wait', () =>
    waitFor(
      'reviewer_native_panel_foreground',
      () => evaluate(panel, 'document.visibilityState'),
      (visibility) => visibility === 'visible',
      10_000,
    ),
  );
}
