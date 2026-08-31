/**
 * THE AUTH-HYDRATION RACE, on this client's own kind-definition source.
 *
 * `@ai-matrx/content-ir-react` 0.10.0 fixed exactly this class inside its
 * `ComponentResolver`: a fresh surface warms BEFORE the Supabase session has
 * restored, the read runs as `anon`, RLS answers 42501, and a registry that
 * settled on that failure declared an empty world to be the truth. The
 * extension's kind source is the sibling instance of that class — it is warmed
 * exactly once per mount by `warmContentIr()`, so one unlucky read used to
 * decide for the whole session that the platform has never heard of any kind.
 *
 * These tests are built from that live shape: a permission failure followed by
 * an authenticated success, and a backend that is genuinely dead.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const reads = vi.hoisted(() => ({
  results: [] as Array<{ data: Array<{ kind: string }> | null; error: { message: string } | null }>,
  calls: 0,
}));

vi.mock('@/lib/supabase/schemas', () => ({
  contentIrDb: () => ({
    from: () => ({
      select: () => ({
        is: () => {
          const result = reads.results[reads.calls] ?? { data: [], error: null };
          reads.calls += 1;
          return Promise.resolve(result);
        },
      }),
    }),
  }),
}));

const reported = vi.hoisted(() => [] as string[]);
vi.mock('./errors', () => ({
  reportContentIrError: (e: { message: string }) => {
    reported.push(e.message);
  },
}));

const DENIED = {
  data: null,
  error: { message: 'permission denied for table kind_definition' },
};
const LOADED = { data: [{ kind: 'agent_mandate_specification' }], error: null };

async function freshRegistry() {
  vi.resetModules();
  return (await import('./registry')).kindRegistry;
}

beforeEach(() => {
  reads.results = [];
  reads.calls = 0;
  reported.length = 0;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('kind-definition warm load', () => {
  it('recovers the kind after the session restores — the failed read is not truth', async () => {
    reads.results = [DENIED, LOADED];
    const registry = await freshRegistry();

    await registry.ensureWarm();
    expect(registry.getDefinition('agent_mandate_specification')).toBeUndefined();
    expect(reported[0]).toContain('retrying in 1s');

    await vi.advanceTimersByTimeAsync(1_000);

    expect(reads.calls).toBe(2);
    expect(registry.getDefinition('agent_mandate_specification')).toEqual({
      kind: 'agent_mandate_specification',
      schema: null,
      schemaSource: 'content_ir',
      tier: 'warm',
    });
  });

  it('gives up loudly against a dead backend instead of retrying forever', async () => {
    reads.results = [DENIED, DENIED, DENIED, DENIED, DENIED, DENIED];
    const registry = await freshRegistry();

    await registry.ensureWarm();
    await vi.advanceTimersByTimeAsync(1_000 + 5_000 + 15_000 + 60_000);

    // Three scheduled retries after the first attempt, then a stop.
    expect(reads.calls).toBe(4);
    expect(reported.at(-1)).toContain('retries exhausted');
  });

  it('resets the retry budget after a success, so a later failure retries again', async () => {
    reads.results = [DENIED, LOADED];
    const registry = await freshRegistry();
    await registry.ensureWarm();
    await vi.advanceTimersByTimeAsync(1_000);

    expect((registry as unknown as { warmFailures: number }).warmFailures).toBe(0);
  });
});
