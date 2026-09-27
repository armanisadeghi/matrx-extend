import { beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({
  handlers: new Map<string, Array<(p: any) => unknown>>(),
  broadcasts: vi.fn(),
  run: vi.fn(),
  post: vi.fn(),
  admin: true,
  group: -1,
  document: 'original-document',
  url: 'https://calendar.invalid/calendar',
}));
vi.mock('@/lib/messaging/native', () => ({
  on: (kind: string, fn: (p: any) => unknown) => {
    const list = h.handlers.get(kind) ?? [];
    list.push(fn);
    h.handlers.set(kind, list);
    return () => {
      h.handlers.set(
        kind,
        list.filter((item) => item !== fn),
      );
    };
  },
  broadcast: (...args: unknown[]) => h.broadcasts(...args),
  send: vi.fn(),
}));
vi.mock('@/lib/tools/registry', async () => {
  const { data_patterns } = await import('@/lib/tools/handlers/data-patterns');
  return {
    lookup: (name: string) => (name === 'data_patterns' ? data_patterns : undefined),
    allToolNames: () => ['data_patterns'],
  };
});
vi.mock('@/lib/supabase/queries', () => ({
  PATTERN_KINDS: ['network_capture'],
  fetchPatternsForDomain: async () => [
    {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      kind: 'network_capture',
      name: 'Events',
      config: { url_filter: '/api' },
      fields: [],
      route_pattern: '/calendar',
      list_root_selector: null,
    },
  ],
  bumpPatternRun: vi.fn(),
  savePattern: vi.fn(),
  deletePattern: vi.fn(),
}));
vi.mock('@/lib/data-pattern/run-interactive', () => ({
  runSavedPattern: (...args: unknown[]) => h.run(...args),
  NetworkNoMatchError: class extends Error {},
}));
vi.mock('@/lib/tools/handlers/cdp', () => ({
  cdp_attach: {
    admin_only: true,
    supportedBrowsers: ['chrome'],
    required_optional_permissions: ['debugger'],
  },
}));
vi.mock('@/lib/auth/is-admin', () => ({ readIsAdminFromStorage: async () => h.admin }));
vi.mock('@/lib/permissions/optional', () => ({
  hasOptionalPermissions: async () => true,
  missingPermissionRemedy: () => 'missing debugger permission',
}));
vi.mock('@/state/pilot', () => ({
  getPilotSessionSnapshotAsync: async () => ({ active: h.group !== -1, groupId: h.group }),
}));
vi.mock('@/lib/tools/descriptions', () => ({
  primeToolDescriptions: vi.fn(),
  getToolDescription: () => 'Saved recipe',
}));
vi.mock('@/lib/audit/log', () => ({ appendReceipt: vi.fn(), recordAuditFailure: vi.fn() }));
vi.mock('@/lib/audit/receipt', () => ({
  PENDING_OUTPUT: {},
  buildReceipt: vi.fn(async () => ({})),
}));
vi.mock('@/lib/api/routes/tool-results', () => ({
  postToolResults: (...args: unknown[]) => h.post(...args),
}));
vi.mock('@/lib/recording/state', () => ({ recordToolEvent: vi.fn() }));
import { CHANNELS } from '@/lib/messaging/schemas';
const emit = (kind: string, value: unknown) => {
  for (const fn of [...(h.handlers.get(kind) ?? [])]) fn(value);
};
beforeEach(() => {
  vi.resetModules();
  h.handlers.clear();
  h.broadcasts.mockClear();
  h.run.mockReset().mockResolvedValue([{ event: 'Current' }]);
  h.post.mockReset().mockResolvedValue({ ok: true });
  h.admin = true;
  h.group = -1;
  h.document = 'original-document';
  h.url = 'https://calendar.invalid/calendar';
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
    tabs: { get: vi.fn(async () => ({ id: 37, groupId: 1, url: h.url })) },
    scripting: { executeScript: vi.fn(async () => [{ documentId: h.document, result: null }]) },
  });
});
it('actual local dispatcher waits for TOOL_CONFIRM_RESPONSE then runs the real saved handler', async () => {
  const dispatch = await import('@/lib/tools/dispatch');
  dispatch.startToolDispatcher({ defaultPermissionMode: () => 'act' });
  const result = dispatch.runLocalSavedPattern(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    37,
    new AbortController().signal,
    () => {},
  );
  await vi.waitFor(() =>
    expect(h.broadcasts.mock.calls.some((call) => call[0] === CHANNELS.TOOL_CONFIRM_REQUEST)).toBe(
      true,
    ),
  );
  const request = h.broadcasts.mock.calls.find(
    (call) => call[0] === CHANNELS.TOOL_CONFIRM_REQUEST,
  )![1];
  expect(request.toolName).toBe('data_patterns');
  expect(request.tier).toBe('privileged');
  expect(h.run).not.toHaveBeenCalled();
  emit(CHANNELS.TOOL_CONFIRM_RESPONSE, { callId: request.callId, decision: 'allow' });
  await expect(result).resolves.toMatchObject({ ok: true, rows: [{ event: 'Current' }] });
  expect(h.run).toHaveBeenCalledOnce();
  expect(h.run.mock.calls[0]![1]).toBe(37);
});
it('actual global confirmation recovery executes a persisted data_patterns operation once', async () => {
  const { data_patterns } = await import('@/lib/tools/handlers/data-patterns');
  const ctx = {
    callId: 'recover-call',
    runId: 'recover-run',
    conversationId: 'conversation',
    assignedTabId: 37,
    agentName: 'Agent',
    permissionMode: 'act' as const,
  };
  const args = { action: 'run' as const, pattern_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
  const prepared = await data_patterns.prepare!(args, ctx);
  const { persistPendingConfirm } = await import('@/lib/tools/dispatch-persist');
  await persistPendingConfirm({
    ...ctx,
    toolName: 'data_patterns',
    args,
    initiator: 'agent',
    effectiveTier: 'privileged',
    expiresAt: Date.now() + 1000,
    preparedOperation: { snapshotKey: prepared!.snapshotKey, delivery: 'agent' },
  });
  const dispatch = await import('@/lib/tools/dispatch');
  dispatch.startToolDispatcher({ defaultPermissionMode: () => 'act' });
  emit(CHANNELS.TOOL_CONFIRM_RESPONSE, { callId: ctx.callId, decision: 'allow' });
  emit(CHANNELS.TOOL_CONFIRM_RESPONSE, { callId: ctx.callId, decision: 'allow' });
  await vi.waitFor(() => expect(h.post).toHaveBeenCalled());
  expect(h.run).toHaveBeenCalledOnce();
  expect(
    h.broadcasts.mock.calls.filter((call) => call[0] === CHANNELS.TOOL_CONFIRM_REQUEST),
  ).toHaveLength(0);
});
it('real denial response cannot start capture', async () => {
  const dispatch = await import('@/lib/tools/dispatch');
  dispatch.startToolDispatcher({ defaultPermissionMode: () => 'act' });
  const result = dispatch.runLocalSavedPattern(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    37,
    new AbortController().signal,
    () => {},
  );
  const rejected = expect(result).rejects.toThrow('denied');
  await vi.waitFor(() =>
    expect(h.broadcasts.mock.calls.some((call) => call[0] === CHANNELS.TOOL_CONFIRM_REQUEST)).toBe(
      true,
    ),
  );
  const request = h.broadcasts.mock.calls.find(
    (call) => call[0] === CHANNELS.TOOL_CONFIRM_REQUEST,
  )![1];
  emit(CHANNELS.TOOL_CONFIRM_RESPONSE, { callId: request.callId, decision: 'deny' });
  await rejected;
  expect(h.run).not.toHaveBeenCalled();
});

it.each(['admin', 'pilot', 'document', 'route'])(
  'real dispatcher refuses changed %s after the approval request',
  async (change) => {
    const dispatch = await import('@/lib/tools/dispatch');
    dispatch.startToolDispatcher({ defaultPermissionMode: () => 'act' });
    const result = dispatch.runLocalSavedPattern(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      37,
      new AbortController().signal,
      () => {},
    );
    const rejected = expect(result).rejects.toThrow();
    await vi.waitFor(() =>
      expect(
        h.broadcasts.mock.calls.some((call) => call[0] === CHANNELS.TOOL_CONFIRM_REQUEST),
      ).toBe(true),
    );
    const request = h.broadcasts.mock.calls.find(
      (call) => call[0] === CHANNELS.TOOL_CONFIRM_REQUEST,
    )![1];
    if (change === 'admin') h.admin = false;
    else if (change === 'pilot') h.group = 2;
    else if (change === 'route') h.url = 'https://calendar.invalid/other-route';
    else h.document = 'same-url-replacement-document';
    emit(CHANNELS.TOOL_CONFIRM_RESPONSE, { callId: request.callId, decision: 'allow' });
    await rejected;
    expect(h.run).not.toHaveBeenCalled();
  },
);

it('persisted recovery compares newly read SPA route, not a copied stored identity', async () => {
  const { data_patterns } = await import('@/lib/tools/handlers/data-patterns');
  const ctx = {
    callId: 'changed-route',
    runId: 'run',
    conversationId: 'conversation',
    assignedTabId: 37,
    agentName: 'Agent',
    permissionMode: 'act' as const,
  };
  const args = { action: 'run' as const, pattern_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
  const prepared = await data_patterns.prepare!(args, ctx);
  const { persistPendingConfirm } = await import('@/lib/tools/dispatch-persist');
  await persistPendingConfirm({
    ...ctx,
    toolName: 'data_patterns',
    args,
    initiator: 'agent',
    effectiveTier: 'privileged',
    expiresAt: Date.now() + 1000,
    preparedOperation: { snapshotKey: prepared!.snapshotKey, delivery: 'agent' },
  });
  h.url = 'https://calendar.invalid/other-route';
  const dispatch = await import('@/lib/tools/dispatch');
  dispatch.startToolDispatcher({ defaultPermissionMode: () => 'act' });
  emit(CHANNELS.TOOL_CONFIRM_RESPONSE, { callId: ctx.callId, decision: 'allow' });
  await vi.waitFor(() => expect(h.post).toHaveBeenCalled());
  expect(h.run).not.toHaveBeenCalled();
  expect(h.post.mock.calls[0]![1][0].is_error).toBe(true);
});

it('worker recovery expires disconnected local approval without capture or synthetic agent delivery', async () => {
  const { persistPendingConfirm } = await import('@/lib/tools/dispatch-persist');
  await persistPendingConfirm({
    callId: 'local-crashed',
    runId: 'local-run',
    conversationId: null,
    assignedTabId: 37,
    agentName: null,
    permissionMode: 'act',
    toolName: 'data_patterns',
    args: { action: 'run', pattern_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    initiator: 'extension',
    effectiveTier: 'privileged',
    expiresAt: Date.now() + 1000,
    preparedOperation: { snapshotKey: 'local-snapshot', delivery: 'local' },
  });
  const dispatch = await import('@/lib/tools/dispatch');
  dispatch.startToolDispatcher({ defaultPermissionMode: () => 'act' });
  emit(CHANNELS.TOOL_CONFIRM_RESPONSE, { callId: 'local-crashed', decision: 'allow' });
  await vi.waitFor(() =>
    expect(h.broadcasts).toHaveBeenCalledWith(
      CHANNELS.TOOL_CONFIRM_EXPIRED,
      expect.objectContaining({ callId: 'local-crashed' }),
    ),
  );
  expect(h.run).not.toHaveBeenCalled();
  expect(h.post).not.toHaveBeenCalled();
});
