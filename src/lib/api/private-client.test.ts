import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  token: '',
  org: '00000000-0000-4000-8000-000000000002',
  user: '00000000-0000-4000-8000-000000000001',
  verificationHook: null as null | (() => Promise<void>),
  tokenReadHook: null as null | (() => void),
}));
const token = (session: string): string => `x.${btoa(JSON.stringify({ session_id: session }))}.y`;
state.token = token('session-a');

vi.mock('@/config/backend', () => ({ getBackendUrl: async () => 'https://private.example' }));
vi.mock('@/lib/auth/flow', () => ({
  getAccessToken: async () => {
    state.tokenReadHook?.();
    return state.token;
  },
  getVerifiedCurrentUser: async () => {
    await state.verificationHook?.();
    return { id: state.user };
  },
}));
vi.mock('@/lib/org/active-org', () => ({
  getActiveOrganizationId: async () => state.org,
  holdForActiveOrganizationId: async () => state.org,
  isOrganizationNotSelectedError: (e: unknown) =>
    e instanceof Error && e.name === 'OrganizationNotSelectedError',
  isOrganizationNoMembershipsError: (e: unknown) =>
    e instanceof Error && e.name === 'OrganizationNoMembershipsError',
  OrganizationNotSelectedError: class extends Error {},
}));
vi.mock('@/lib/auth/guest-signature', () => ({ getOrCreateGuestSignature: async () => 'guest' }));
vi.mock('@/lib/debug/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
}));
vi.mock('@/lib/messaging/native', () => ({ broadcast: vi.fn() }));

import { z } from 'zod';
import { getPrivateExpectedActor, parseStrictPrivateJson, privatePost } from './client';
import { acknowledgeLocalBrowser, verifyLocalBrowser } from './routes/local-browser';

const expectedActor = { userId: state.user, organizationId: state.org, sessionId: 'session-a' };
const schema = z.object({ status: z.literal('accepted'), challenge_id: z.string() }).strict();
const admissionId = '00000000-0000-4000-8000-000000000003';
const stopId = '00000000-0000-4000-8000-000000000004';
const noStore = { headers: { 'cache-control': 'no-store' } };

describe('private lifecycle transport', () => {
  it('does not dispatch when the deadline passes during the final identity await', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(100_000);
    let reads = 0;
    state.tokenReadHook = () => {
      reads += 1;
      if (reads === 4) now.mockReturnValue(120_000);
    };
    const fetchMock = vi.fn(
      async () => new Response('{"status":"accepted","challenge_id":"c"}', noStore),
    );
    vi.stubGlobal('fetch', fetchMock);
    try {
      await expect(
        privatePost({
          path: '/browser-manager/local/verify',
          body: {},
          expectedActor,
          deadlineMs: 110_000,
          schema,
        }),
      ).resolves.toEqual({ ok: false, error: 'deadline_exceeded' });
      expect(reads).toBeGreaterThanOrEqual(4);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      state.tokenReadHook = null;
      now.mockRestore();
    }
  });

  it('resolves a verified private actor without exposing the bearer', async () => {
    await expect(getPrivateExpectedActor()).resolves.toEqual({ ok: true, data: expectedActor });
  });

  it('refuses a session change during actor verification', async () => {
    state.verificationHook = async () => {
      state.token = token('session-b');
    };
    try {
      await expect(getPrivateExpectedActor()).resolves.toEqual({
        ok: false,
        error: 'identity_changed',
      });
    } finally {
      state.verificationHook = null;
      state.token = token('session-a');
    }
  });

  it('bounds a stalled actor verification without leaking its failure', async () => {
    state.verificationHook = () => new Promise(() => {});
    try {
      await expect(getPrivateExpectedActor(Date.now() + 20)).resolves.toEqual({
        ok: false,
        error: 'deadline_exceeded',
      });
    } finally {
      state.verificationHook = null;
    }
  });

  it('returns oversize refusal even when response cancellation never settles', async () => {
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(4097));
      },
      cancel,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(stream, noStore)),
    );
    await expect(
      privatePost({
        path: '/browser-manager/local/verify',
        body: {},
        expectedActor,
        deadlineMs: Date.now() + 100,
        schema,
      }),
    ).resolves.toEqual({ ok: false, error: 'response_too_large' });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('bounds a stalled response body and cancels its reader', async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ cancel });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(stream, noStore)),
    );
    await expect(
      privatePost({
        path: '/browser-manager/local/verify',
        body: {},
        expectedActor,
        deadlineMs: Date.now() + 20,
        schema,
      }),
    ).resolves.toEqual({ ok: false, error: 'deadline_exceeded' });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each(['no-storehouse', 'x-no-store=1', 'no-store=1', 'custom="x,no-store,y"'])(
    'refuses non-directive cache header %s',
    async (cacheControl) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(
          async () =>
            new Response('{"status":"accepted","challenge_id":"c"}', {
              headers: { 'cache-control': cacheControl },
            }),
        ),
      );
      await expect(
        privatePost({
          path: '/browser-manager/local/verify',
          body: {},
          expectedActor,
          deadlineMs: Date.now() + 10_000,
          schema,
        }),
      ).resolves.toEqual({ ok: false, error: 'invalid_response' });
    },
  );

  it('recognizes a real no-store directive among quoted cache extensions', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('{"status":"accepted","challenge_id":"c"}', {
            headers: { 'cache-control': 'custom="one,two", No-StOrE, max-age=0' },
          }),
      ),
    );
    await expect(
      privatePost({
        path: '/browser-manager/local/verify',
        body: {},
        expectedActor,
        deadlineMs: Date.now() + 10_000,
        schema,
      }),
    ).resolves.toEqual({ ok: true, data: { status: 'accepted', challenge_id: 'c' } });
  });

  it.each(['created', 'cancelled', 'failed'] as const)(
    'accepts only the submitted admission receipt status %s',
    async (submitted) => {
      for (const returned of ['created', 'cancelled', 'failed'] as const) {
        const response = {
          status: 'accepted',
          operation: 'admit',
          receipt: { admission_id: admissionId, status: returned },
          lease_expires_at_ms: null,
        };
        vi.stubGlobal(
          'fetch',
          vi.fn(async () => new Response(JSON.stringify(response), noStore)),
        );
        const result = await acknowledgeLocalBrowser({
          grant: 'grant',
          operation: 'admit',
          receipt: { admission_id: admissionId, status: submitted },
          expectedActor,
          deadlineMs: Date.now() + 10_000,
        });
        expect(result).toEqual(
          submitted === returned
            ? { ok: true, data: response }
            : { ok: false, error: 'invalid_response' },
        );
      }
    },
  );

  it.each(['closed', 'already_absent', 'unconfirmed'] as const)(
    'accepts only the submitted cleanup receipt status %s',
    async (submitted) => {
      for (const returned of ['closed', 'already_absent', 'unconfirmed'] as const) {
        const response = {
          status: 'accepted',
          operation: 'cleanup',
          receipt: { stop_id: stopId, status: returned },
        };
        vi.stubGlobal(
          'fetch',
          vi.fn(async () => new Response(JSON.stringify(response), noStore)),
        );
        const result = await acknowledgeLocalBrowser({
          grant: 'grant',
          operation: 'cleanup',
          receipt: { stop_id: stopId, status: submitted },
          expectedActor,
          deadlineMs: Date.now() + 10_000,
        });
        expect(result).toEqual(
          submitted === returned
            ? { ok: true, data: response }
            : { ok: false, error: 'invalid_response' },
        );
      }
    },
  );

  it.each(['cancelled', 'failed'] as const)(
    'refuses a live lease for %s admission',
    async (status) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                status: 'accepted',
                operation: 'admit',
                receipt: { admission_id: admissionId, status },
                lease_expires_at_ms: Date.now() + 30_000,
              }),
              noStore,
            ),
        ),
      );
      await expect(
        acknowledgeLocalBrowser({
          grant: 'grant',
          operation: 'admit',
          receipt: { admission_id: admissionId, status },
          expectedActor,
          deadlineMs: Date.now() + 10_000,
        }),
      ).resolves.toEqual({ ok: false, error: 'invalid_response' });
    },
  );

  it.each(['cancelled', 'failed'] as const)(
    'rejects a cancelled directive after a %s admission submission',
    async (submitted) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                status: 'cancelled',
                operation: 'admit',
                receipt: { admission_id: admissionId, status: 'cancelled' },
                lease_expires_at_ms: null,
              }),
              noStore,
            ),
        ),
      );
      await expect(
        acknowledgeLocalBrowser({
          grant: 'grant',
          operation: 'admit',
          receipt: { admission_id: admissionId, status: submitted },
          expectedActor,
          deadlineMs: Date.now() + 10_000,
        }),
      ).resolves.toEqual({ ok: false, error: 'invalid_response' });
    },
  );

  it('serializes the closed verify body and uses sealed fetch controls', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          `{"status":"accepted","admission_id":"${admissionId}","deadline_ms":42}`,
          noStore,
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      verifyLocalBrowser({
        grant: 'grant',
        proof: { operation: 'admit', admission_id: admissionId },
        expectedActor,
        deadlineMs: Date.now() + 10_000,
      }),
    ).resolves.toEqual({
      ok: true,
      data: { status: 'accepted', admission_id: admissionId, deadline_ms: 42 },
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://private.example/browser-manager/local/verify');
    expect(init.redirect).toBe('error');
    expect(init.cache).toBe('no-store');
    expect(init.body).toBe(
      `{"grant":"grant","proof":{"operation":"admit","admission_id":"${admissionId}"}}`,
    );
  });

  it('never reflects an oversized or malformed private response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('x'.repeat(4097), noStore)),
    );
    await expect(
      privatePost({
        path: '/browser-manager/local/verify',
        body: {},
        expectedActor,
        deadlineMs: Date.now() + 10_000,
        schema,
      }),
    ).resolves.toEqual({ ok: false, error: 'response_too_large' });
    expect(parseStrictPrivateJson('{"a":1,"a":2}')).toBeNull();
    expect(parseStrictPrivateJson('{"a":"\\ud800"}')).toBeNull();
    expect(parseStrictPrivateJson('{"a":1e999}')).toBeNull();
  });

  it('refuses a same-user session replacement after fetch', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        state.token = token('session-b');
        return new Response('{"status":"accepted","challenge_id":"c"}', noStore);
      }),
    );
    await expect(
      privatePost({
        path: '/browser-manager/local/verify',
        body: {},
        expectedActor,
        deadlineMs: Date.now() + 10_000,
        schema,
      }),
    ).resolves.toEqual({ ok: false, error: 'identity_changed' });
    state.token = token('session-a');
  });

  it('refuses a private response that omits no-store', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"status":"accepted","challenge_id":"c"}')),
    );
    await expect(
      privatePost({
        path: '/browser-manager/local/verify',
        body: {},
        expectedActor,
        deadlineMs: Date.now() + 10_000,
        schema,
      }),
    ).resolves.toEqual({ ok: false, error: 'invalid_response' });
  });

  it('rejects a discovery envelope for admission and malformed proof before fetch', async () => {
    const fetchMock = vi.fn(
      async () => new Response('{"status":"accepted","challenge_id":"x"}', noStore),
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      verifyLocalBrowser({
        grant: 'grant',
        proof: { operation: 'admit', admission_id: admissionId },
        expectedActor,
        deadlineMs: Date.now() + 10_000,
      }),
    ).resolves.toEqual({ ok: false, error: 'invalid_response' });
    await expect(
      verifyLocalBrowser({
        grant: 'grant',
        proof: { operation: 'cleanup', stop_id: 'not-a-uuid', admission_id: admissionId } as never,
        expectedActor,
        deadlineMs: Date.now() + 10_000,
      }),
    ).resolves.toEqual({ ok: false, error: 'invalid_response' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      {
        operation: 'discover',
        extension_generation: '00000000-0000-4000-8000-000000000005',
        connection_id: '00000000-0000-4000-8000-000000000006',
      },
      { status: 'accepted', challenge_id: '00000000-0000-4000-8000-000000000007' },
    ],
    [
      {
        operation: 'renew',
        renewal_id: '00000000-0000-4000-8000-000000000008',
        admission_id: admissionId,
      },
      { status: 'accepted', renewal_id: '00000000-0000-4000-8000-000000000008', expires_at_ms: 99 },
    ],
    [
      { operation: 'cleanup', stop_id: stopId, admission_id: admissionId },
      { status: 'accepted', stop_id: stopId },
    ],
  ] as const)(
    'accepts only the operation-specific verify envelope for %s',
    async (proof, response) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(JSON.stringify(response), noStore)),
      );
      await expect(
        verifyLocalBrowser({
          grant: 'grant',
          proof,
          expectedActor,
          deadlineMs: Date.now() + 10_000,
        }),
      ).resolves.toEqual({ ok: true, data: response });
    },
  );

  it('refuses an accepted lifecycle reply whose bound identifier differs from the proof', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            '{"status":"accepted","stop_id":"00000000-0000-4000-8000-000000000009"}',
            noStore,
          ),
      ),
    );
    await expect(
      verifyLocalBrowser({
        grant: 'grant',
        proof: { operation: 'cleanup', stop_id: stopId, admission_id: admissionId },
        expectedActor,
        deadlineMs: Date.now() + 10_000,
      }),
    ).resolves.toEqual({ ok: false, error: 'invalid_response' });
  });

  it('binds acknowledgement receipts and accepts a created receipt with null lease after stop', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            `{"status":"accepted","operation":"admit","receipt":{"admission_id":"${admissionId}","status":"created"},"lease_expires_at_ms":null}`,
            noStore,
          ),
      ),
    );
    const accepted = await acknowledgeLocalBrowser({
      grant: 'grant',
      operation: 'admit',
      receipt: { admission_id: admissionId, status: 'created' },
      expectedActor,
      deadlineMs: Date.now() + 10_000,
    });
    expect(accepted).toEqual({
      ok: true,
      data: {
        status: 'accepted',
        operation: 'admit',
        receipt: { admission_id: admissionId, status: 'created' },
        lease_expires_at_ms: null,
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            `{"status":"accepted","operation":"cleanup","receipt":{"stop_id":"${stopId}","status":"closed"}}`,
            noStore,
          ),
      ),
    );
    await expect(
      acknowledgeLocalBrowser({
        grant: 'grant',
        operation: 'cleanup',
        receipt: { stop_id: admissionId, status: 'closed' },
        expectedActor,
        deadlineMs: Date.now() + 10_000,
      }),
    ).resolves.toEqual({ ok: false, error: 'invalid_response' });
  });
});
