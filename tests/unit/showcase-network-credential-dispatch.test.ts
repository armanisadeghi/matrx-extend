import { waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const deps = vi.hoisted(() => ({
  handlers: new Map<string, (payload: unknown) => unknown>(),
  info: vi.fn(),
  broadcast: vi.fn(),
  record: vi.fn(),
  receipt: vi.fn(),
  run: vi.fn(),
  persistConfirm: vi.fn(),
}));
vi.mock('@/lib/debug/log', () => ({
  log: { info: deps.info, error: vi.fn(), warn: vi.fn(), success: vi.fn() },
}));
vi.mock('@/lib/messaging/native', () => ({
  on: (kind: string, handler: (payload: unknown) => unknown) => {
    deps.handlers.set(kind, handler);
    return () => deps.handlers.delete(kind);
  },
  broadcast: deps.broadcast,
}));
vi.mock('@/lib/tools/registry', async () => {
  const { z } = await import('zod');
  return {
    lookup: () => ({
      name: 'data_patterns',
      tier: 'action',
      argsSchema: z.object({
        action: z.literal('save'),
        kind: z.literal('network_capture'),
        name: z.string(),
        domain: z.string().optional(),
        config: z.record(z.string(), z.unknown()),
      }),
      run: deps.run,
    }),
    allToolNames: () => ['data_patterns'],
  };
});
vi.mock('@/lib/tools/descriptions', () => ({
  primeToolDescriptions: vi.fn(),
  getToolDescription: vi.fn(async () => ''),
}));
vi.mock('@/lib/tools/dispatch-persist', () => ({
  persistRunMeta: vi.fn(),
  loadRunMeta: vi.fn(async () => null),
  listPendingConfirms: vi.fn(async () => []),
  takeUndeliveredResults: vi.fn(async () => []),
  persistPendingConfirm: deps.persistConfirm,
  removePendingConfirm: vi.fn(),
  takePendingConfirm: vi.fn(),
  enqueueUndeliveredResult: vi.fn(),
}));
vi.mock('@/lib/audit/log', () => ({ appendReceipt: deps.receipt, recordAuditFailure: vi.fn() }));
vi.mock('@/lib/audit/receipt', () => ({
  PENDING_OUTPUT: {},
  buildReceipt: vi.fn(async (input: unknown) => input),
}));
vi.mock('@/lib/recording/state', () => ({ recordToolEvent: deps.record }));
vi.mock('@/lib/api/routes/tool-results', () => ({
  postToolResults: vi.fn(async () => ({ ok: true, status: 200, data: {} })),
}));
vi.mock('@/state/pilot', () => ({
  getPilotSessionSnapshotAsync: vi.fn(async () => ({
    active: false,
    groupId: null,
    conversationId: null,
  })),
}));

describe('D48 real dispatcher observation boundary', () => {
  it('normalizes an agent Network save before timeline, record, receipt, and execution', async () => {
    const { startToolDispatcher } = await import('@/lib/tools/dispatch');
    const { CHANNELS } = await import('@/lib/messaging/schemas');
    deps.run.mockResolvedValue({ ok: true, id: 'saved' });
    startToolDispatcher({ defaultPermissionMode: () => 'act' });
    const coldResume = deps.handlers.get(CHANNELS.COLD_RESUME_CALL);
    if (!coldResume) throw new Error('Cold resume dispatcher was not registered');
    coldResume({
      conversationId: 'conversation-d48',
      userRequestId: 'request-d48',
      callId: 'call-d48',
      toolName: 'data_patterns',
      permissionMode: 'act',
      assignedTabId: 37,
      args: {
        action: 'save',
        kind: 'network_capture',
        name: 'Network: https://user:SYNTHETIC_PASSWORD@calendar.invalid/api?access_token=SYNTHETIC_TOKEN',
        config: {
          url_filter: 'https://calendar.invalid/api?access_token=SYNTHETIC_TOKEN&date=2026-09-27',
          body_match: 'ignore',
        },
      },
    });
    await waitFor(() => expect(deps.run).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(deps.receipt).toHaveBeenCalled());
    for (const observed of [
      deps.info.mock.calls,
      deps.broadcast.mock.calls,
      deps.record.mock.calls,
      deps.receipt.mock.calls,
      deps.run.mock.calls,
    ]) {
      expect(JSON.stringify(observed)).not.toMatch(/SYNTHETIC_(TOKEN|PASSWORD)/);
    }
    expect(JSON.stringify(deps.run.mock.calls)).toContain('date=2026-09-27');
  });

  it('normalizes the external WebMCP save before confirmation persistence and receipts', async () => {
    const { handleWebmcpCall } = await import('@/lib/tools/dispatch');
    const { CHANNELS } = await import('@/lib/messaging/schemas');
    vi.clearAllMocks();
    deps.run.mockResolvedValue({ ok: true, id: 'saved' });
    deps.broadcast.mockImplementation((kind: string, payload: { callId?: string }) => {
      if (kind === CHANNELS.TOOL_CONFIRM_REQUEST) {
        deps.handlers.get(CHANNELS.TOOL_CONFIRM_RESPONSE)?.({
          callId: payload.callId,
          decision: 'allow',
        });
      }
    });
    const result = await handleWebmcpCall(
      {
        callId: 'webmcp-d48',
        toolName: 'data_patterns',
        args: {
          action: 'save',
          kind: 'network_capture',
          domain: 'calendar.invalid',
          name: 'Network: https://user:SYNTHETIC_PASSWORD@calendar.invalid/api?access_token=SYNTHETIC_TOKEN',
          config: {
            url_filter: 'https://calendar.invalid/api?access_token=SYNTHETIC_TOKEN&date=2026-09-27',
            body_match: 'ignore',
          },
        },
      },
      { permissionMode: 'act', initiator: 'page' },
    );
    expect(result.ok).toBe(true);
    expect(deps.persistConfirm).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(deps.receipt).toHaveBeenCalled());
    for (const observed of [
      deps.broadcast.mock.calls,
      deps.persistConfirm.mock.calls,
      deps.receipt.mock.calls,
      deps.run.mock.calls,
    ]) {
      expect(JSON.stringify(observed)).not.toMatch(/SYNTHETIC_(TOKEN|PASSWORD)/);
    }
    expect(JSON.stringify(deps.run.mock.calls)).toContain('calendar.invalid');
    expect(JSON.stringify(deps.run.mock.calls)).toContain('date=2026-09-27');
  });
});
