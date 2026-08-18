/**
 * `capture_study_set` — IC-11's browser half (WP5, education platform).
 *
 * The contract worth guarding is the same NEGATIVE one as prospect capture:
 * this tool must never become a second deck writer. Persistence is the
 * platform's one import door (`edu_import_deck` RPC — set + cards +
 * membership edges, atomic), so the tests pin that the handler stays a thin,
 * honest client of it:
 *
 *   1. `preview` is read-tier and `capture` is action-tier;
 *   2. an anonymous user is told to sign in before anything is written;
 *   3. capture goes through the RPC and nothing else — a grep pins that the
 *      handler never touches an `education.*` table or builds its own
 *      association edges (a direct write would pass tsc and silently be the
 *      side door IC-11 forbids).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { capture_study_set } from '@/lib/tools/handlers/education';
import type { ToolContext } from '@/lib/tools/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let accessToken: string | null = 'jwt';
vi.mock('@/lib/auth/flow', () => ({
  getAccessToken: async () => accessToken,
}));

const rpcCalls: { fn: string; args: unknown }[] = [];
let rpcResult: { data: unknown; error: { message: string } | null } = {
  data: { set_id: 'set-1', name: 'Spanish 101', card_count: 2 },
  error: null,
};
vi.mock('@/lib/supabase/client', () => ({
  getSupabase: () => ({
    rpc: async (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      return rpcResult;
    },
  }),
}));

let tab: { id: number; url?: string; title?: string } | null = {
  id: 7,
  url: 'https://quizlet.com/123/spanish-101',
  title: 'Spanish 101 | Quizlet',
};
vi.mock('@/lib/tools/handlers/_active-tab', () => ({
  getAssignedTab: async () => tab,
  getAssignedTabId: async () => tab?.id ?? null,
}));

const extracted = {
  ok: true,
  source: 'framework_state',
  title: 'Spanish 101',
  cards: [
    { front: 'hola', back: 'hello' },
    { front: 'adios', back: 'goodbye' },
  ],
};

function ctx(): ToolContext {
  return {
    conversationId: 'conv-1',
    runId: 'run-1',
    callId: 'call-1',
    agentName: 'tester',
    permissionMode: 'ask',
    assignedTabId: 7,
  } as unknown as ToolContext;
}

beforeEach(() => {
  rpcCalls.length = 0;
  accessToken = 'jwt';
  rpcResult = {
    data: { set_id: 'set-1', name: 'Spanish 101', card_count: 2 },
    error: null,
  };
  (globalThis as Record<string, unknown>).chrome = {
    scripting: {
      executeScript: async () => [{ result: extracted }],
    },
  };
});

describe('capture_study_set tiers', () => {
  it('preview is read-tier; capture is action-tier', () => {
    expect(capture_study_set.tierFor?.({ action: 'preview' })).toBe('read');
    expect(capture_study_set.tierFor?.({ action: 'capture' })).toBe('action');
  });
});

describe('preview', () => {
  it('extracts, reports, and writes nothing', async () => {
    const res = (await capture_study_set.run({ action: 'preview' }, ctx())) as Record<
      string,
      unknown
    >;
    expect(res.ok).toBe(true);
    expect(res.card_count).toBe(2);
    expect(res.deck_name).toBe('Spanish 101');
    expect(rpcCalls).toHaveLength(0);
  });
});

describe('capture', () => {
  it('refuses anonymous users before writing anything', async () => {
    accessToken = null;
    const res = (await capture_study_set.run({ action: 'capture' }, ctx())) as Record<
      string,
      unknown
    >;
    expect(res.ok).toBe(false);
    expect(res.error).toBe('sign_in_required');
    expect(rpcCalls).toHaveLength(0);
  });

  it('commits through the one import door (edu_import_deck)', async () => {
    const res = (await capture_study_set.run({ action: 'capture' }, ctx())) as Record<
      string,
      unknown
    >;
    expect(res.ok).toBe(true);
    expect(res.set_id).toBe('set-1');
    expect(rpcCalls).toHaveLength(1);
    const call = rpcCalls[0];
    if (!call) throw new Error('rpc call missing');
    expect(call.fn).toBe('edu_import_deck');
    const deck = (call.args as { p_deck: { cards: unknown[]; source: string } }).p_deck;
    expect(deck.cards).toHaveLength(2);
    expect(deck.source).toBe('extension:capture_study_set');
  });
});

describe('no side door (grep guard)', () => {
  it('the handler never touches education tables or association edges itself', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/lib/tools/handlers/education.ts'),
      'utf8',
    );
    // Supabase table access (`.from('...')` / `.schema(`), not Array.from.
    expect(src).not.toMatch(/\.from\(['"`]/);
    expect(src).not.toMatch(/\.schema\(/);
    expect(src).not.toMatch(/fc_set|fc_card/);
    expect(src).not.toMatch(/assoc_add|platform\.associations/);
    expect(src).toMatch(/edu_import_deck/);
  });
});
