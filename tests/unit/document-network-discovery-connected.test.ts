import { afterEach, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  approvals: new Map<string, Array<(payload: any) => unknown>>(),
  broadcast: vi.fn(),
  acquire: vi.fn(),
  send: vi.fn(),
  release: vi.fn(),
  url: 'https://calendar.invalid/current-route',
  documentId: 'approved-document',
}));
vi.mock('@/lib/cdp/client', () => ({ acquireSession: (...args: unknown[]) => h.acquire(...args) }));
vi.mock('@/lib/messaging/native', () => ({
  on: (kind: string, callback: (payload: any) => unknown) => {
    const list = h.approvals.get(kind) ?? [];
    list.push(callback);
    h.approvals.set(kind, list);
    return () => h.approvals.set(kind, list.filter((item) => item !== callback));
  },
  broadcast: (kind: string, payload: unknown) => {
    h.broadcast(kind, payload);
    for (const callback of h.approvals.get(kind) ?? []) callback(payload);
  },
  send: vi.fn(),
}));
vi.mock('@/lib/tools/registry', () => ({
  lookup: (name: string) => name === 'cdp_attach' ? {
    name: 'cdp_attach',
    tier: 'privileged',
    admin_only: true,
    required_optional_permissions: ['debugger'],
    supportedBrowsers: ['chrome'],
    argsSchema: { parse: (value: unknown) => value },
  } : undefined,
  allToolNames: () => ['cdp_attach'],
}));
vi.mock('@/lib/auth/is-admin', () => ({ readIsAdminFromStorage: async () => true }));
vi.mock('@/lib/permissions/optional', () => ({
  hasOptionalPermissions: async () => true,
  missingPermissionRemedy: () => 'Enable debugger permission',
}));
vi.mock('@/state/pilot', () => ({
  getPilotSessionSnapshotAsync: async () => ({ active: false, groupId: -1 }),
}));
vi.mock('@/lib/tools/descriptions', () => ({
  primeToolDescriptions: vi.fn(), getToolDescription: () => 'Debugger capability',
}));
vi.mock('@/lib/audit/log', () => ({ appendReceipt: vi.fn(), recordAuditFailure: vi.fn() }));
vi.mock('@/lib/audit/receipt', () => ({ PENDING_OUTPUT: {}, buildReceipt: vi.fn(async () => ({})) }));
vi.mock('@/lib/api/routes/tool-results', () => ({ postToolResults: vi.fn() }));
vi.mock('@/lib/recording/state', () => ({ recordToolEvent: vi.fn() }));

import { openNetworkPageLoadDiscovery, registerDocumentNetworkCaptureHost } from '@/lib/data-pattern/document-network-transport';
import { CHANNELS } from '@/lib/messaging/schemas';
import { runLocalNetworkDiscovery, startToolDispatcher } from '@/lib/tools/dispatch';

afterEach(() => {
  h.approvals.clear();
  vi.clearAllMocks();
});

it('approved Port discovery delivers only the new document first response through the real capture core', async () => {
  const connectionListeners = new Set<(port: chrome.runtime.Port) => void>();
  const cdpEvents = new Set<(source: object, method: string, params: object) => void>();
  const cdpDetaches = new Set<(source: object) => void>();
  const emit = (method: string, params: object) => {
    for (const listener of cdpEvents) listener({ tabId: 37 }, method, params);
  };
  const context = (id: number, uniqueId: string) => emit('Runtime.executionContextCreated', {
    context: { id, uniqueId, auxData: { frameId: 'main', isDefault: true } },
  });
  let binding = '';
  const packet = (contextId: number, body: string, bodyKey: string, sequence: number) =>
    emit('Runtime.bindingCalled', {
      name: binding,
      executionContextId: contextId,
      payload: JSON.stringify({
        source: 'fetch', url: 'https://calendar.invalid/api/events', method: 'POST',
        body, request_body_key: bodyKey, request_sequence: sequence,
        status: 200, ts_ms: sequence, body_size: body.length, body_truncated: false,
        request_headers: { authorization: 'must-not-leave-core' },
      }),
    });
  h.acquire.mockResolvedValue({ send: h.send, release: h.release });
  h.release.mockResolvedValue(undefined);
  h.send.mockImplementation(async (method: string, params: any) => {
    if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'main', url: h.url } } };
    if (method === 'Runtime.enable') context(1, 'prior-document');
    if (method === 'Runtime.addBinding') binding = params.name;
    if (method === 'Page.addScriptToEvaluateOnNewDocument') return { identifier: 'script' };
    if (method === 'Page.reload') {
      context(2, 'reloaded-document');
      packet(1, '[{"title":"Wrong old page"}]', 'sha256:' + '1'.repeat(64), 999);
      packet(2, '[{"title":"Opening night"}]', 'sha256:' + '2'.repeat(64), 1);
      emit('Page.frameNavigated', { frame: { id: 'main', url: h.url } });
      emit('Runtime.bindingCalled', {
        name: binding, executionContextId: 2,
        payload: JSON.stringify({ __matrx_capture_hook: 'network-tap', nonce: 'a'.repeat(32) }),
      });
    }
    return {};
  });
  let stored: Record<string, unknown> = {};
  Object.assign(chrome.storage, { session: {
    get: async () => structuredClone(stored),
    set: async (value: object) => { stored = { ...stored, ...structuredClone(value) }; },
  } });
  Object.assign(chrome, {
    tabs: {
      query: async () => [{ id: 37, url: h.url }],
      get: async () => ({ id: 37, url: h.url }),
    },
    scripting: { executeScript: async (details: { args?: unknown[] }) => [{
      documentId: details.args?.length === 2 ? 'reloaded-document-id' : h.documentId,
      result: details.args?.length === 2 ? true : null,
    }] },
    debugger: {
      sendCommand: vi.fn(),
      onEvent: {
        addListener: (fn: typeof cdpEvents extends Set<infer T> ? T : never) => cdpEvents.add(fn),
        removeListener: (fn: typeof cdpEvents extends Set<infer T> ? T : never) => cdpEvents.delete(fn),
      },
      onDetach: {
        addListener: (fn: typeof cdpDetaches extends Set<infer T> ? T : never) => cdpDetaches.add(fn),
        removeListener: (fn: typeof cdpDetaches extends Set<infer T> ? T : never) => cdpDetaches.delete(fn),
      },
    },
    runtime: {
      id: 'extension',
      onConnect: { addListener: (fn: (port: chrome.runtime.Port) => void) => connectionListeners.add(fn) },
      connect: () => {
        const clientMessages = new Set<(value: any) => void>();
        const serverMessages = new Set<(value: any) => void>();
        const disconnects = new Set<() => void>();
        let closed = false;
        const disconnect = () => {
          if (closed) return;
          closed = true;
          for (const fn of disconnects) fn();
        };
        const endpoint = (incoming: Set<(value: any) => void>, outgoing: Set<(value: any) => void>) => ({
          postMessage: (value: any) => { for (const fn of outgoing) fn(value); },
          disconnect,
          onMessage: { addListener: (fn: (value: any) => void) => incoming.add(fn) },
          onDisconnect: { addListener: (fn: () => void) => disconnects.add(fn) },
        });
        const client = endpoint(clientMessages, serverMessages);
        const server = { ...endpoint(serverMessages, clientMessages),
          name: 'matrx:document-network-capture', sender: { id: 'extension' } };
        for (const fn of connectionListeners) fn(server as unknown as chrome.runtime.Port);
        return client;
      },
    },
  });
  startToolDispatcher({ defaultPermissionMode: () => 'act' });
  registerDocumentNetworkCaptureHost(async () => ({}), runLocalNetworkDiscovery);
  const controller = new AbortController();
  const seen: unknown[] = [];
  const result = openNetworkPageLoadDiscovery(37, {
    signal: controller.signal,
    onEvent: (event) => { seen.push(event); controller.abort(); },
  });
  const rejected = expect(result).rejects.toThrow(/cancelled/);
  await vi.waitFor(() => expect(h.broadcast.mock.calls.some(([kind]) =>
    kind === CHANNELS.TOOL_CONFIRM_REQUEST)).toBe(true));
  expect(h.acquire).not.toHaveBeenCalled();
  const request = h.broadcast.mock.calls.find(([kind]) => kind === CHANNELS.TOOL_CONFIRM_REQUEST)![1];
  for (const listener of h.approvals.get(CHANNELS.TOOL_CONFIRM_RESPONSE) ?? [])
    listener({ callId: request.callId, decision: 'allow' });
  await vi.waitFor(() => expect(seen).toHaveLength(1));
  await rejected;
  expect(seen[0]).toMatchObject({
    body: '[{"title":"Opening night"}]',
    document_key: 'reloaded-document',
    request_body_key: 'sha256:' + '2'.repeat(64),
  });
  expect(seen[0]).not.toHaveProperty('request_headers');
  expect(h.release).toHaveBeenCalled();
});
