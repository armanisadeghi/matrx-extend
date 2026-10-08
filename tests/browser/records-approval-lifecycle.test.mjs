import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  recoverOwnedApprovalCreate,
  runOwnedApprovalCreate,
} from './records-approval-lifecycle.mjs';

const owner = {
  tableId: '3b80fd38-4db8-4cc9-8629-f8b751d5b337',
  organizationId: '80b29f0e-1600-4837-b54d-07016fc45445',
  principalId: 'b326b48b-3e0d-4b1d-903e-a9f6b0635682',
  rowName: 'EXT-F-4130-70374922-d0c2-47e7-b6f8-7bca44583599-row',
};
const approvalId = 'daef0892-4337-44b7-a793-829d12d94cab';
const rowId = '483f8d2c-bdc0-4b8c-85d5-5b7837e575f7';
const conversationId = 'ac0b1e84-eddb-41f8-ab66-9d99d82d747e';

const held = () => ({
  applied: false,
  awaiting_approval: true,
  approval_id: approvalId,
  table_id: owner.tableId,
});
const approval = (state) => ({
  approval_id: approvalId,
  subject_id: owner.tableId,
  requested_by: owner.principalId,
  conversation_id: conversationId,
  origin: 'agent',
  change: { kind: 'record_add', rows: [{ name: owner.rowName }] },
  state,
  ...(state === 'approved' && { applied_record_ids: [rowId] }),
});
const row = () => ({
  id: rowId,
  table_id: owner.tableId,
  organization_id: owner.organizationId,
  values: { name: owner.rowName },
});
const cleanup = () => ({ archived_verified: true, same_principal: true, table_invisible: true });
const click = () => ({ surface: '/approvals', rowMatched: true, confirmed: true });

async function scenario(overrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'records-approval-lifecycle-'));
  const journalPath = join(directory, 'journal.json');
  const events = [];
  let readCount = 0;
  const adapters = {
    journalPath,
    owner,
    conversationId,
    dispatchCreate: async () => {
      events.push('dispatch');
      return held();
    },
    readApproval: async () => {
      events.push('approval_read');
      return approval(readCount++ === 0 ? 'pending' : 'approved');
    },
    approveInUi: async () => {
      events.push('ui_approve');
      return click();
    },
    declineInUi: async () => {
      events.push('ui_decline');
      return click();
    },
    readRecord: async () => {
      events.push('row_read');
      return row();
    },
    cleanupTable: async () => {
      events.push('cleanup');
      return cleanup();
    },
    ...overrides,
  };
  return {
    adapters,
    events,
    journal: async () => JSON.parse(await readFile(journalPath, 'utf8')),
  };
}

test('held create is journaled before dispatch, approved through UI, read back, then archived', async () => {
  let atDispatch;
  const s = await scenario({
    dispatchCreate: async ({ conversationId: sentConversationId }) => {
      atDispatch = await s.journal();
      assert.equal(sentConversationId, conversationId);
      s.events.push('dispatch');
      return held();
    },
  });
  const result = await runOwnedApprovalCreate(s.adapters);
  assert.equal(atDispatch.phase, 'dispatch_unknown');
  assert.equal(atDispatch.pending_write_unknown, true);
  assert.equal(atDispatch.conversation_id, conversationId);
  assert.equal(atDispatch.approval_id, null);
  assert.equal(result.approved_and_read_back, true);
  assert.deepEqual(s.events, [
    'dispatch',
    'approval_read',
    'ui_approve',
    'approval_read',
    'row_read',
    'cleanup',
  ]);
  assert.equal((await s.journal()).phase, 'archived_verified');
  assert.equal((await s.journal()).pending_write_unknown, false);
});

test('missing observed conversation refuses before the write can dispatch', async () => {
  const s = await scenario({ conversationId: undefined });
  await assert.rejects(
    runOwnedApprovalCreate(s.adapters),
    /records_approval_conversation_id_invalid/,
  );
  assert.equal(s.events.includes('dispatch'), false);
});

test('wrong held ownership, false applied, or no approval ID cannot earn credit', async () => {
  for (const [result, failure] of [
    [{ ...held(), table_id: rowId }, /result_wrong_table/],
    [{ ...held(), applied: true }, /false_applied/],
    [{ ...held(), approval_id: null }, /id_missing/],
  ]) {
    const s = await scenario({ dispatchCreate: async () => result });
    await assert.rejects(runOwnedApprovalCreate(s.adapters), failure);
    assert.equal(s.events.includes('cleanup'), true);
    assert.equal((await s.journal()).pending_write_unknown, true);
  }
});

test('foreign approval, pending after click, wrong UI receipt and wrong readback fail closed', async () => {
  for (const [overrides, failure] of [
    [
      { readApproval: async () => ({ ...approval('pending'), approval_id: rowId }) },
      /read_wrong_id/,
    ],
    [
      { readApproval: async () => ({ ...approval('pending'), requested_by: rowId }) },
      /read_wrong_principal/,
    ],
    [
      { readApproval: async () => ({ ...approval('pending'), organization_id: rowId }) },
      /read_wrong_org/,
    ],
    [{ readApproval: async () => approval('pending') }, /not_approved/],
    [
      { approveInUi: async () => ({ surface: 'rpc', rowMatched: true, confirmed: true }) },
      /ui_not_confirmed/,
    ],
    [{ readRecord: async () => ({ ...row(), id: owner.tableId }) }, /readback_wrong_id/],
    [{ readRecord: async () => ({ ...row(), values: { name: 'wrong' } }) }, /readback_wrong_value/],
  ]) {
    const s = await scenario(overrides);
    await assert.rejects(runOwnedApprovalCreate(s.adapters), failure);
    assert.equal(s.events.includes('cleanup'), true);
    assert.notEqual((await s.journal()).phase, 'archived_verified');
  }
});

test('cleanup is mandatory after valid approval and matching readback', async () => {
  const s = await scenario({
    cleanupTable: async () => ({ ...cleanup(), table_invisible: false }),
  });
  await assert.rejects(runOwnedApprovalCreate(s.adapters), /cleanup_table_visible/);
  assert.equal((await s.journal()).phase, 'readback_verified');
});

test('interrupted dispatch does exact discovery and never resends create', async () => {
  const s = await scenario({
    dispatchCreate: async () => {
      throw new Error('network_lost');
    },
  });
  await assert.rejects(runOwnedApprovalCreate(s.adapters), /network_lost/);
  assert.equal((await s.journal()).pending_write_unknown, true);
  let dispatched = 0;
  const result = await recoverOwnedApprovalCreate({
    journalPath: s.adapters.journalPath,
    owner,
    discoverOwnedRequest: async () => ({ complete: false, approval_ids: [] }),
    readApproval: s.adapters.readApproval,
    declineInUi: s.adapters.declineInUi,
    cleanupTable: s.adapters.cleanupTable,
    dispatchCreate: async () => {
      dispatched += 1;
    },
  });
  assert.equal(dispatched, 0);
  assert.equal(result.credit, false);
  assert.equal(result.pending_write_unknown, true);
  assert.equal(result.archived_verified, false);
});

test('incomplete or ambiguous discovery preserves unknown outcome after cleanup', async () => {
  for (const discovery of [
    { complete: false, approval_ids: [approvalId] },
    { complete: true, approval_ids: [approvalId, rowId] },
  ]) {
    const s = await scenario({
      dispatchCreate: async () => {
        throw new Error('network_lost');
      },
    });
    await assert.rejects(runOwnedApprovalCreate(s.adapters), /network_lost/);
    const recovered = await recoverOwnedApprovalCreate({
      journalPath: s.adapters.journalPath,
      owner,
      discoverOwnedRequest: async () => discovery,
      readApproval: async () => {
        throw new Error('unexpected_approval_read');
      },
      declineInUi: s.adapters.declineInUi,
      cleanupTable: s.adapters.cleanupTable,
    });
    assert.equal(recovered.pending_write_unknown, true);
    assert.equal(recovered.credit, false);
    assert.equal(s.events.includes('cleanup'), true);
  }
});

test('recovery refuses a foreign discovery and declines only exact owned pending approval', async () => {
  const s = await scenario({
    dispatchCreate: async () => {
      throw new Error('network_lost');
    },
  });
  await assert.rejects(runOwnedApprovalCreate(s.adapters), /network_lost/);
  await assert.rejects(
    recoverOwnedApprovalCreate({
      journalPath: s.adapters.journalPath,
      owner,
      discoverOwnedRequest: async () => ({ complete: true, approval_ids: [approvalId] }),
      readApproval: async () => ({ ...approval('pending'), conversation_id: rowId }),
      declineInUi: s.adapters.declineInUi,
      cleanupTable: s.adapters.cleanupTable,
    }),
    /read_wrong_conversation/,
  );
  assert.equal(s.events.includes('cleanup'), true);
  let reads = 0;
  const recovered = await recoverOwnedApprovalCreate({
    journalPath: s.adapters.journalPath,
    owner,
    discoverOwnedRequest: async () => ({ complete: true, approval_ids: [approvalId] }),
    readApproval: async () => approval(reads++ < 2 ? 'pending' : 'declined'),
    declineInUi: async () => {
      s.events.push('ui_decline');
      return click();
    },
    cleanupTable: s.adapters.cleanupTable,
  });
  assert.equal(recovered.archived_verified, true);
  assert.equal(recovered.credit, false);
  assert.equal((await s.journal()).phase, 'archived_verified');
  assert.equal(s.events.filter((e) => e === 'ui_decline').length, 1);
});

test('lost approve response settles from authoritative approved state without a second click', async () => {
  const s = await scenario({
    approveInUi: async () => {
      throw new Error('click_response_lost');
    },
  });
  await assert.rejects(runOwnedApprovalCreate(s.adapters), /click_response_lost/);
  assert.equal((await s.journal()).approval_decision_unknown, true);
  let clicks = 0;
  const recovered = await recoverOwnedApprovalCreate({
    journalPath: s.adapters.journalPath,
    owner,
    discoverOwnedRequest: async () => {
      throw new Error('discovery_not_needed');
    },
    readApproval: async () => approval('approved'),
    declineInUi: async () => {
      clicks += 1;
    },
    cleanupTable: s.adapters.cleanupTable,
  });
  assert.equal(clicks, 0);
  assert.equal(recovered.archived_verified, true);
  assert.equal(recovered.credit, false);
  assert.equal((await s.journal()).row_id, rowId);
});

test('lost decline response settles from authoritative declined state without another click', async () => {
  let reads = 0;
  const s = await scenario({
    readApproval: async () => {
      if (reads++ === 0) throw new Error('initial_read_lost');
      return approval('pending');
    },
    declineInUi: async () => {
      throw new Error('decline_response_lost');
    },
  });
  await assert.rejects(runOwnedApprovalCreate(s.adapters), /initial_read_lost/);
  assert.equal((await s.journal()).approval_decision_unknown, true);
  let clicks = 0;
  const recovered = await recoverOwnedApprovalCreate({
    journalPath: s.adapters.journalPath,
    owner,
    discoverOwnedRequest: async () => {
      throw new Error('discovery_not_needed');
    },
    readApproval: async () => approval('declined'),
    declineInUi: async () => {
      clicks += 1;
    },
    cleanupTable: s.adapters.cleanupTable,
  });
  assert.equal(clicks, 0);
  assert.equal(recovered.archived_verified, true);
  assert.equal(recovered.credit, false);
});

test('lost decision still pending remains unknown after cleanup', async () => {
  const s = await scenario({
    approveInUi: async () => {
      throw new Error('click_response_lost');
    },
  });
  await assert.rejects(runOwnedApprovalCreate(s.adapters), /click_response_lost/);
  const recovered = await recoverOwnedApprovalCreate({
    journalPath: s.adapters.journalPath,
    owner,
    discoverOwnedRequest: async () => {
      throw new Error('discovery_not_needed');
    },
    readApproval: async () => approval('pending'),
    declineInUi: async () => {
      throw new Error('duplicate_click');
    },
    cleanupTable: s.adapters.cleanupTable,
  });
  assert.equal(recovered.approval_decision_unknown, true);
  assert.equal(recovered.archived_verified, false);
  assert.equal((await s.journal()).table_cleanup_verified, true);
});

test('archive withdrawal settles a lost pending decision only after authoritative re-read', async () => {
  const s = await scenario({
    approveInUi: async () => {
      throw new Error('click_response_lost');
    },
  });
  await assert.rejects(runOwnedApprovalCreate(s.adapters), /click_response_lost/);
  let reads = 0;
  const recovered = await recoverOwnedApprovalCreate({
    journalPath: s.adapters.journalPath,
    owner,
    discoverOwnedRequest: async () => {
      throw new Error('discovery_not_needed');
    },
    readApproval: async () => approval(reads++ === 0 ? 'pending' : 'withdrawn'),
    declineInUi: async () => {
      throw new Error('duplicate_click');
    },
    cleanupTable: s.adapters.cleanupTable,
  });
  assert.equal(reads, 2);
  assert.equal(recovered.archived_verified, true);
  assert.equal(recovered.credit, false);
});

test('lost create discovered already terminal settles only exact owned approval without credit', async () => {
  for (const terminal of ['approved', 'withdrawn']) {
    const s = await scenario({
      dispatchCreate: async () => {
        throw new Error('network_lost');
      },
    });
    await assert.rejects(runOwnedApprovalCreate(s.adapters), /network_lost/);
    const recovered = await recoverOwnedApprovalCreate({
      journalPath: s.adapters.journalPath,
      owner,
      discoverOwnedRequest: async () => ({ complete: true, approval_ids: [approvalId] }),
      readApproval: async () => approval(terminal),
      declineInUi: async () => {
        throw new Error('unexpected_click');
      },
      cleanupTable: s.adapters.cleanupTable,
    });
    assert.equal(recovered.credit, false);
    assert.equal(recovered.archived_verified, true);
    assert.equal(recovered.pending_write_unknown, false);
    assert.equal((await s.journal()).row_id, terminal === 'approved' ? rowId : null);
  }
});
