import {
  type DispatchBoundary,
  type OperationIdentity,
  type RecoveredApproval,
  executePreparedOperation,
} from '@/lib/tools/prepared-tool-operation';
import { expect, it, vi } from 'vitest';
const identity: OperationIdentity = {
  toolName: 'data_patterns',
  callId: 'actual-call',
  runId: 'actual-run',
  assignedTabId: 37,
  snapshotKey: 'recipe-digest:document-uuid:options-digest',
};
function fixture() {
  const controller = new AbortController();
  const attachAndCapture = vi.fn(async (_signal: AbortSignal) => [{ venue: 'Brooklyn Bowl' }]);
  const checks = vi.fn(async () => {});
  const confirm = vi.fn(
    async (_identity: OperationIdentity, _tier: string, _signal: AbortSignal) => true,
  );
  const prepare = vi.fn(async () => ({
    identity: { ...identity },
    tier: 'privileged' as const,
    checkRequirements: checks,
    run: attachAndCapture,
  }));
  const boundary: DispatchBoundary<Awaited<ReturnType<typeof attachAndCapture>>> = {
    permissionMode: 'act',
    signal: controller.signal,
    prepare,
    confirm,
  };
  return { boundary, controller, attachAndCapture, checks, confirm, prepare };
}
const approval = (overrides: Partial<RecoveredApproval> = {}): RecoveredApproval => ({
  identity: { ...identity },
  tier: 'privileged',
  delivery: 'agent',
  expiresAt: Date.now() + 1000,
  ...overrides,
});
it('Act still asks for the actual data_patterns operation before attaching', async () => {
  const f = fixture();
  f.confirm.mockImplementation(async (operation, tier) => {
    expect(operation.toolName).toBe('data_patterns');
    expect(tier).toBe('privileged');
    expect(f.attachAndCapture).not.toHaveBeenCalled();
    return true;
  });
  await expect(executePreparedOperation(f.boundary)).resolves.toEqual([{ venue: 'Brooklyn Bowl' }]);
  expect(f.confirm).toHaveBeenCalledTimes(1);
  expect(f.checks).toHaveBeenCalledTimes(2);
});
it('denial never starts capture', async () => {
  const f = fixture();
  f.confirm.mockResolvedValue(false);
  await expect(executePreparedOperation(f.boundary)).rejects.toThrow('denied');
  expect(f.attachAndCapture).not.toHaveBeenCalled();
});
it.each(['admin_only', 'pilot_group_violation', 'permission_not_yet_granted'])(
  'recovery rechecks %s before executing',
  async (reason) => {
    const f = fixture();
    f.boundary.recovered = approval();
    f.checks.mockRejectedValue(new Error(reason));
    await expect(executePreparedOperation(f.boundary)).rejects.toThrow(reason);
    expect(f.attachAndCapture).not.toHaveBeenCalled();
    expect(f.confirm).not.toHaveBeenCalled();
  },
);
it('approved recovery resumes the real operation with its original tab and no second prompt', async () => {
  const f = fixture();
  f.boundary.recovered = approval();
  await executePreparedOperation(f.boundary);
  expect(f.confirm).not.toHaveBeenCalled();
  expect(f.attachAndCapture).toHaveBeenCalledOnce();
});
it.each([
  approval({ identity: { ...identity, toolName: 'cdp_attach' } }),
  approval({ identity: { ...identity, assignedTabId: 38 } }),
  approval({ identity: { ...identity, callId: 'other-call' } }),
  approval({ identity: { ...identity, snapshotKey: 'other-document' } }),
  approval({ tier: 'action' }),
  approval({ delivery: 'local' }),
  approval({ expiresAt: 0 }),
])('never recovers a differently bound or disconnected operation', async (recovered) => {
  const f = fixture();
  f.boundary.recovered = recovered;
  await expect(executePreparedOperation(f.boundary)).rejects.toThrow();
  expect(f.attachAndCapture).not.toHaveBeenCalled();
});
it('same-URL document replacement during approval cannot inherit approval', async () => {
  const f = fixture();
  const initial = await f.prepare();
  f.prepare.mockResolvedValueOnce(initial).mockResolvedValueOnce({
    ...initial,
    identity: { ...identity, snapshotKey: 'same-url-new-document' },
  });
  await expect(executePreparedOperation(f.boundary)).rejects.toThrow('changed');
  expect(f.attachAndCapture).not.toHaveBeenCalled();
});
it('port cancellation during approval prevents late approval from attaching', async () => {
  const f = fixture();
  f.confirm.mockImplementation(async () => {
    f.controller.abort();
    return true;
  });
  await expect(executePreparedOperation(f.boundary)).rejects.toThrow('cancelled');
  expect(f.attachAndCapture).not.toHaveBeenCalled();
});
// These are executable policy/execution-boundary tests, not full dispatcher proof.
// Before integration passes, drive TOOL_CONFIRM_RESPONSE through actual persisted
// recovery and private port using the same oracles, with CDP as the sole stub.
