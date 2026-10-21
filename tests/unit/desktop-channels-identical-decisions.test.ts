import type { AnyToolHandler, ToolTier } from '@/lib/tools/types';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

// Both desktop channels — Matrx 2 (src/lib/desktop/matrx2/wire.ts) and Matrx Local's general channel
// (src/lib/desktop/ws-invoke.ts) — run their PRODUCTION wiring into the real dispatcher. Only the
// transports, the person's stored mode, the organization knob read and each tool's own work are
// doubled. Every registered tool is called through both, in both modes, under both knob values.
const deps = vi.hoisted(() => ({
  broadcast: vi.fn(),
  listeners: new Map<string, Set<(payload: unknown) => unknown>>(),
  knob: vi.fn<(key: string) => Promise<unknown>>(),
  mode: 'ask' as 'ask' | 'act',
  frames: [] as Array<Record<string, unknown>>,
  matrx2: null as null | {
    runTool: (
      call: { callId: string; toolName: string; args: Record<string, unknown> },
      hooks: { onAwaitingConfirmation: () => void; onRunning: () => void },
    ) => Promise<{ ok: boolean; result?: unknown; error?: string }>;
  },
  fixtures: new Map<string, AnyToolHandler>(),
  realLookup: null as null | ((name: string) => AnyToolHandler | undefined),
  ran: [] as string[],
}));

vi.mock('@/lib/messaging/native', () => ({
  broadcast: deps.broadcast,
  on: (channel: string, fn: (payload: unknown) => unknown) => {
    const set = deps.listeners.get(channel) ?? new Set();
    set.add(fn);
    deps.listeners.set(channel, set);
    return () => set.delete(fn);
  },
}));
vi.mock('@/lib/settings/platform-knob-snapshot', () => ({
  resolvePlatformKnobInWorker: deps.knob,
}));
vi.mock('@/lib/settings/persisted', () => ({
  readDefaultPermissionMode: async () => deps.mode,
}));
vi.mock('@/lib/desktop/ws-client', () => ({
  onWsMessage: vi.fn(),
  sendWs: async (frame: Record<string, unknown>) => {
    deps.frames.push(frame);
  },
}));
vi.mock('@/lib/desktop/bridge', () => ({ desktopRpc: vi.fn() }));
vi.mock('@/lib/desktop/matrx2/connection', () => ({
  configureMatrx2: (d: NonNullable<typeof deps.matrx2>) => {
    deps.matrx2 = d;
  },
  onMatrx2Change: () => () => undefined,
}));
vi.mock('@/lib/audit/log', () => ({ appendReceipt: vi.fn(), recordAuditFailure: vi.fn() }));
vi.mock('@/lib/audit/receipt', () => ({ PENDING_OUTPUT: {}, buildReceipt: vi.fn() }));
// The real tool table, each entry keeping its name and tier policy; its work is a recorder.
vi.mock('@/lib/tools/registry', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/tools/registry')>();
  deps.realLookup = actual.lookup;
  return {
    ...actual,
    lookup: (name: string) => deps.fixtures.get(name),
  };
});

import { wireMatrx2 } from '@/lib/desktop/matrx2/wire';
import { handleExtensionInvoke } from '@/lib/desktop/ws-invoke';
import { CHANNELS } from '@/lib/messaging/schemas';
import { listAllHandlers } from '@/lib/tools/registry';

type Decision = 'run' | 'ask' | 'refuse';

function tierOf(handler: AnyToolHandler): ToolTier {
  try {
    return handler.tierFor ? handler.tierFor({}) : handler.tier;
  } catch {
    return handler.tier;
  }
}

/** The owner's rule (2026-10-21), restated independently of the implementation. */
function expected(tier: ToolTier, mode: 'ask' | 'act', knob: unknown): Decision {
  if (tier === 'read') return 'run';
  if (tier === 'action') return mode === 'act' ? 'run' : 'ask';
  return knob === 'follow_act_without_asking' && mode === 'act' ? 'run' : 'ask';
}

let seq = 0;
async function observe(callId: string, go: () => Promise<boolean>): Promise<Decision> {
  deps.broadcast.mockClear();
  deps.ran.length = 0;
  const ok = await go();
  const asked = deps.broadcast.mock.calls.some(
    ([channel, payload]) =>
      channel === CHANNELS.TOOL_CONFIRM_REQUEST &&
      (payload as { callId: string }).callId === callId,
  );
  if (!ok || deps.ran.length !== 1) return 'refuse';
  return asked ? 'ask' : 'run';
}

const viaMatrx2 = (toolName: string) => {
  const callId = `m2-${++seq}`;
  return observe(callId, async () => {
    const out = await deps.matrx2!.runTool(
      { callId, toolName, args: {} },
      { onAwaitingConfirmation: () => undefined, onRunning: () => undefined },
    );
    return out.ok;
  });
};
const viaMatrxLocal = (toolName: string) => {
  const callId = `ml-${++seq}`;
  return observe(callId, async () => {
    deps.frames.length = 0;
    await handleExtensionInvoke({ type: 'extension.invoke', callId, toolName, args: {} });
    return deps.frames.find((f) => f.callId === callId)?.ok === true;
  });
};

describe('Matrx 2 and Matrx Local decide every tool the same way', () => {
  // One entry per tool name, as the registry resolves it (a few names have more than one handler).
  const handlers = [...new Set(listAllHandlers().map((h) => h.name))].map(
    (name) => deps.realLookup!(name)!,
  );

  beforeAll(() => {
    for (const real of handlers) {
      deps.fixtures.set(real.name, {
        name: real.name,
        tier: real.tier,
        ...(real.tierFor && { tierFor: real.tierFor }),
        argsSchema: z.any(),
        run: async () => {
          deps.ran.push(real.name);
          return { status: 'executed' };
        },
      } as AnyToolHandler);
    }
    wireMatrx2();
    // The person approves every card the dispatcher raises.
    deps.broadcast.mockImplementation((channel: string, payload: { callId: string }) => {
      if (channel !== CHANNELS.TOOL_CONFIRM_REQUEST) return;
      queueMicrotask(() => {
        for (const fn of deps.listeners.get(CHANNELS.TOOL_CONFIRM_RESPONSE) ?? [])
          void fn({ callId: payload.callId, decision: 'allow' });
      });
    });
  });
  beforeEach(() => deps.knob.mockReset());

  it('covers the whole tool table, privileged and ask-user tools included', () => {
    const tiers = new Set(handlers.map(tierOf));
    expect(handlers.length).toBeGreaterThan(50);
    expect(tiers).toEqual(new Set(['read', 'action', 'privileged', 'ask-user']));
    expect(deps.matrx2).not.toBeNull();
  });

  it.each([
    ['ask', undefined],
    ['act', undefined],
    ['ask', 'follow_act_without_asking'],
    ['act', 'follow_act_without_asking'],
  ] as const)('mode %s, organization knob %s', async (mode, knob) => {
    deps.mode = mode;
    deps.knob.mockResolvedValue(knob);
    const mismatches: string[] = [];
    for (const handler of handlers) {
      const tier = tierOf(handler);
      const m2 = await viaMatrx2(handler.name);
      const ml = await viaMatrxLocal(handler.name);
      const want = expected(tier, mode, knob);
      if (m2 !== ml || m2 !== want)
        mismatches.push(
          `${handler.name} (${tier}): Matrx 2 ${m2}, Matrx Local ${ml}, rule ${want}`,
        );
    }
    expect(mismatches).toEqual([]);
  });
});
