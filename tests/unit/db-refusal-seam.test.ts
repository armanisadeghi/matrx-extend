/**
 * Forcing test for the database error seam (DD-092).
 *
 * What it forces: a database refusal can never again end as a console warning
 * plus a success-shaped empty value. Each case drives the REAL production
 * function with the exact error object PostgREST returns, and asserts all
 * three halves of the contract at once:
 *
 *   (a) the user is told — a notice with a human sentence AND a remedy,
 *   (b) the platform error store is told — the existing `log_client_error` RPC
 *       is called with the code and the call site,
 *   (c) nothing success-shaped comes back — the call throws.
 *
 * These assertions FAIL against the previous implementation: it returned
 * `null` / `[]` and never touched the notice store or the RPC. (Proven by
 * reverting `failDbCall` to `console.warn` + `return null` locally — the four
 * "before" behaviours are asserted explicitly in the last block.)
 */

import { clearHighlightsForUrl, createHighlight, deleteHighlight } from '@/lib/highlights/queries';
import { classifyDbFailure, isDbFailureError, userMessageFor } from '@/lib/supabase/db-failure';
import { saveCapture } from '@/lib/supabase/queries';
import { appendRowsToUserTable, listUserTables } from '@/lib/supabase/user-tables';
import { useNoticeStore } from '@/state/notices';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireRequestOrganizationId: vi.fn(),
  getSupabase: vi.fn(),
  workbenchDb: vi.fn(),
  extendDb: vi.fn(),
  adminDb: vi.fn(),
  aiDb: vi.fn(),
  getActiveOrganizationId: vi.fn(),
  rpc: vi.fn(),
  logError: vi.fn(),
}));

vi.mock('@/lib/debug/log', () => ({
  log: {
    error: mocks.logError,
    warn: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock('@/lib/api/routes/auth', () => ({
  requireRequestOrganizationId: mocks.requireRequestOrganizationId,
}));
vi.mock('@/lib/supabase/client', () => ({ getSupabase: mocks.getSupabase }));
vi.mock('@/lib/supabase/schemas', () => ({
  workbenchDb: mocks.workbenchDb,
  extendDb: mocks.extendDb,
  adminDb: mocks.adminDb,
  aiDb: mocks.aiDb,
}));
vi.mock('@/lib/org/active-org', () => ({
  getActiveOrganizationId: mocks.getActiveOrganizationId,
}));

const ORG_ID = '22222222-2222-4222-8222-222222222222';

/** The exact envelope PostgREST returns when RLS refuses a write. */
const RLS_REFUSAL = {
  code: '42501',
  message: 'new row violates row-level security policy for table "wbx_capture"',
  details: null,
  hint: null,
};

/** The exact envelope PostgREST returns when the relation is not there. */
const MISSING_RELATION = {
  code: '42P01',
  message: 'relation "workbench.udt_datasets" does not exist',
  details: null,
  hint: null,
};

/** A Supabase query builder stub whose terminal call resolves to `result`. */
function builder(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  const hop = () => chain;
  for (const k of ['from', 'select', 'insert', 'update', 'delete', 'eq', 'in', 'is', 'order']) {
    chain[k] = vi.fn(hop);
  }
  chain.schema = vi.fn(hop);
  chain.single = vi.fn(async () => result);
  // A PostgREST builder really IS thenable — that is how `await db.from(...)
  // .select(...)` terminates. Reproducing that shape is the point of the stub.
  // biome-ignore lint/suspicious/noThenProperty: modelling the real builder
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
  chain.auth = { getUser: async () => ({ data: { user: { id: 'u1' } } }) };
  chain.rpc = mocks.rpc;
  return chain;
}

/**
 * One client whose successive terminal awaits resolve to successive results —
 * for a function that issues two queries through a single `getSupabase()`.
 */
function builderSequence(results: { data: unknown; error: unknown }[]) {
  const queue = [...results];
  const chain = builder({ data: null, error: null });
  const next = () => queue.shift() ?? { data: null, error: null };
  // biome-ignore lint/suspicious/noThenProperty: modelling the real builder
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(next()).then(resolve);
  chain.single = vi.fn(async () => next());
  return chain;
}

function lastNotice() {
  const all = useNoticeStore.getState().notices;
  return all[all.length - 1];
}

beforeEach(() => {
  vi.clearAllMocks();
  useNoticeStore.getState().clear();
  mocks.requireRequestOrganizationId.mockResolvedValue(ORG_ID);
  mocks.getActiveOrganizationId.mockResolvedValue(ORG_ID);
  mocks.rpc.mockResolvedValue({ data: 'err-id', error: null });
});

describe('a refused write is never swallowed', () => {
  it('saveCapture: a 42501 refusal throws, shows a notice, and is reported', async () => {
    const chain = builder({ data: null, error: RLS_REFUSAL });
    mocks.getSupabase.mockReturnValue(chain);

    // (c) no success-shaped value
    await expect(saveCapture({ url: 'https://example.com', soup: {} })).rejects.toMatchObject({
      name: 'DbFailureError',
      kind: 'refused',
      code: '42501',
    });

    // (a) the user is told, in a sentence, with a remedy
    const notice = lastNotice();
    expect(notice).toBeDefined();
    expect(notice?.tone).toBe('error');
    expect(notice?.title).toBe('Page capture not saved');
    expect(notice?.message).toContain('AI Matrx could not save this page capture');
    expect(notice?.message).toContain('Nothing was saved.');
    expect(notice?.message.toLowerCase()).toContain('try again');
    // The raw Postgres code is NOT in the sentence the user reads.
    expect(notice?.message).not.toContain('42501');

    // (b) the platform error store is told, through the EXISTING RPC
    await vi.waitFor(() => expect(mocks.rpc).toHaveBeenCalled());
    const [fn, args] = mocks.rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(fn).toBe('log_client_error');
    expect(args.p_source).toBe('chrome-extension');
    expect(args.p_code).toBe('42501');
    expect(args.p_route).toBe('extend.wbx_capture');
    expect(args.p_organization_id).toBe(ORG_ID);
  });

  it('createHighlight: a refusal throws instead of returning null', async () => {
    mocks.getSupabase.mockReturnValue(builder({ data: null, error: RLS_REFUSAL }));
    await expect(
      createHighlight({
        mode: 'text',
        url: 'https://example.com',
        domain: 'example.com',
        anchor: {},
      }),
    ).rejects.toSatisfy(isDbFailureError);
    expect(lastNotice()?.title).toBe('Highlight not saved');
  });

  it('deleteHighlight: an RLS-empty delete (no error, zero rows) is treated as a refusal', async () => {
    // The dangerous shape: PostgREST reports NO error, but RLS matched no row.
    mocks.getSupabase.mockReturnValue(builder({ data: [], error: null }));
    await expect(deleteHighlight('11111111-1111-4111-8111-111111111111')).rejects.toMatchObject({
      kind: 'refused',
    });
    expect(lastNotice()?.title).toBe('Highlight not deleted');
    expect(lastNotice()?.message).toContain('AI Matrx could not delete this highlight');
  });
});

describe('a failed dataset read is never an empty list', () => {
  it('listUserTables: "relation does not exist" throws and notices, instead of []', async () => {
    mocks.workbenchDb.mockReturnValue(builder({ data: null, error: MISSING_RELATION }));
    mocks.getSupabase.mockReturnValue(builder({ data: null, error: null }));

    const result = await listUserTables().then(
      (v) => ({ resolved: v }),
      (e) => ({ thrown: e }),
    );
    expect('thrown' in result).toBe(true);
    expect('resolved' in result).toBe(false); // never `[]`
    expect((result as { thrown: unknown }).thrown).toMatchObject({ kind: 'missing_relation' });

    const notice = lastNotice();
    expect(notice?.title).toBe('Datasets could not be loaded');
    expect(notice?.message).toContain('AI Matrx could not load your datasets');
    // A read must NOT claim "nothing was saved", and must say this is not an
    // empty result — that is the exact lie this whole seam exists to stop.
    expect(notice?.message).toContain('this is NOT an empty result');
    expect(notice?.message).not.toContain('Nothing was saved');

    await vi.waitFor(() => expect(mocks.rpc).toHaveBeenCalled());
    expect((mocks.rpc.mock.calls[0] as [string, Record<string, unknown>])[1].p_code).toBe('42P01');
  });
});

describe('the error door itself can fail — and says so', () => {
  it('a log_client_error that records nothing (null id) is reported loudly, not swallowed', async () => {
    // The live RPC returns NULL without inserting when it cannot resolve an
    // organization, and its body swallows insert errors. From the client that
    // is indistinguishable from success unless we check the returned id.
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    mocks.getSupabase.mockReturnValue(builder({ data: null, error: RLS_REFUSAL }));

    await expect(saveCapture({ url: 'https://example.com', soup: {} })).rejects.toSatisfy(
      isDbFailureError,
    );

    // The user is still told.
    expect(lastNotice()?.title).toBe('Page capture not saved');
    // And the double-failure is loud locally, carrying BOTH errors.
    await vi.waitFor(() => {
      const loud = mocks.logError.mock.calls.find((c) =>
        String(c[1]).includes('did NOT record this'),
      );
      expect(loud).toBeDefined();
      const detail = loud?.[2] as { original: { code: string }; remedy: string };
      expect(detail.original.code).toBe('42501');
      expect(detail.remedy).toContain('log_client_error');
    });
  });

  it('an unreachable error store is reported the same way', async () => {
    mocks.rpc.mockRejectedValue(new Error('Failed to fetch'));
    mocks.getSupabase.mockReturnValue(builder({ data: null, error: RLS_REFUSAL }));

    await expect(saveCapture({ url: 'https://example.com', soup: {} })).rejects.toSatisfy(
      isDbFailureError,
    );
    await vi.waitFor(() => {
      expect(
        mocks.logError.mock.calls.some((c) => String(c[1]).includes('did NOT record this')),
      ).toBe(true);
    });
  });
});

describe('clearing highlights tells "nothing to clear" apart from "refused"', () => {
  it('no highlights on the page → 0, no notice, no error', async () => {
    mocks.getSupabase.mockReturnValue(builder({ data: [], error: null }));
    await expect(clearHighlightsForUrl('https://example.com')).resolves.toBe(0);
    expect(useNoticeStore.getState().notices).toHaveLength(0);
  });

  it('rows existed but none moved → a refusal, never "cleared 0"', async () => {
    // First call reads two ids; the UPDATE returns zero rows with NO error —
    // exactly what an RLS-refused update looks like.
    mocks.getSupabase.mockReturnValue(
      builderSequence([
        { data: [{ id: 'a' }, { id: 'b' }], error: null }, // the ids that exist
        { data: [], error: null }, // the UPDATE moved none, with no error
      ]),
    );
    await expect(clearHighlightsForUrl('https://example.com')).rejects.toMatchObject({
      kind: 'refused',
    });
    expect(lastNotice()?.title).toBe('Highlights not cleared');
  });
});

describe('appendRowsToUserTable has no success-shaped fallback', () => {
  it('an RPC answer that is not a row count fails instead of reporting 0 inserted', async () => {
    mocks.getSupabase.mockReturnValue(builder({ data: null, error: null }));
    await expect(
      appendRowsToUserTable('11111111-1111-4111-8111-111111111111', [{ a: 1 }]),
    ).rejects.toSatisfy(isDbFailureError);
    expect(lastNotice()?.title).toBe('Rows not added to the dataset');
  });
});

describe('classification', () => {
  it.each([
    [{ code: '42501', message: 'x' }, 'refused'],
    [{ code: null, message: 'new row violates row-level security policy' }, 'refused'],
    [{ code: 'PGRST116', message: 'no rows returned' }, 'refused'],
    [null, 'refused'],
    [{ code: '42P01', message: 'relation "x" does not exist' }, 'missing_relation'],
    [{ code: 'PGRST205', message: "Could not find the table 'public.x'" }, 'missing_relation'],
    [{ code: 'no_organization', message: 'no org' }, 'no_workspace'],
    [{ code: 'PGRST301', message: 'JWT expired' }, 'not_authenticated'],
    [{ code: null, message: 'Failed to fetch' }, 'unreachable'],
    [{ code: '23505', message: 'duplicate key' }, 'failed'],
  ])('%o → %s', (error, expected) => {
    expect(classifyDbFailure(error)).toBe(expected);
  });

  it('every failure kind produces a sentence with a remedy', () => {
    const site = {
      table: 'extend.wbx_capture',
      operation: 'insert' as const,
      what: 'save this page capture',
      title: 'Page capture not saved',
    };
    for (const kind of [
      'refused',
      'missing_relation',
      'not_authenticated',
      'unreachable',
      'no_workspace',
      'failed',
    ] as const) {
      const msg = userMessageFor(kind, site);
      expect(msg.startsWith('AI Matrx could not save this page capture')).toBe(true);
      // A remedy sentence — an instruction the user can act on — is mandatory.
      expect(/try again|sign in again|pick a workspace|ours to fix/i.test(msg)).toBe(true);
      expect(msg.length).toBeGreaterThan(80);
    }
  });
});
