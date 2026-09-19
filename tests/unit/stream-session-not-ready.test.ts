import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A stream is a request too (2026-09-19, sibling of the REST guest-downgrade
 * defect): a signed-in install whose bearer is not readable yet must never
 * START a run as a guest fingerprint — it is refused, loudly, before the
 * offscreen document is even touched.
 */

const state = vi.hoisted(() => ({
  bearer: null as string | null,
  refuse: false,
  sent: [] as Array<{ channel: string; payload: unknown }>,
}));

class SessionNotReadyError extends Error {
  remedy = 'Wait a moment and try again.';
}

vi.mock('@/lib/api/client', () => ({
  getApiBaseUrl: async () => 'https://example.invalid',
  readSessionBearer: async () => {
    if (state.refuse) throw new SessionNotReadyError('session not ready');
    return state.bearer;
  },
  SessionNotReadyError,
}));
vi.mock('@/lib/auth/guest-signature', () => ({ getOrCreateGuestSignature: async () => 'guest' }));
vi.mock('@/lib/org/active-org', () => ({
  requireActiveOrganizationId: async () => '00000000-0000-4000-8000-000000000002',
}));
vi.mock('@/lib/debug/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
}));
vi.mock('@/lib/messaging/native', () => ({
  send: async (channel: string, payload: unknown) => {
    state.sent.push({ channel, payload });
    return { ok: true };
  },
}));
vi.mock('@/lib/stream/active-runs', () => ({
  markStreamActive: vi.fn(),
  markStreamInactive: vi.fn(),
}));

describe('startStream never starts a signed-in run as a guest', () => {
  beforeEach(() => {
    state.bearer = null;
    state.refuse = false;
    state.sent = [];
    vi.stubGlobal('chrome', {
      runtime: { getContexts: vi.fn(async () => [{ contextType: 'OFFSCREEN_DOCUMENT' }]) },
      offscreen: { createDocument: vi.fn(async () => {}) },
    });
  });

  it('refuses before touching the offscreen document when the session is not ready', async () => {
    state.refuse = true;
    const { startStream } = await import('@/lib/stream/offscreen-proxy');
    await expect(
      startStream({
        runId: 'r1',
        endpoint: '/v2/ai/mandates/extend.browser_chat',
        parser: 'rich-events',
      }),
    ).rejects.toBeInstanceOf(SessionNotReadyError);
    expect(state.sent).toHaveLength(0);
  });

  it('sends the bearer and organization when signed in', async () => {
    state.bearer = 'token-a';
    const { startStream } = await import('@/lib/stream/offscreen-proxy');
    await startStream({ runId: 'r2', endpoint: '/x', parser: 'rich-events' });
    const run = state.sent.find((m) => m.channel !== undefined);
    const headers = (run?.payload as { headers: Record<string, string> }).headers;
    expect(headers.Authorization).toBe('Bearer token-a');
    expect(headers['X-Fingerprint-ID']).toBeUndefined();
  });

  it('uses the guest fingerprint only when nobody is signed in', async () => {
    const { startStream } = await import('@/lib/stream/offscreen-proxy');
    await startStream({ runId: 'r3', endpoint: '/x', parser: 'rich-events' });
    const headers = (state.sent[0]?.payload as { headers: Record<string, string> }).headers;
    expect(headers['X-Fingerprint-ID']).toBe('guest');
    expect(headers.Authorization).toBeUndefined();
  });
});
