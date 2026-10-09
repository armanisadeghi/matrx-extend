/** Durable, source-only lifecycle for one disposable Records create and its approval. */
import assert from 'node:assert/strict';
import { open, readFile, rename } from 'node:fs/promises';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_FAILURE_CODES = new Set([
  'records_approval_read_wrong_id',
  'records_approval_read_wrong_org',
  'records_approval_read_wrong_subject',
  'records_approval_read_wrong_principal',
  'records_approval_read_wrong_conversation',
  'records_approval_read_wrong_origin',
  'records_approval_read_wrong_kind',
  'records_approval_read_wrong_rows',
  'records_approval_state_unknown',
  'records_approval_not_pending',
  'records_approval_ui_not_confirmed',
  'records_c06_approvals_route_missing',
  'records_c06_web_principal_mismatch',
  'records_c06_web_email_mismatch',
  'records_c06_authenticated_read_door_unobserved',
  'records_c06_approval_read_failed',
  'records_c06_approval_read_empty',
  'records_c06_approval_row_not_unique',
  'records_c06_agent_badge_missing',
  'records_c06_owned_table_headline_missing',
]);

export function recordsC06FailureDiagnostic(error, phase) {
  const code = [...SAFE_FAILURE_CODES].find(
    (known) => error?.message === known || error?.message?.startsWith(`${known}\n`),
  );
  return {
    phase: [
      'dispatch_unknown',
      'held',
      'decision_unknown',
      'approved',
      'readback_verified',
    ].includes(phase)
      ? phase
      : 'other',
    code: code ?? 'unclassified',
  };
}

async function save(path, state) {
  const temporary = `${path}.tmp`;
  const file = await open(temporary, 'w', 0o600);
  try {
    await file.writeFile(`${JSON.stringify(state)}\n`);
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(temporary, path);
}

async function load(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function ownerMatches(state, owner) {
  assert.match(owner.tableId, UUID, 'records_approval_table_id_invalid');
  assert.match(owner.organizationId, UUID, 'records_approval_org_id_invalid');
  assert.match(owner.principalId, UUID, 'records_approval_principal_id_invalid');
  assert.ok(
    /^EXT-F-4130-[0-9a-f-]+-(?:row|approval-row)$/i.test(owner.rowName),
    'records_approval_row_name_invalid',
  );
  assert.equal(state.table_id, owner.tableId, 'records_approval_foreign_table');
  assert.equal(state.organization_id, owner.organizationId, 'records_approval_foreign_org');
  assert.equal(state.principal_id, owner.principalId, 'records_approval_foreign_principal');
  assert.equal(state.row_name, owner.rowName, 'records_approval_foreign_row');
  assert.match(state.conversation_id ?? '', UUID, 'records_approval_conversation_id_invalid');
}

function held(result, state) {
  assert.equal(result?.applied, false, 'records_approval_false_applied');
  assert.equal(result.awaiting_approval, true, 'records_approval_hold_missing');
  assert.match(result.approval_id ?? '', UUID, 'records_approval_id_missing');
  assert.equal(result.table_id, state.table_id, 'records_approval_result_wrong_table');
  return result.approval_id;
}

function approvalMatches(approval, state) {
  assert.equal(approval?.approval_id, state.approval_id, 'records_approval_read_wrong_id');
  if (approval.organization_id !== undefined)
    assert.equal(
      approval.organization_id,
      state.organization_id,
      'records_approval_read_wrong_org',
    );
  assert.equal(approval.subject_id, state.table_id, 'records_approval_read_wrong_subject');
  assert.equal(approval.requested_by, state.principal_id, 'records_approval_read_wrong_principal');
  assert.equal(
    approval.conversation_id,
    state.conversation_id,
    'records_approval_read_wrong_conversation',
  );
  assert.equal(approval.origin, 'agent', 'records_approval_read_wrong_origin');
  assert.equal(approval.change?.kind, 'record_add', 'records_approval_read_wrong_kind');
  assert.deepEqual(
    approval.change?.rows,
    [{ name: state.row_name }],
    'records_approval_read_wrong_rows',
  );
  assert.ok(
    ['pending', 'approved', 'declined', 'withdrawn'].includes(approval.state),
    'records_approval_state_unknown',
  );
  return approval;
}

function appliedRow(approval, state) {
  assert.equal(approval.state, 'approved', 'records_approval_not_approved');
  assert.deepEqual(approval.applied_record_ids?.length, 1, 'records_approval_applied_id_count');
  const rowId = approval.applied_record_ids[0];
  assert.match(rowId ?? '', UUID, 'records_approval_applied_id_invalid');
  state.row_id = rowId;
  return rowId;
}

function settleTerminal(approval, state) {
  assert.notEqual(approval.state, 'pending', 'records_approval_still_pending');
  if (approval.state === 'approved') appliedRow(approval, state);
  else
    assert.equal(
      approval.applied_record_ids?.length ?? 0,
      0,
      'records_approval_nonapproved_has_applied_rows',
    );
  state.approval_decision_unknown = false;
  state.phase = approval.state;
}

function rowMatches(row, state) {
  assert.equal(row?.id, state.row_id, 'records_approval_readback_wrong_id');
  assert.equal(row.table_id, state.table_id, 'records_approval_readback_wrong_table');
  assert.equal(row.organization_id, state.organization_id, 'records_approval_readback_wrong_org');
  assert.equal(row.values?.name, state.row_name, 'records_approval_readback_wrong_value');
}

function cleanupMatches(cleanup) {
  assert.equal(cleanup?.archived_verified, true, 'records_approval_cleanup_not_archived');
  assert.equal(cleanup.same_principal, true, 'records_approval_cleanup_wrong_principal');
  assert.equal(cleanup.table_invisible, true, 'records_approval_cleanup_table_visible');
}

/** Adapters must use the real Tools submit, /approvals UI click, and authoritative store reads. */
export async function runOwnedApprovalCreate({
  journalPath,
  owner,
  dispatchCreate,
  readApproval,
  approveInUi,
  declineInUi,
  readRecord,
  cleanupTable,
  conversationId,
  onFailure = () => {},
}) {
  assert.match(conversationId, UUID, 'records_approval_conversation_id_invalid');
  const state = {
    schema_version: 1,
    phase: 'planned',
    conversation_id: conversationId,
    table_id: owner.tableId,
    organization_id: owner.organizationId,
    principal_id: owner.principalId,
    row_name: owner.rowName,
    approval_id: null,
    row_id: null,
    pending_write_unknown: false,
    approval_decision_unknown: false,
  };
  ownerMatches(state, owner);
  const created = await open(journalPath, 'wx', 0o600);
  try {
    await created.writeFile(`${JSON.stringify(state)}\n`);
    await created.sync();
  } finally {
    await created.close();
  }
  let bodyError = null;
  let cleanupError = null;
  try {
    state.phase = 'dispatch_unknown';
    state.pending_write_unknown = true;
    await save(journalPath, state);
    const result = await dispatchCreate({
      tableId: state.table_id,
      organizationId: state.organization_id,
      rowName: state.row_name,
      conversationId,
    });
    state.approval_id = held(result, state);
    state.pending_write_unknown = false;
    state.phase = 'held';
    await save(journalPath, state);
    const before = approvalMatches(
      await readApproval(state.approval_id, state.organization_id),
      state,
    );
    assert.equal(before.state, 'pending', 'records_approval_not_pending');
    state.phase = 'decision_unknown';
    state.approval_decision_unknown = true;
    await save(journalPath, state);
    const click = await approveInUi({
      approvalId: state.approval_id,
      organizationId: state.organization_id,
      tableId: state.table_id,
    });
    assert.deepEqual(
      { surface: click?.surface, rowMatched: click?.rowMatched, confirmed: click?.confirmed },
      { surface: '/approvals', rowMatched: true, confirmed: true },
      'records_approval_ui_not_confirmed',
    );
    assert.match(click.appliedRecordId ?? '', UUID, 'records_approval_ui_row_id_missing');
    const after = approvalMatches(
      await readApproval(state.approval_id, state.organization_id),
      state,
    );
    const rowId = appliedRow(after, state);
    assert.equal(click.appliedRecordId, rowId, 'records_approval_ui_row_id_mismatch');
    state.approval_decision_unknown = false;
    state.phase = 'approved';
    await save(journalPath, state);
    rowMatches(await readRecord(rowId, state.organization_id), state);
    state.phase = 'readback_verified';
    await save(journalPath, state);
  } catch (error) {
    bodyError = error;
    onFailure(recordsC06FailureDiagnostic(error, state.phase));
    // Only a known pending hold before any approve click can be safely declined.
    if (state.approval_id && !state.approval_decision_unknown) {
      try {
        const pending = approvalMatches(
          await readApproval(state.approval_id, state.organization_id),
          state,
        );
        if (pending.state === 'pending') {
          state.phase = 'decline_unknown';
          state.approval_decision_unknown = true;
          await save(journalPath, state);
          const click = await declineInUi({
            approvalId: state.approval_id,
            organizationId: state.organization_id,
            tableId: state.table_id,
          });
          assert.deepEqual(
            click,
            { surface: '/approvals', rowMatched: true, confirmed: true },
            'records_approval_decline_ui_not_confirmed',
          );
          const declined = approvalMatches(
            await readApproval(state.approval_id, state.organization_id),
            state,
          );
          assert.equal(declined.state, 'declined', 'records_approval_decline_unverified');
          state.approval_decision_unknown = false;
          state.phase = 'declined';
          await save(journalPath, state);
        }
      } catch {
        // Keep the original failure and durable uncertainty; never retry a decision.
      }
    }
  } finally {
    try {
      const cleanup = await cleanupTable({
        tableId: state.table_id,
        organizationId: state.organization_id,
        principalId: state.principal_id,
      });
      cleanupMatches(cleanup);
      state.table_cleanup_verified = true;
      await save(journalPath, state);
      // The UI response may have been lost after the person clicked. The
      // archive can also withdraw a pending request. Read the exact known row
      // once more; never issue another decision merely because a reply vanished.
      if (state.approval_id) {
        try {
          const terminal = approvalMatches(
            await readApproval(state.approval_id, state.organization_id),
            state,
          );
          if (terminal.state !== 'pending') {
            if (terminal.state === 'approved') appliedRow(terminal, state);
            else
              assert.equal(
                terminal.applied_record_ids?.length ?? 0,
                0,
                'records_approval_nonapproved_has_applied_rows',
              );
            state.approval_decision_unknown = false;
            state.approval_terminal_state = terminal.state;
            if (!['readback_verified', 'declined'].includes(state.phase))
              state.phase = terminal.state;
          }
        } catch {
          state.approval_reconcile_failed = true;
        }
        await save(journalPath, state);
      }
      if (
        !state.approval_decision_unknown &&
        !state.pending_write_unknown &&
        (state.phase === 'readback_verified' || state.phase === 'declined') &&
        ['approved', 'declined', 'withdrawn'].includes(state.approval_terminal_state) &&
        !state.approval_reconcile_failed
      ) {
        state.phase = 'archived_verified';
        await save(journalPath, state);
      }
    } catch (error) {
      cleanupError = error;
      state.cleanup_failed = true;
      await save(journalPath, state);
    }
  }
  if (bodyError) throw bodyError;
  if (cleanupError) throw cleanupError;
  assert.equal(state.approval_reconcile_failed, undefined, 'records_approval_reconcile_failed');
  assert.equal(state.phase, 'archived_verified', 'records_approval_not_terminal');
  assert.equal(state.approval_decision_unknown, false, 'records_approval_decision_unknown');
  assert.equal(state.pending_write_unknown, false, 'records_approval_write_unknown');
  assert.match(state.row_id ?? '', UUID, 'records_approval_row_not_applied');
  return { approved_and_read_back: true, archived_verified: true, row_id: state.row_id };
}

/** Interrupted dispatch is discovery-and-cleanup only; it never sends a second create. */
export async function recoverOwnedApprovalCreate({
  journalPath,
  owner,
  discoverOwnedRequest,
  readApproval,
  declineInUi,
  cleanupTable,
}) {
  const state = await load(journalPath);
  ownerMatches(state, owner);
  if (state.phase === 'archived_verified')
    return { recovered: false, archived_verified: true, credit: false };
  let bodyError = null;
  let cleanupError = null;
  try {
    if (state.pending_write_unknown) {
      const candidates = await discoverOwnedRequest({
        conversationId: state.conversation_id,
        tableId: state.table_id,
        organizationId: state.organization_id,
        principalId: state.principal_id,
        rowName: state.row_name,
      });
      // A conversation ID is persisted by the queue, unlike a client request ID.
      // Empty, ambiguous, or incomplete discovery cannot prove a late write absent.
      if (candidates?.complete === true && candidates.approval_ids?.length === 1) {
        const candidateId = candidates.approval_ids[0];
        assert.match(candidateId, UUID, 'records_approval_recovery_id_invalid');
        const exact = approvalMatches(await readApproval(candidateId, state.organization_id), {
          ...state,
          approval_id: candidateId,
        });
        state.approval_id = candidateId;
        state.pending_write_unknown = false;
        if (exact.state === 'pending') state.phase = 'held';
        else settleTerminal(exact, state);
        await save(journalPath, state);
      }
    }
    if (state.approval_id) {
      const approval = approvalMatches(
        await readApproval(state.approval_id, state.organization_id),
        state,
      );
      if (state.approval_decision_unknown && approval.state !== 'pending') {
        settleTerminal(approval, state);
        await save(journalPath, state);
      } else if (!state.approval_decision_unknown && approval.state === 'pending') {
        state.phase = 'decline_unknown';
        state.approval_decision_unknown = true;
        await save(journalPath, state);
        const click = await declineInUi({
          approvalId: state.approval_id,
          organizationId: state.organization_id,
          tableId: state.table_id,
        });
        assert.deepEqual(
          click,
          { surface: '/approvals', rowMatched: true, confirmed: true },
          'records_approval_decline_ui_not_confirmed',
        );
        const after = approvalMatches(
          await readApproval(state.approval_id, state.organization_id),
          state,
        );
        assert.equal(after.state, 'declined', 'records_approval_decline_unverified');
        state.approval_decision_unknown = false;
        state.phase = 'declined';
        await save(journalPath, state);
      }
    }
  } catch (error) {
    bodyError = error;
  } finally {
    try {
      cleanupMatches(
        await cleanupTable({
          tableId: state.table_id,
          organizationId: state.organization_id,
          principalId: state.principal_id,
        }),
      );
      state.table_cleanup_verified = true;
      await save(journalPath, state);
    } catch (error) {
      cleanupError = error;
      state.cleanup_failed = true;
      await save(journalPath, state);
    }
  }
  if (bodyError && cleanupError) throw new Error('records_approval_body_and_cleanup_failed');
  if (bodyError) throw bodyError;
  if (cleanupError) throw cleanupError;
  if (state.approval_id && state.approval_decision_unknown) {
    const afterCleanup = approvalMatches(
      await readApproval(state.approval_id, state.organization_id),
      state,
    );
    if (afterCleanup.state !== 'pending') {
      settleTerminal(afterCleanup, state);
      await save(journalPath, state);
    }
  }
  const settled =
    !state.pending_write_unknown &&
    !state.approval_decision_unknown &&
    (!state.approval_id ||
      ['declined', 'approved', 'withdrawn', 'readback_verified'].includes(state.phase));
  if (settled) {
    state.phase = 'archived_verified';
    await save(journalPath, state);
  }
  return {
    recovered: true,
    archived_verified: settled,
    credit: false,
    pending_write_unknown: state.pending_write_unknown,
    approval_decision_unknown: state.approval_decision_unknown,
  };
}
