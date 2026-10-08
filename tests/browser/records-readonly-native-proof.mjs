import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { signInSettings } from './settings-native-auth-driver.mjs';

export async function signInRecordsAdmin({ onStage, ...options }, signIn = signInSettings) {
  assert.equal(typeof onStage, 'function', 'records_auth_stage_callback_required');
  return signIn({ ...options, mode: 'admin', onStage });
}

export function recordsApprovalCleanupVerdict(state) {
  if (!state || state.schema_version !== 1)
    return { journal_present: true, unresolved: true, receipt_invalid: true };
  const terminal = ['approved', 'declined', 'withdrawn'].includes(state.approval_terminal_state)
    ? state.approval_terminal_state
    : null;
  return {
    journal_present: true,
    table_cleanup_verified: state.table_cleanup_verified === true,
    approval_id_known: typeof state.approval_id === 'string',
    approval_terminal_state: terminal,
    pending_write_unknown: state.pending_write_unknown === true,
    approval_decision_unknown: state.approval_decision_unknown === true,
    approval_reconcile_failed: state.approval_reconcile_failed === true,
    cleanup_failed: state.cleanup_failed === true,
    unresolved:
      state.pending_write_unknown === true ||
      state.approval_decision_unknown === true ||
      state.approval_reconcile_failed === true ||
      state.cleanup_failed === true ||
      state.table_cleanup_verified !== true ||
      !terminal,
  };
}

export async function enterRecordsInput(
  panel,
  evaluate,
  stage,
  input,
  platform = process.platform,
) {
  stage('records_input_focus');
  assert.equal(
    await evaluate(
      panel,
      `(() => { const b=[...document.querySelectorAll('button')].find(el=>el.querySelector('span.font-mono')?.textContent.trim()==='records'); const t=b?.parentElement?.querySelector('textarea'); if (!t || !t.getClientRects().length) return false; t.focus(); return document.activeElement===t; })()`,
    ),
    true,
    'records_input_not_focused',
  );
  const modifiers = platform === 'darwin' ? 4 : 2;
  await panel.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'a',
    code: 'KeyA',
    modifiers,
    windowsVirtualKeyCode: 65,
    commands: ['selectAll'],
  });
  await panel.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'a',
    code: 'KeyA',
    modifiers,
    windowsVirtualKeyCode: 65,
  });
  stage('records_input_selection');
  assert.equal(
    await evaluate(
      panel,
      `(() => { const b=[...document.querySelectorAll('button')].find(el=>el.querySelector('span.font-mono')?.textContent.trim()==='records'); const t=b?.parentElement?.querySelector('textarea'); return Boolean(t && document.activeElement===t && t.selectionStart===0 && t.selectionEnd===t.value.length); })()`,
    ),
    true,
    'records_input_selection_missing',
  );
  stage('records_input_insert');
  await panel.send('Input.insertText', { text: JSON.stringify(input) });
  stage('records_input_visible');
  assert.equal(
    await evaluate(
      panel,
      `(() => { const b=[...document.querySelectorAll('button')].find(el=>el.querySelector('span.font-mono')?.textContent.trim()==='records'); return b?.parentElement?.querySelector('textarea')?.value === ${JSON.stringify(JSON.stringify(input))}; })()`,
    ),
    true,
    'records_input_not_visible',
  );
}

export function observeRecordsExecution(panel, organizationId, expectedBearerHash) {
  const requests = new Map();
  const removers = [];
  let observedConversationId = null;
  const listen = (event, callback) => removers.push(panel.on(event, callback));
  const header = (headers, name) =>
    Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === name)?.[1] ?? null;
  const stop = () => {
    let failed = false;
    for (const remove of removers.splice(0)) {
      try {
        remove();
      } catch {
        failed = true;
      }
    }
    if (failed) throw new Error('records_observer_cleanup_failed');
  };
  try {
    listen('Network.requestWillBeSent', ({ requestId, request }) => {
      let url;
      try {
        url = new URL(request.url);
      } catch {
        return;
      }
      if (
        url.origin !== 'https://server.app.matrxserver.com' ||
        url.pathname !== '/tools/test/execute'
      )
        return;
      let body = null;
      try {
        body = JSON.parse(request.postData ?? '');
      } catch {
        /* Validate below. */
      }
      const bearer = /^Bearer (\S+)$/i.exec(header(request.headers, 'authorization') ?? '');
      requests.set(requestId, {
        requestId,
        method: request.method,
        organizationMatches: header(request.headers, 'x-organization-id') === organizationId,
        bearerMatches: Boolean(
          bearer && createHash('sha256').update(bearer[1]).digest('hex') === expectedBearerHash,
        ),
        body,
        status: null,
        finished: false,
        failed: false,
      });
    });
    listen('Network.responseReceived', ({ requestId, response }) => {
      const entry = requests.get(requestId);
      if (entry) entry.status = response.status;
    });
    listen('Network.loadingFinished', ({ requestId }) => {
      const entry = requests.get(requestId);
      if (entry) entry.finished = true;
    });
    listen('Network.loadingFailed', ({ requestId }) => {
      const entry = requests.get(requestId);
      if (entry) entry.failed = true;
    });
  } catch (error) {
    try {
      stop();
    } catch {
      /* Preserve registration error. */
    }
    throw error;
  }
  return {
    start: () => panel.send('Network.enable'),
    entries: () => [...requests.values()],
    conversationId: () => observedConversationId,
    stop,
    completion: async (entry) => {
      assert.equal(entry?.finished, true, 'records_execute_not_finished');
      assert.equal(entry?.failed, false, 'records_execute_network_failed');
      const response = await panel.send('Network.getResponseBody', { requestId: entry.requestId });
      const text = response.base64Encoded
        ? Buffer.from(response.body, 'base64').toString('utf8')
        : response.body;
      let completions = [];
      try {
        completions = text
          .split(/\r?\n/)
          .filter(Boolean)
          .map((line) => JSON.parse(line))
          .filter(
            (event) => event.event === 'completion' && event.data?.operation === 'tool_execution',
          );
      } catch {
        throw new Error('records_execute_completion_invalid');
      }
      assert.equal(completions.length, 1, 'records_execute_completion_count');
      observedConversationId =
        typeof completions[0].data?.result?.conversation_id === 'string'
          ? completions[0].data.result.conversation_id
          : null;
      const full = completions[0].data?.result?.full_result;
      assert.ok(
        full && typeof full === 'object' && !Array.isArray(full),
        'records_execute_full_result_missing',
      );
      return full;
    },
  };
}

export function assertRecordsVisibleCompletion(visible, completion) {
  assert.equal(visible?.visible, true, 'records_output_not_visible');
  let rendered;
  try {
    rendered = JSON.parse(visible.raw);
  } catch {
    throw new Error('records_output_not_json');
  }
  assert.deepEqual(rendered, completion, 'records_output_completion_mismatch');
  return rendered;
}

// Only fixed fields and counts enter the persisted native receipt. Never copy a
// response value, an error message, or arbitrary server-supplied field names.
export function recordsCompletionShape(value) {
  const output = value?.output;
  return {
    object: Boolean(value && typeof value === 'object' && !Array.isArray(value)),
    success: typeof value?.success === 'boolean' ? value.success : null,
    action: ['table_list', 'metadata_search'].includes(output?.action) ? output.action : null,
    tables_count: Array.isArray(output?.tables) ? output.tables.length : null,
    matches_count: Array.isArray(output?.matches) ? output.matches.length : null,
    covered_organizations_count: Array.isArray(output?.organizations_covered)
      ? output.organizations_covered.length
      : null,
    error_type: ['invalid_arguments', 'execution'].includes(value?.error?.error_type)
      ? value.error.error_type
      : null,
  };
}

export function recordsVisibleShape(value, completion) {
  let parsed;
  try {
    parsed = JSON.parse(value?.raw ?? '');
  } catch {
    return { visible: value?.visible === true, json: false, equals_completion: false };
  }
  return {
    visible: value?.visible === true,
    json: true,
    equals_completion: JSON.stringify(parsed) === JSON.stringify(completion),
    shape: recordsCompletionShape(parsed),
  };
}

const CARD_PHASES = new Set(['card_ready', 'schema_ready', 'contract_observation']);
const CARD_FAILURES = new Set([
  'card_not_ready',
  'schema_not_ready',
  'contract_observation_failed',
  'contract_unavailable',
  'contract_drift',
]);

export function retainRecordsFailure(report) {
  const fixture = report.fixture_diagnostics?.[0];
  if (fixture) {
    report.failure_phase = fixture.phase;
    report.failure_classification = fixture.classification;
    return;
  }
  const card = report.stage === 'records_card' ? report.card_diagnostic : null;
  if (CARD_PHASES.has(card?.phase) && CARD_FAILURES.has(card?.failure)) {
    report.failure_phase = card.phase;
    report.failure_classification = card.failure;
    return;
  }
  const completion = report.completion_diagnostics?.at(-1);
  if (completion?.failure) {
    report.failure_phase = completion.phase;
    report.failure_classification = completion.failure;
  }
}
