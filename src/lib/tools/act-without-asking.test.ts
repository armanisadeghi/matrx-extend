/**
 * "ACT WITHOUT ASKING" MEANS NOTHING WAITS BUT THE AGENT'S OWN QUESTION.
 *
 * The break (Arman, 2026-10-14): the extension ignored the setting. Privileged tools "always
 * confirmed, even in Act", and several fallbacks defaulted to 'ask'. This drives the real
 * package-chat door (`runDeviceToolCall` -> `handleCall`, the same gate the extension's own chat
 * uses) with a registered handler per tier and counts the approval cards the gate raises.
 * Replaced: the registry lookup (fake handlers) and the message bus (records broadcasts).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const broadcasts: { channel: string; payload: unknown }[] = [];
vi.mock('@/lib/messaging/native', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/messaging/native')>('@/lib/messaging/native');
  return {
    ...actual,
    broadcast: (channel: string, payload: unknown) => {
      broadcasts.push({ channel, payload });
    },
    on: () => () => undefined,
  };
});

const runs: string[] = [];
function fake(name: string, tier: 'read' | 'action' | 'privileged') {
  return {
    name,
    tier,
    argsSchema: z.object({}).passthrough(),
    run: async () => {
      runs.push(name);
      return { ok: true };
    },
  };
}
const handlers: Record<string, unknown> = {
  t_read: fake('t_read', 'read'),
  t_action: fake('t_action', 'action'),
  t_privileged: fake('t_privileged', 'privileged'),
};
vi.mock('@/lib/tools/registry', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/tools/registry')>('@/lib/tools/registry');
  return { ...actual, lookup: (n: string) => handlers[n] ?? actual.lookup(n) };
});

import { runDeviceToolCall } from './dispatch';
import { mayActWithoutAsking, needsApproval } from './tier-policy';

const cards = () => broadcasts.filter((b) => b.channel === 'tool:confirm-request');

async function call(tool: string, mode: 'ask' | 'act', n: number) {
  const pending = runDeviceToolCall({
    callId: `call-${tool}-${mode}-${n}`,
    toolName: tool,
    args: {},
    conversationId: `conv-${mode}-${n}`,
    permissionMode: mode,
    assignedTabId: null,
  });
  // Give the gate time to either run the tool or raise a card.
  await new Promise((r) => setTimeout(r, 60));
  return pending;
}

beforeEach(() => {
  broadcasts.length = 0;
  runs.length = 0;
});

describe('the one resolver', () => {
  it('act skips every tier; ask keeps action and privileged; a page never inherits act', () => {
    for (const tier of ['read', 'action', 'privileged', 'ask-user'] as const) {
      expect(needsApproval(tier, 'act')).toBe(false);
    }
    expect(needsApproval('action', 'ask')).toBe(true);
    expect(needsApproval('privileged', 'ask')).toBe(true);
    expect(needsApproval('read', 'ask')).toBe(false);
    expect(mayActWithoutAsking('act', 'page')).toBe(false);
    expect(mayActWithoutAsking('act', 'frontend')).toBe(true);
  });
});

describe('with Act without asking ON, no browser tool waits', () => {
  it.each(['t_read', 't_action', 't_privileged'])('%s runs with no approval card', async (tool) => {
    const out = await call(tool, 'act', 1);
    expect(out).toMatchObject({ ok: true });
    expect(cards()).toHaveLength(0);
    expect(runs).toContain(tool);
  });
});

describe('with it OFF, the prompts still appear', () => {
  it.each(['t_action', 't_privileged'])('%s waits behind an approval card', async (tool) => {
    void call(tool, 'ask', 2);
    await new Promise((r) => setTimeout(r, 120));
    expect(cards()).toHaveLength(1);
    expect(runs).not.toContain(tool);
  });

  it('a read tool never asks', async () => {
    await call('t_read', 'ask', 3);
    expect(cards()).toHaveLength(0);
    expect(runs).toContain('t_read');
  });
});

describe("with Act without asking ON, the agent's own question to the person still waits", () => {
  it('the user tool raises its question card and stays pending until answered', async () => {
    let settled = false;
    void runDeviceToolCall({
      callId: 'call-user-act-4',
      toolName: 'user',
      args: { type: 'text', question: 'Which account should I use?' },
      conversationId: 'conv-act-4',
      permissionMode: 'act',
      assignedTabId: null,
    }).then(() => {
      settled = true;
    });
    await new Promise((r) => setTimeout(r, 150));
    const questions = broadcasts.filter((b) => b.channel === 'tool:ask-user-request');
    expect(questions).toHaveLength(1);
    expect(cards()).toHaveLength(0);
    expect(settled).toBe(false);
  });
});
