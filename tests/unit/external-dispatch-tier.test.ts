import { STORAGE_KEYS } from '@/config/env';
import { CHANNELS } from '@/lib/messaging/schemas';
import { DESKTOP_PRIVILEGED_KNOB } from '@/lib/tools/desktop-caller-policy';
import { handleWebmcpCall } from '@/lib/tools/dispatch';
import { getAssignedTabId } from '@/lib/tools/handlers/_active-tab';
import type { AnyToolHandler } from '@/lib/tools/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

// SUT owns parsing and permission routing. Only registered execution and
// outbound receipt/message transports are doubled; the dispatcher stays real.
const deps = vi.hoisted(() => ({
  lookup: vi.fn(),
  run: vi.fn(),
  broadcast: vi.fn(),
  listeners: new Map<string, Set<(payload: unknown) => unknown>>(),
  knob: vi.fn<(key: string) => Promise<unknown>>(),
}));
vi.mock('@/lib/tools/registry', () => ({ lookup: deps.lookup, allToolNames: () => [] }));
vi.mock('@/lib/messaging/native', () => ({
  broadcast: deps.broadcast,
  on: (channel: string, fn: (payload: unknown) => unknown) => {
    const set = deps.listeners.get(channel) ?? new Set();
    set.add(fn);
    deps.listeners.set(channel, set);
    return () => set.delete(fn);
  },
}));
// The organization knob's ONE read; the policy reader on top of it stays real.
vi.mock('@/lib/settings/platform-knob-snapshot', () => ({
  resolvePlatformKnobInWorker: deps.knob,
}));
vi.mock('@/lib/audit/log', () => ({ appendReceipt: vi.fn(), recordAuditFailure: vi.fn() }));
vi.mock('@/lib/audit/receipt', () => ({ PENDING_OUTPUT: {}, buildReceipt: vi.fn() }));

describe('external dispatcher effective permission tier', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deps.knob.mockResolvedValue(undefined);
    deps.run.mockResolvedValue({ status: 'executed' });
    const argsSchema = z.object({ action: z.enum(['read', 'privileged', 'ask-user']) });
    const handler: AnyToolHandler = {
      name: 'test_dynamic_tier',
      tier: 'read',
      argsSchema,
      tierFor: (args) => argsSchema.parse(args).action,
      run: deps.run,
    };
    deps.lookup.mockReturnValue(handler);
  });

  /** Answer the approval card the dispatcher raised for this call, as the person's click does. */
  const answerCard = async (callId: string, decision: 'allow' | 'deny') => {
    await vi.waitFor(() =>
      expect(deps.broadcast).toHaveBeenCalledWith(
        CHANNELS.TOOL_CONFIRM_REQUEST,
        expect.objectContaining({ callId }),
      ),
    );
    for (const fn of deps.listeners.get(CHANNELS.TOOL_CONFIRM_RESPONSE) ?? [])
      await fn({ callId, decision });
  };
  const asked = () =>
    deps.broadcast.mock.calls.some(([channel]) => channel === CHANNELS.TOOL_CONFIRM_REQUEST);

  describe.each(['privileged'] as const)(
    'a desktop app calls an argument-selected %s action',
    (action) => {
      it.each(['ask', 'act'] as const)(
        'asks the person first in %s mode, then runs on approve',
        async (mode) => {
          const callId = `desktop-${action}-${mode}-approve`;
          const pending = handleWebmcpCall(
            { callId, toolName: 'test_dynamic_tier', args: { action } },
            { permissionMode: mode, initiator: 'desktop' },
          );
          await answerCard(callId, 'allow');
          expect(await pending).toEqual({ ok: true, result: { status: 'executed' } });
          expect(deps.broadcast).toHaveBeenCalledWith(
            CHANNELS.TOOL_CONFIRM_REQUEST,
            expect.objectContaining({ callId, tier: action, initiator: 'desktop' }),
          );
          expect(deps.run).toHaveBeenCalledTimes(1);
        },
      );

      it('refuses with a clear error when the person declines', async () => {
        const callId = `desktop-${action}-deny`;
        const pending = handleWebmcpCall(
          { callId, toolName: 'test_dynamic_tier', args: { action } },
          { permissionMode: 'act', initiator: 'desktop' },
        );
        await answerCard(callId, 'deny');
        expect(await pending).toEqual({ ok: false, error: 'User denied this action' });
        expect(deps.run).not.toHaveBeenCalled();
      });

      it('refuses with a clear error when the approval times out', async () => {
        vi.useFakeTimers();
        try {
          const callId = `desktop-${action}-timeout`;
          const pending = handleWebmcpCall(
            { callId, toolName: 'test_dynamic_tier', args: { action } },
            { permissionMode: 'act', initiator: 'desktop' },
          );
          await vi.waitFor(() => expect(asked()).toBe(true));
          await vi.advanceTimersByTimeAsync(5 * 60_000);
          expect(await pending).toEqual({ ok: false, error: 'Approval timed out' });
          expect(deps.run).not.toHaveBeenCalled();
        } finally {
          vi.useRealTimers();
        }
      });

      it('runs without asking when the organization follows Act mode and Act is on', async () => {
        deps.knob.mockResolvedValue('follow_act_without_asking');
        const result = await handleWebmcpCall(
          {
            callId: `desktop-${action}-follow-act`,
            toolName: 'test_dynamic_tier',
            args: { action },
          },
          { permissionMode: 'act', initiator: 'desktop' },
        );
        expect(result).toEqual({ ok: true, result: { status: 'executed' } });
        expect(asked()).toBe(false);
        expect(deps.knob).toHaveBeenCalledWith(DESKTOP_PRIVILEGED_KNOB);
      });

      it('still asks when the organization follows Act mode but Act is off', async () => {
        deps.knob.mockResolvedValue('follow_act_without_asking');
        const callId = `desktop-${action}-follow-ask`;
        const pending = handleWebmcpCall(
          { callId, toolName: 'test_dynamic_tier', args: { action } },
          { permissionMode: 'ask', initiator: 'desktop' },
        );
        await answerCard(callId, 'allow');
        expect(await pending).toEqual({ ok: true, result: { status: 'executed' } });
      });

      it.each(['page', 'frontend'] as const)(
        'refuses a %s caller before executing the handler',
        async (initiator) => {
          const result = await handleWebmcpCall(
            { callId: `${initiator}-${action}`, toolName: 'test_dynamic_tier', args: { action } },
            { permissionMode: 'act', initiator },
          );
          expect(result.ok).toBe(false);
          expect(deps.run).not.toHaveBeenCalled();
          expect(deps.broadcast).not.toHaveBeenCalled();
        },
      );
    },
  );

  describe('a desktop app calls an argument-selected ask-user action', () => {
    // The tool's own prompt (its question, its review card) is the person's one ask: the dispatcher
    // raises no approval card on top of it (tests/unit/desktop-prompts-wait-and-ask-once.test.ts).
    it.each([
      ['ask', undefined],
      ['act', undefined],
      ['ask', 'follow_act_without_asking'],
      ['act', 'follow_act_without_asking'],
    ] as const)('runs with no approval card in %s mode, knob %s', async (mode, knob) => {
      deps.knob.mockResolvedValue(knob);
      const result = await handleWebmcpCall(
        {
          callId: `desktop-ask-user-${mode}`,
          toolName: 'test_dynamic_tier',
          args: { action: 'ask-user' },
        },
        { permissionMode: mode, initiator: 'desktop' },
      );
      expect(result).toEqual({ ok: true, result: { status: 'executed' } });
      expect(asked()).toBe(false);
    });

    it.each(['page', 'frontend'] as const)('refuses a %s caller', async (initiator) => {
      const result = await handleWebmcpCall(
        {
          callId: `${initiator}-ask-user`,
          toolName: 'test_dynamic_tier',
          args: { action: 'ask-user' },
        },
        { permissionMode: 'act', initiator },
      );
      expect(result.ok).toBe(false);
      expect(deps.run).not.toHaveBeenCalled();
    });
  });

  it('executes a parsed read action once and returns its result', async () => {
    const result = await handleWebmcpCall(
      { callId: 'external-tier-test', toolName: 'test_dynamic_tier', args: { action: 'read' } },
      { permissionMode: 'act', initiator: 'desktop' },
    );
    expect(result).toEqual({ ok: true, result: { status: 'executed' } });
    expect(deps.run).toHaveBeenCalledTimes(1);
    expect(deps.run.mock.calls[0]?.[0]).toEqual({ action: 'read' });
  });

  it('denies a guest page-origin call to an admin-only tool before any side effect', async () => {
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn(async () => ({ [STORAGE_KEYS.IS_ADMIN]: false })),
        },
      },
    });
    deps.lookup.mockReturnValue({
      name: 'admin_webmcp_fixture',
      tier: 'action',
      admin_only: true,
      argsSchema: z.object({}),
      run: deps.run,
    } satisfies AnyToolHandler);
    try {
      const result = await handleWebmcpCall(
        { callId: 'guest-origin-test', toolName: 'admin_webmcp_fixture', args: {} },
        { permissionMode: 'act', initiator: 'page' },
      );
      expect(result).toEqual({
        ok: false,
        error:
          "webmcp: tool 'admin_webmcp_fixture' is admin-only and cannot be invoked externally for this user",
      });
      expect(deps.run).not.toHaveBeenCalled();
      expect(deps.broadcast).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps an external page read on its assigned tab after focus changes, and reports a closed origin', async () => {
    const tabs = new Set([17, 23]);
    vi.stubGlobal('chrome', {
      tabs: {
        get: vi.fn(async (id: number) => {
          if (!tabs.has(id)) throw new Error('No tab with id');
          return { id };
        }),
        query: vi.fn(async () => [{ id: 23 }]),
      },
    });
    deps.run.mockImplementation(async (_args, ctx) => {
      const tabId = await getAssignedTabId(ctx);
      return tabId == null ? { ok: false, reason: 'No active tab' } : { ok: true, tabId };
    });
    const payload = {
      callId: 'origin-tab-test',
      toolName: 'test_dynamic_tier',
      args: { action: 'read' },
    };
    expect(
      await handleWebmcpCall(payload, {
        permissionMode: 'act',
        initiator: 'page',
        assignedTabId: 17,
      }),
    ).toEqual({
      ok: true,
      result: { ok: true, tabId: 17 },
    });
    tabs.delete(17);
    expect(
      await handleWebmcpCall(payload, {
        permissionMode: 'act',
        initiator: 'page',
        assignedTabId: 17,
      }),
    ).toEqual({
      ok: false,
      error: 'webmcp: origin tab unavailable',
    });
    expect(chrome.tabs.query).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
