/**
 * `capture_prospect` — IC-10's browser half.
 *
 * The contract worth guarding is a NEGATIVE one: this tool must never become a
 * second way to create a prospect. Everything that makes a prospect safe — the
 * blocklist at ingestion, the party resolver's normalization, dedupe against
 * the triage surface — lives on the server's one import path, so the tests here
 * pin that the handler is a thin, honest client of it:
 *
 *   1. it captures the ADDRESS CHROME RECORDS, not one the page can supply;
 *   2. `preview` is read-tier and `capture` is action-tier (a preview that
 *      demanded approval would teach the user to click through the one that
 *      matters);
 *   3. it never guesses which website a prospect belongs to;
 *   4. it does not touch a Supabase table itself — a grep, because a direct
 *      write added later would pass tsc and biome and silently be the side
 *      door the contract forbids.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { capture_prospect } from '@/lib/tools/handlers/prospects';
import type { ToolContext } from '@/lib/tools/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const previewCalls: unknown[] = [];
const captureCalls: unknown[] = [];
let previewResult: unknown = { ok: true, data: { verdict: 'new' } };
let captureResult: unknown = { ok: true, data: { outcome: 'created' } };

vi.mock('@/lib/api/routes/prospects', () => ({
  previewProspectCapture: async (body: unknown) => {
    previewCalls.push(body);
    return previewResult;
  },
  captureProspect: async (body: unknown) => {
    captureCalls.push(body);
    return captureResult;
  },
}));

let tab: { id: number; url?: string; title?: string } | null = {
  id: 7,
  url: 'https://example.com/resources',
  title: 'The best tools of 2026',
};

vi.mock('@/lib/tools/handlers/_active-tab', () => ({
  getAssignedTab: async () => tab,
  getAssignedTabId: async () => tab?.id ?? null,
}));

function ctx(): ToolContext {
  return {
    conversationId: 'conv-1',
    runId: 'run-1',
    callId: 'call-1',
    agentName: 'tester',
    permissionMode: 'ask',
    assignedTabId: 7,
  };
}

async function run(args: Record<string, unknown>) {
  const parsed = capture_prospect.argsSchema.parse(args);
  return (await capture_prospect.run(parsed, ctx())) as Record<string, unknown>;
}

beforeEach(() => {
  previewCalls.length = 0;
  captureCalls.length = 0;
  previewResult = { ok: true, data: { verdict: 'new' } };
  captureResult = { ok: true, data: { outcome: 'created' } };
  tab = { id: 7, url: 'https://example.com/resources', title: 'The best tools of 2026' };
});

describe('what gets captured', () => {
  it("defaults to the assigned tab's committed URL, not anything the page supplies", async () => {
    await run({});
    expect(previewCalls).toHaveLength(1);
    expect(previewCalls[0]).toMatchObject({
      url: 'https://example.com/resources',
      page_title: 'The best tools of 2026',
    });
  });

  it('does not label an explicitly-passed url with a different page’s title', async () => {
    await run({ url: 'https://somewhere-else.com' });
    expect(previewCalls[0]).toEqual({ url: 'https://somewhere-else.com' });
  });

  it('says so plainly when there is no page to capture', async () => {
    tab = null;
    const result = await run({});
    expect(result.ok).toBe(false);
    expect(result.error).toBe('no_page');
    expect(previewCalls).toHaveLength(0);
  });
});

describe('preview writes nothing, capture does', () => {
  it('previews by default rather than committing', async () => {
    await run({});
    expect(captureCalls).toHaveLength(0);
  });

  it('is read-tier for preview and action-tier for capture', () => {
    expect(capture_prospect.tierFor?.({ action: 'preview' })).toBe('read');
    expect(capture_prospect.tierFor?.({ action: 'capture' })).toBe('action');
    // The catalog-level default must stay the RISKY one — a tool advertised as
    // read-tier whose commit path writes is how an approval gate gets skipped.
    expect(capture_prospect.tier).toBe('action');
  });

  it('commits through the capture route when asked', async () => {
    const result = await run({ action: 'capture' });
    expect(captureCalls).toHaveLength(1);
    expect(result).toMatchObject({ ok: true, action: 'capture', outcome: 'created' });
  });
});

describe('refusals a user can act on', () => {
  it('asks the user which website instead of guessing one', async () => {
    captureResult = { ok: false, status: 409, error: 'site_choice_required' };
    const result = await run({ action: 'capture' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('site_choice_required');
    expect(String(result.message)).toContain('site_id');
  });

  it('names sign-in rather than surfacing an opaque 401', async () => {
    previewResult = { ok: false, status: 401, error: 'sign_in_required' };
    const result = await run({});
    expect(result.error).toBe('sign_in_required');
    expect(String(result.message)).toContain('Sign in');
  });
});

describe('there is no second door', () => {
  const sources = ['src/lib/tools/handlers/prospects.ts', 'src/lib/api/routes/prospects.ts'].map(
    (path) => readFileSync(join(process.cwd(), path), 'utf8'),
  );

  it('never reaches a database directly', () => {
    for (const source of sources) {
      expect(source).not.toMatch(/getSupabase|\.from\(|supabase\//);
    }
  });

  it('carries no domain normalizer of its own', () => {
    for (const source of sources) {
      expect(source).not.toMatch(/normalizeDomain|replace\(\/\^www\\\./);
    }
  });
});
