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
