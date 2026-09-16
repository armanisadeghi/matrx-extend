/**
 * The Vault panel calls credential_login directly with its captured tab id.
 * A closed captured tab must not drift to the browser's current tab before
 * the handler asks the Vault which login to use or decrypts anything.
 */
import type { ToolContext } from '@/lib/tools/types';
import { afterEach, describe, expect, it, vi } from 'vitest';

const postCalls: Array<{ path: string; body: unknown }> = [];

vi.mock('@/lib/auth/flow', () => ({
  getAccessToken: async () => 'real-user-jwt',
  getCurrentUser: async () => ({ id: 'user-1' }),
  refreshAccessToken: async () => null,
}));

vi.mock('@/lib/org/active-org', () => ({
  getActiveOrganizationId: async () => 'org-1',
}));

vi.mock('@/lib/debug/log', () => ({
  log: { info: vi.fn(), success: vi.fn(), warn: vi.fn(), error: vi.fn() },
  captureError: (error: unknown) => ({ message: String(error) }),
}));

vi.mock('@/lib/api/client', () => ({
  STATUS_INVALID_BODY: -1,
  apiPost: async (path: string, body: unknown) => {
    postCalls.push({ path, body });
    return { ok: false, status: 500, error: 'must not reach Vault for a closed assigned tab' };
  },
  apiGet: async () => ({ ok: false, status: 500, error: 'unmocked' }),
  apiPatch: async () => ({ ok: false, status: 500, error: 'unmocked' }),
  apiPut: async () => ({ ok: false, status: 500, error: 'unmocked' }),
  apiDelete: async () => ({ ok: false, status: 500, error: 'unmocked' }),
}));

const panelContext: ToolContext = {
  conversationId: null,
  runId: 'vault-panel',
  callId: 'vault-panel-test',
  agentName: null,
  permissionMode: 'act',
  assignedTabId: 7,
};

afterEach(() => {
  postCalls.length = 0;
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('credential_login from the Vault panel', () => {
  it('refuses a closed assigned tab before any active-tab fallback, match, or materialization', async () => {
    const activeTabQuery = vi.fn(async () => [{ id: 99, url: 'https://unrelated.example/login' }]);
    vi.stubGlobal('chrome', {
      tabs: {
        get: vi.fn(async () => {
          throw new Error('No tab with id: 7');
        }),
        query: activeTabQuery,
      },
    });

    const { credential_login } = await import('@/lib/tools/handlers/credential-login');
    const result = await credential_login.run(
      { action: 'auto', credential_item_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' },
      panelContext,
    );

    expect(result).toMatchObject({ status: 'unknown', reason: 'no_active_tab' });
    expect(activeTabQuery).not.toHaveBeenCalled();
    expect(postCalls).toEqual([]);
  });
});
