/**
 * THE PACKAGE CHAT'S BROWSER TOOLS USE THE EXTENSION'S REAL GATE.
 *
 * The break (2026-10-08): `DEVICE_TOOL_INVOKE` (the package chat's `deviceTools` port) ran every
 * call through the WebMCP page path, which refuses every ask-user and privileged tool — 31 of
 * 150 browser tools could never run from the package chat, and nothing was pinned to the tab the
 * person sent from. `runDeviceToolCall` sends each call through `handleCall`, THE gate the
 * extension's own chat uses: Zod validation → tier × Ask/Act → approval / ask-user card →
 * handler, pinned to `assignedTabId`, with the outcome returned (the package submits it).
 *
 * SUT: the real dispatcher. Doubled: the registered handler, the message transport, receipts,
 * and the storage.session persistence of pending confirms.
 */
import { handleWebmcpCall, runDeviceToolCall } from '@/lib/tools/dispatch';
import { getAssignedTabId } from '@/lib/tools/handlers/_active-tab';
import type { AnyToolHandler } from '@/lib/tools/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const deps = vi.hoisted(() => ({
  lookup: vi.fn(),
  run: vi.fn(),
  broadcast: vi.fn(),
  listeners: new Map<string, Array<(payload: unknown) => unknown>>(),
}));
vi.mock('@/lib/tools/registry', () => ({ lookup: deps.lookup, allToolNames: () => [] }));
vi.mock('@/lib/messaging/native', () => ({
  broadcast: deps.broadcast,
  on: (channel: string, fn: (payload: unknown) => unknown) => {
    const list = deps.listeners.get(channel) ?? [];
    list.push(fn);
    deps.listeners.set(channel, list);
    return () =>
      deps.listeners.set(
        channel,
        (deps.listeners.get(channel) ?? []).filter((f) => f !== fn),
      );
  },
}));
vi.mock('@/lib/audit/log', () => ({ appendReceipt: vi.fn(), recordAuditFailure: vi.fn() }));
vi.mock('@/lib/audit/receipt', () => ({ PENDING_OUTPUT: {}, buildReceipt: vi.fn() }));
vi.mock('@/state/pilot', () => ({
  getPilotSessionSnapshotAsync: async () => ({ active: false, groupId: null }),
}));
vi.mock('@/lib/tools/dispatch-persist', async (orig) => {
  const real = await orig<Record<string, unknown>>();
  const stubbed: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(real))
    stubbed[k] = typeof v === 'function' ? vi.fn(async () => undefined) : v;
  return stubbed;
});

const CONV = 'b0c2a8e4-7a51-4d7e-9c41-3f0b1f2a6c10';
const argsSchema = z.object({ action: z.enum(['read', 'action', 'privileged', 'ask-user']) });

function call(
  action: string,
  opts: { mode?: 'ask' | 'act'; tab?: number | null; id?: string } = {},
) {
  return runDeviceToolCall({
    callId: opts.id ?? `call-${action}`,
    toolName: 'test_dynamic_tier',
    args: { action },
    conversationId: CONV,
    permissionMode: opts.mode ?? 'act',
    assignedTabId: opts.tab ?? null,
  });
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function respond(callId: string, decision: 'allow' | 'deny') {
  for (const fn of [...(deps.listeners.get('tool:confirm-response') ?? [])])
    fn({ callId, decision });
}

function confirmRequests() {
  return deps.broadcast.mock.calls.filter(
    ([, payload]) => (payload as { tier?: string })?.tier !== undefined,
  );
}

describe('package device tools run through the real gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deps.listeners.clear();
    deps.run.mockResolvedValue({ status: 'executed' });
    const handler: AnyToolHandler = {
      name: 'test_dynamic_tier',
      tier: 'read',
      argsSchema,
      tierFor: (args) => argsSchema.parse(args).action,
      run: deps.run,
    };
    deps.lookup.mockReturnValue(handler);
  });

  it('a read tool runs and its result comes back to the caller', async () => {
    expect(await call('read')).toEqual({ ok: true, result: { status: 'executed' } });
    expect(deps.run).toHaveBeenCalledTimes(1);
  });

  it('an ask-user tool is no longer refused: it reaches its handler (which asks the person)', async () => {
    expect(await call('ask-user')).toEqual({ ok: true, result: { status: 'executed' } });
  });

  it('a privileged tool reaches the approval card for THIS conversation, even in Act mode, and runs on Allow', async () => {
    const pending = call('privileged', { mode: 'act', id: 'priv-1' });
    await flush();
    await flush();
    expect(deps.run).not.toHaveBeenCalled();
    const [card] = confirmRequests();
    expect(card?.[1]).toMatchObject({ callId: 'priv-1', conversationId: CONV, tier: 'privileged' });
    respond('priv-1', 'allow');
    expect(await pending).toEqual({ ok: true, result: { status: 'executed' } });
  });

  it('a denied approval comes back as an error the model can read', async () => {
    const pending = call('privileged', { id: 'priv-2' });
    await flush();
    await flush();
    respond('priv-2', 'deny');
    expect(await pending).toEqual({ ok: false, error: 'User denied this action' });
    expect(deps.run).not.toHaveBeenCalled();
  });

  it.each([
    ['ask', true],
    ['act', false],
  ] as const)('an action tool in %s mode asks first: %s', async (mode, asks) => {
    const pending = call('action', { mode, id: `act-${mode}` });
    await flush();
    await flush();
    expect(confirmRequests().length > 0).toBe(asks);
    if (asks) respond(`act-${mode}`, 'allow');
    expect(await pending).toEqual({ ok: true, result: { status: 'executed' } });
  });

  it('a call carrying the send-time tab targets that tab even when another tab is active', async () => {
    vi.stubGlobal('chrome', {
      tabs: {
        get: vi.fn(async (id: number) => ({ id })),
        query: vi.fn(async () => [{ id: 23 }]),
      },
    });
    deps.run.mockImplementation(async (_args, ctx) => ({
      ok: true,
      tabId: await getAssignedTabId(ctx),
    }));
    expect(await call('read', { tab: 17 })).toEqual({ ok: true, result: { ok: true, tabId: 17 } });
    vi.unstubAllGlobals();
  });

  it('the WebMCP page path keeps refusing ask-user and privileged tools', async () => {
    for (const action of ['privileged', 'ask-user']) {
      const result = await handleWebmcpCall(
        { callId: `page-${action}`, toolName: 'test_dynamic_tier', args: { action } },
        { permissionMode: 'act', initiator: 'desktop' },
      );
      expect(result.ok).toBe(false);
    }
    expect(deps.run).not.toHaveBeenCalled();
  });
});
