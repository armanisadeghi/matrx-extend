import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({ info: [] as string[], error: [] as string[] }));

vi.mock('@/lib/debug/log', () => ({
  log: {
    info: (_source: string, message: string) => calls.info.push(message),
    error: (_source: string, message: string) => calls.error.push(message),
    warn: vi.fn(),
  },
}));

import { reportCatalogError } from '@/lib/agents/catalog';
import { useAuthStore } from '@/state/auth';

describe('agent catalog error classification', () => {
  beforeEach(() => {
    calls.info.length = 0;
    calls.error.length = 0;
    useAuthStore.setState({ user: null, status: 'unknown' });
  });

  it('does not classify the expected pre-hydration guest identity as an error', () => {
    reportCatalogError({
      code: 'identity_unavailable',
      message: 'identity.requireUserId() threw',
      context: { detail: 'no signed-in user' },
    });

    expect(calls.info).toEqual(['[agent-catalog] identity pending during auth hydration']);
    expect(calls.error).toEqual([]);
  });

  it('keeps an identity failure loud after the session is known to be signed in', () => {
    useAuthStore.setState({
      user: { id: 'user-1', email: 'a@example.com', full_name: null },
      status: 'signed-in',
    });
    reportCatalogError({
      code: 'identity_unavailable',
      message: 'identity.requireUserId() threw',
      context: { detail: 'unexpected' },
    });

    expect(calls.info).toEqual([]);
    expect(calls.error).toEqual([
      '[agent-catalog] identity_unavailable: identity.requireUserId() threw',
    ]);
  });
});
