import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { AnyToolHandler, ToolTier } from '@/lib/tools/types';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

// A desktop app's call raises its prompt while the side panel may be closed. The real dispatcher and
// the real `user` awaiter run; only transports, the knob read and each tool's own work are doubled.
const deps = vi.hoisted(() => ({
  broadcast: vi.fn(),
  listeners: new Map<string, Set<(payload: unknown) => unknown>>(),
  knob: vi.fn<(key: string) => Promise<unknown>>(),
  fixtures: new Map<string, AnyToolHandler>(),
  realLookup: null as null | ((name: string) => AnyToolHandler | undefined),
}));
vi.mock('@/lib/messaging/native', () => ({
  broadcast: deps.broadcast,
  send: vi.fn(),
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
vi.mock('@/lib/audit/log', () => ({ appendReceipt: vi.fn(), recordAuditFailure: vi.fn() }));
vi.mock('@/lib/audit/receipt', () => ({ PENDING_OUTPUT: {}, buildReceipt: vi.fn() }));
vi.mock('@/lib/tools/registry', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/tools/registry')>();
  deps.realLookup = actual.lookup;
  return { ...actual, lookup: (name: string) => deps.fixtures.get(name) };
});

import { CHANNELS } from '@/lib/messaging/schemas';
import { handleWebmcpCall } from '@/lib/tools/dispatch';
import { awaitUserResponse } from '@/lib/tools/handlers/user';
import { listAllHandlers } from '@/lib/tools/registry';

const chromeStub = {
  action: { setBadgeText: vi.fn(async () => undefined), setBadgeBackgroundColor: vi.fn() },
  notifications: { create: vi.fn(), clear: vi.fn(), onClicked: { addListener: vi.fn() } },
  runtime: { getURL: (p: string) => `chrome-extension://x/${p}` },
};
const globalChrome = globalThis as unknown as { chrome: Record<string, unknown> };
const saved = { ...globalChrome.chrome };

/** The side panel opening: it asks the SW what is still waiting. */
async function sidePanelOpens(): Promise<{
  confirms: Array<{ callId: string }>;
  asks: Array<{ callId: string }>;
}> {
  const [handler] = [...(deps.listeners.get(CHANNELS.TOOL_INBOX_PENDING) ?? [])];
  expect(handler, 'nothing answers "what is still waiting?"').toBeDefined();
  return (await handler?.({})) as never;
}
const prompts = (callId: string) =>
  deps.broadcast.mock.calls.filter(
    ([channel, payload]) =>
      (channel === CHANNELS.TOOL_CONFIRM_REQUEST || channel === CHANNELS.TOOL_ASK_USER_REQUEST) &&
      String((payload as { callId: string }).callId).startsWith(callId),
  );
const respond = async (channel: string, payload: unknown) => {
  for (const fn of deps.listeners.get(channel) ?? []) await fn(payload);
};

beforeAll(() => Object.assign(globalChrome.chrome, chromeStub));
afterAll(() => {
  globalChrome.chrome = saved;
});
beforeEach(() => {
  vi.clearAllMocks();
  deps.knob.mockResolvedValue(undefined);
  deps.fixtures.clear();
});

describe('an approval raised while the side panel is closed is not lost', () => {
  it('a desktop privileged call waits loudly, and the side panel shows its card when it opens', async () => {
    const run = vi.fn(async () => ({ status: 'executed' }));
    deps.fixtures.set('fixture_privileged', {
      name: 'fixture_privileged',
      tier: 'privileged',
      argsSchema: z.object({}),
      run,
    });
    const pending = handleWebmcpCall(
      { callId: 'closed-panel-1', toolName: 'fixture_privileged', args: {} },
      { permissionMode: 'act', initiator: 'desktop' },
    );
    await vi.waitFor(() => expect(prompts('closed-panel-1')).toHaveLength(1));
    // The broadcast went nowhere (no panel). The panel opens later:
    expect((await sidePanelOpens()).confirms.map((c) => c.callId)).toEqual(['closed-panel-1']);
    // Loud while it waits: the toolbar count and a notification naming the caller.
    expect(chromeStub.action.setBadgeText).toHaveBeenLastCalledWith({ text: '1' });
    expect(chromeStub.notifications.create).toHaveBeenCalledWith(
      'matrx-waiting:closed-panel-1',
      expect.objectContaining({
        title: 'Waiting for your answer in Chrome',
        message: expect.stringContaining('The Matrx desktop app'),
      }),
    );
    await respond(CHANNELS.TOOL_CONFIRM_RESPONSE, { callId: 'closed-panel-1', decision: 'allow' });
    expect(await pending).toEqual({ ok: true, result: { status: 'executed' } });
    expect((await sidePanelOpens()).confirms).toEqual([]);
    expect(chromeStub.action.setBadgeText).toHaveBeenLastCalledWith({ text: '' });
    expect(chromeStub.notifications.clear).toHaveBeenCalledWith('matrx-waiting:closed-panel-1');
  });
});

describe('a question raised while the side panel is closed is not lost', () => {
  it("a desktop ask-user tool's question is shown when the side panel opens", async () => {
    deps.fixtures.set('fixture_ask', {
      name: 'fixture_ask',
      tier: 'ask-user',
      argsSchema: z.object({}),
      run: async (_args, ctx) =>
        awaitUserResponse(
          { callId: ctx.callId, conversationId: null, kind: 'confirm', question: 'Send it?' },
          null,
        ),
    });
    const pending = handleWebmcpCall(
      { callId: 'closed-panel-ask', toolName: 'fixture_ask', args: {} },
      { permissionMode: 'ask', initiator: 'desktop' },
    );
    await vi.waitFor(() => expect(prompts('closed-panel-ask').length).toBeGreaterThan(0));
    for (const [channel] of prompts('closed-panel-ask'))
      if (channel === CHANNELS.TOOL_CONFIRM_REQUEST)
        await respond(CHANNELS.TOOL_CONFIRM_RESPONSE, {
          callId: 'closed-panel-ask',
          decision: 'allow',
        });
    await vi.waitFor(async () =>
      expect((await sidePanelOpens()).asks.map((a) => a.callId)).toEqual(['closed-panel-ask']),
    );
    expect(chromeStub.notifications.create).toHaveBeenCalledWith(
      'matrx-waiting:closed-panel-ask',
      expect.objectContaining({ message: expect.stringContaining('The Matrx desktop app') }),
    );
    await respond(CHANNELS.TOOL_ASK_USER_RESPONSE, { callId: 'closed-panel-ask', confirmed: true });
    expect((await pending).ok).toBe(true);
    expect((await sidePanelOpens()).asks).toEqual([]);
  });
});

describe('ask-user tools ask once, never twice', () => {
  // Every ask-user tool in the real table, each asking through the ONE awaiter as the real ones do.
  const askUserTools = [...new Set(listAllHandlers().map((h) => h.name))]
    .map((name) => deps.realLookup?.(name))
    .filter((h): h is AnyToolHandler => !!h && h.tier === ('ask-user' satisfies ToolTier));

  it('the table has ask-user tools, and every one asks through the shared awaiter', () => {
    expect(askUserTools.map((h) => h.name).sort()).toEqual(
      expect.arrayContaining(['google_email_send', 'outlook_email_send', 'user']),
    );
    const dir = join(import.meta.dirname, '..', '..', 'src', 'lib', 'tools', 'handlers');
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.includes('.test.'))) {
      const src = readFileSync(join(dir, file), 'utf8');
      if (src.includes("tier: 'ask-user'"))
        expect(src, `${file} has an ask-user tool that asks some other way`).toMatch(
          /awaitUserResponse\(/,
        );
    }
  });

  it.each([
    ['ask', undefined],
    ['act', undefined],
    ['ask', 'follow_act_without_asking'],
    ['act', 'follow_act_without_asking'],
  ] as const)('mode %s, organization knob %s: one prompt per call', async (mode, knob) => {
    deps.knob.mockResolvedValue(knob);
    const twice: string[] = [];
    for (const real of askUserTools) {
      const callId = `once-${real.name}-${mode}-${knob ?? 'none'}`;
      deps.fixtures.set(real.name, {
        name: real.name,
        tier: 'ask-user',
        argsSchema: z.any(),
        run: async (_args, ctx) => {
          const r = await awaitUserResponse(
            { callId: ctx.callId, conversationId: null, kind: 'confirm', question: 'Send it?' },
            null,
          );
          return { answered: r !== 'timed_out' && !r.cancelled };
        },
      } as AnyToolHandler);
      const pending = handleWebmcpCall(
        { callId, toolName: real.name, args: {} },
        { permissionMode: mode, initiator: 'desktop' },
      );
      await vi.waitFor(() => expect(prompts(callId).length).toBeGreaterThan(0));
      for (const [channel] of prompts(callId))
        if (channel === CHANNELS.TOOL_CONFIRM_REQUEST)
          await respond(CHANNELS.TOOL_CONFIRM_RESPONSE, { callId, decision: 'allow' });
      await respond(CHANNELS.TOOL_ASK_USER_RESPONSE, { callId, confirmed: true });
      const result = await pending;
      if (prompts(callId).length !== 1 || !result.ok)
        twice.push(`${real.name}: ${prompts(callId).length} prompts, ${JSON.stringify(result)}`);
    }
    expect(twice).toEqual([]);
  });
});
