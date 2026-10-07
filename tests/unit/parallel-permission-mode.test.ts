import { CHANNELS } from '@/lib/messaging/schemas';
import { loadRunMeta } from '@/lib/tools/dispatch-persist';
import type { ToolContext } from '@/lib/tools/types';
import { beforeEach, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  handlers: new Map<string, Array<(payload: any) => unknown>>(),
  send: vi.fn(),
}));
vi.mock('@/lib/messaging/native', () => ({
  on: (channel: string, handler: (payload: any) => unknown) => {
    const list = h.handlers.get(channel) ?? [];
    list.push(handler);
    h.handlers.set(channel, list);
    return () =>
      h.handlers.set(
        channel,
        (h.handlers.get(channel) ?? []).filter((fn) => fn !== handler),
      );
  },
  broadcast: vi.fn(),
  send: (...args: unknown[]) => h.send(...args),
}));
vi.mock('@/lib/tools/registry', () => ({ lookup: vi.fn(), allToolNames: () => [] }));
vi.mock('@/lib/tools/descriptions', () => ({
  primeToolDescriptions: vi.fn(),
  getToolDescription: vi.fn(),
}));
vi.mock('@/lib/audit/log', () => ({ appendReceipt: vi.fn(), recordAuditFailure: vi.fn() }));
vi.mock('@/lib/audit/receipt', () => ({ PENDING_OUTPUT: {}, buildReceipt: vi.fn() }));
vi.mock('@/lib/recording/state', () => ({ recordToolEvent: vi.fn() }));
vi.mock('@/lib/api/client', () => ({
  getApiBaseUrl: async () => 'https://server.app.matrxserver.com',
}));
vi.mock('@/lib/api/routes/auth', () => ({
  requireRequestOrganizationId: async () => 'maintenance-workspace',
}));
vi.mock('@/lib/auth/flow', () => ({ getAccessToken: async () => 'session-token' }));
vi.mock('@/lib/org/active-org', () => ({
  getActiveOrganizationId: async () => 'maintenance-workspace',
}));
vi.mock('@/lib/stream/offscreen-proxy', () => ({ ensureOffscreen: async () => {} }));
vi.mock('@/state/pilot', () => ({
  getPilotSessionSnapshotAsync: async () => ({ active: false, groupId: null }),
}));

beforeEach(() => {
  h.handlers.clear();
  h.send.mockReset();
  let store: Record<string, unknown> = {};
  Object.assign(chrome.storage, {
    session: {
      get: async () => structuredClone(store),
      set: async (value: object) => {
        store = { ...store, ...structuredClone(value) };
      },
    },
  });
  Object.assign(chrome, {
    tabs: {
      get: async (id: number) => ({ id, url: 'https://app.notion.com/maintenance', windowId: 2 }),
    },
    runtime: { id: 'maintenance-extension', getManifest: () => ({ version: '0.2.1' }) },
  });
});

// A property manager fans out maintenance work. Before STREAM_OPENED can
// arrive, the actual dispatcher metadata must already carry the parent's mode.
it.each(['act', 'ask'] as const)(
  'seeds child %s permission before stream dispatch',
  async (permissionMode) => {
    const { parallel_for_each_tab } = await import('@/lib/tools/handlers/parallel');
    const observed: string[] = [];
    h.send.mockImplementation(async (channel, payload) => {
      if (channel !== CHANNELS.STREAM_RUN) return;
      await vi.waitFor(async () => {
        const meta = await loadRunMeta(payload.runId);
        expect(meta?.permissionMode).toBe(permissionMode);
        expect(meta?.assignedTabId).toBe(47);
        expect(meta?.agentName).toBe('parallel-sub-run');
      });
      expect(payload.permissionMode).toBe(permissionMode);
      expect(payload.body.client.state['browser-dom'].permission_mode).toBe(permissionMode);
      observed.push(payload.runId);
      for (const handler of h.handlers.get(CHANNELS.STREAM_CHUNK) ?? []) {
        await handler({ runId: payload.runId, type: 'done', payload: {} });
      }
    });
    const ctx: ToolContext = {
      runId: `maintenance-parent-${permissionMode}`,
      callId: `maintenance-fanout-${permissionMode}`,
      conversationId: 'maintenance-conversation',
      agentName: 'Maintenance coordinator',
      permissionMode,
      assignedTabId: 47,
    };
    const result = await parallel_for_each_tab.run(
      {
        tab_ids: [47],
        sub_prompt: 'Review pending maintenance requests',
        agent_id: 'maintenance-agent',
        timeout_ms: 1000,
        merge_strategy: 'per_tab',
      },
      ctx,
    );
    expect(observed).toHaveLength(1);
    expect(result).toMatchObject({ ok: true, summary: { completed: 1, errored: 0, timed_out: 0 } });
  },
);
