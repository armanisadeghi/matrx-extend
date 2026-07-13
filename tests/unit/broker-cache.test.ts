/**
 * Unit tests for the token-broker credential cache (src/lib/broker/cache.ts)
 * and the mode-dispatch transport (src/lib/broker/transport.ts).
 *
 * Covers the client-side invariants from the cross-repo contract
 * (common-docs/token-broker/FEATURE.md):
 *   - cache keyed on (audience, tier_policy, model)
 *   - refresh-ahead: re-mint when < ~20% of TTL remains
 *   - single-flight: concurrent callers share one mint
 *   - invalidate → next call re-mints
 *   - forceFresh bypasses the cache
 *   - transports refuse the wrong credential_mode
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mintCredentialMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/broker/mint', () => ({ mintCredential: mintCredentialMock }));

import {
  clearCredentialCache,
  getCredentialCached,
  invalidateCredential,
  snapshotCredentialCache,
} from '@/lib/broker/cache';
import { brokeredFetch, nativeConnectionInfo } from '@/lib/broker/transport';
import type { BrokeredCredential, TierPolicy } from '@/lib/broker/types';

function makeCredential(overrides: Partial<BrokeredCredential> = {}): BrokeredCredential {
  const nowSec = Math.floor(Date.now() / 1000);
  return {
    credential_mode: 'proxied',
    audience: 'anthropic',
    token: `tok-${Math.floor(Date.now())}`,
    expires_at: nowSec + 600,
    endpoint: 'https://server.example.com/api/broker/gateway/anthropic/v1/messages',
    protocol: 'anthropic_messages',
    model: null,
    grant: {
      user_id: 'user-1',
      audience: 'anthropic',
      tier_policy: 'none' as TierPolicy,
      scopes: [],
      expires_at: nowSec + 600,
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-12T00:00:00Z'));
  clearCredentialCache();
  mintCredentialMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('broker credential cache', () => {
  it('mints once and serves from cache while fresh', async () => {
    mintCredentialMock.mockResolvedValue({ ok: true, data: makeCredential() });
    const a = await getCredentialCached('anthropic', 'none');
    const b = await getCredentialCached('anthropic', 'none');
    expect(a.ok && b.ok).toBe(true);
    expect(mintCredentialMock).toHaveBeenCalledTimes(1);
  });

  it('keys the cache on (audience, tier_policy, model)', async () => {
    mintCredentialMock.mockResolvedValue({ ok: true, data: makeCredential() });
    await getCredentialCached('anthropic', 'none');
    await getCredentialCached('anthropic', 'guest');
    await getCredentialCached('anthropic', 'none', { model: 'claude-haiku-4-5-20251001' });
    await getCredentialCached('openai_realtime', 'none');
    expect(mintCredentialMock).toHaveBeenCalledTimes(4);
  });

  it('re-mints when less than 20% of TTL remains (refresh-ahead)', async () => {
    mintCredentialMock.mockImplementation(async () => ({ ok: true, data: makeCredential() }));
    await getCredentialCached('anthropic', 'none');
    // 500s into a 600s TTL → 100s remaining < 120s (20%) → refresh.
    vi.advanceTimersByTime(500_000);
    await getCredentialCached('anthropic', 'none');
    expect(mintCredentialMock).toHaveBeenCalledTimes(2);
  });

  it('does NOT re-mint while more than 20% of TTL remains', async () => {
    mintCredentialMock.mockImplementation(async () => ({ ok: true, data: makeCredential() }));
    await getCredentialCached('anthropic', 'none');
    vi.advanceTimersByTime(400_000); // 200s remaining > 120s threshold
    await getCredentialCached('anthropic', 'none');
    expect(mintCredentialMock).toHaveBeenCalledTimes(1);
  });

  it('single-flights concurrent callers for the same key', async () => {
    let resolveMint: (v: unknown) => void = () => {};
    mintCredentialMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveMint = resolve;
        }),
    );
    const p1 = getCredentialCached('anthropic', 'none');
    const p2 = getCredentialCached('anthropic', 'none');
    resolveMint({ ok: true, data: makeCredential() });
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.ok && r2.ok).toBe(true);
    expect(mintCredentialMock).toHaveBeenCalledTimes(1);
  });

  it('invalidate drops the entry so the next call re-mints', async () => {
    mintCredentialMock.mockResolvedValue({ ok: true, data: makeCredential() });
    await getCredentialCached('anthropic', 'none');
    invalidateCredential('anthropic', 'none');
    await getCredentialCached('anthropic', 'none');
    expect(mintCredentialMock).toHaveBeenCalledTimes(2);
  });

  it('forceFresh bypasses a fresh cache entry', async () => {
    mintCredentialMock.mockResolvedValue({ ok: true, data: makeCredential() });
    await getCredentialCached('anthropic', 'none');
    await getCredentialCached('anthropic', 'none', { forceFresh: true });
    expect(mintCredentialMock).toHaveBeenCalledTimes(2);
  });

  it('does not cache failures', async () => {
    mintCredentialMock.mockResolvedValueOnce({ ok: false, status: 503, error: 'unconfigured' });
    mintCredentialMock.mockResolvedValueOnce({ ok: true, data: makeCredential() });
    const first = await getCredentialCached('anthropic', 'none');
    expect(first.ok).toBe(false);
    const second = await getCredentialCached('anthropic', 'none');
    expect(second.ok).toBe(true);
    expect(mintCredentialMock).toHaveBeenCalledTimes(2);
  });

  it('snapshot is token-free (only a 6-char tail)', async () => {
    mintCredentialMock.mockResolvedValue({
      ok: true,
      data: makeCredential({ token: 'super-secret-token-abcdef' }),
    });
    await getCredentialCached('anthropic', 'none');
    const snap = snapshotCredentialCache();
    expect(snap).toHaveLength(1);
    expect(snap[0]?.tokenTail).toBe('abcdef');
    expect(JSON.stringify(snap)).not.toContain('super-secret-token');
  });
});

describe('transport mode dispatch', () => {
  it('nativeConnectionInfo refuses a proxied credential', () => {
    expect(() => nativeConnectionInfo(makeCredential())).toThrow(/proxied/);
  });

  it('brokeredFetch refuses a native credential', async () => {
    const native = makeCredential({ credential_mode: 'native_ephemeral' });
    await expect(brokeredFetch(native, { body: {} })).rejects.toThrow(/native_ephemeral/);
  });

  it('brokeredFetch hits the credential endpoint with the Bearer grant', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const cred = makeCredential();
    await brokeredFetch(cred, { body: { model: 'm' } });
    expect(fetchMock).toHaveBeenCalledWith(
      cred.endpoint,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: `Bearer ${cred.token}` }),
      }),
    );
    vi.unstubAllGlobals();
  });

  it('nativeConnectionInfo returns endpoint/token/protocol for native credentials', () => {
    const native = makeCredential({
      credential_mode: 'native_ephemeral',
      audience: 'openai_realtime',
      protocol: 'openai_realtime',
      model: 'gpt-realtime',
    });
    const info = nativeConnectionInfo(native);
    expect(info).toEqual({
      endpoint: native.endpoint,
      token: native.token,
      protocol: 'openai_realtime',
      model: 'gpt-realtime',
      expiresAt: native.expires_at,
    });
  });
});
