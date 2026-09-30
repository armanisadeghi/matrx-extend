import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({
  handlers: new Map<string, Array<(p: any) => unknown>>(),
  broadcasts: vi.fn(),
  run: vi.fn(),
  post: vi.fn(),
  admin: true,
  group: -1,
  document: 'original-document',
  url: 'https://calendar.invalid/calendar',
  releases: new Set<() => void>(),
  nextScriptId: 0,
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
  broadcast: (kind: string, payload: unknown) => {
    h.broadcasts(kind, payload);
    for (const fn of [...(h.handlers.get(kind) ?? [])]) fn(payload);
  },
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
      config: {
        url_filter: 'https://calendar.invalid/api',
        url_match: 'exact',
        body_match: 'ignore',
      },
      fields: [],
      route_pattern: '/calendar',
      list_root_selector: null,
    },
  ],
  bumpPatternRun: vi.fn(),
  savePattern: vi.fn(),
  deletePattern: vi.fn(),
  renamePattern: vi.fn(),
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
vi.mock('@/hooks/use-active-tab', () => ({
  useActiveTab: () => ({
    id: 37,
    url: h.url,
    title: 'Calendar',
    documentId: h.document,
    identityStatus: 'ready',
    identityError: null,
    pageKey: h.document,
  }),
  isCurrentPageIdentity: () => true,
}));
vi.mock('@/lib/destructive/confirm', () => ({ confirmDestructive: vi.fn() }));
import { SavedReplayApprovalHost } from '@/features/showcase/SavedReplayApprovalHost';
import { PatternsTab } from '@/features/showcase/tabs/PatternsTab';
import { registerDocumentNetworkCaptureHost } from '@/lib/data-pattern/document-network-transport';
import { bumpPatternRun } from '@/lib/supabase/queries';
import { runLocalSavedPattern, startToolDispatcher } from '@/lib/tools/dispatch';
// Browser APIs and DB/auth are boundary doubles. Actual PatternsTab, saved runner,
// port host, dispatcher, preparation, CDP client, capture core and row parser run.
afterEach(async () => {
  // Every case deliberately stalls a different CDP operation. Release all
  // test-owned gates even if an assertion fails, so no background replay can
  // mutate the next case's Chrome doubles.
  for (const release of [...h.releases]) release();
  h.releases.clear();
  // Releasing a deliberately stalled CDP setup resumes async work that can
  // otherwise reach the next case after its Chrome boundary doubles changed.
  // Do not run every timer: the production CDP client intentionally renews
  // its ten-minute idle timer while a lease exists, which makes a full fake
  // clock drain an infinite loop rather than test cleanup. Advance exactly
  // through the capture cleanup deadline instead, so a rejected/stalled
  // detach cannot leak its owned lease into the next parameterized case.
  await vi.advanceTimersByTimeAsync(20_000);
  await vi.dynamicImportSettled();
  h.handlers.clear();
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.clearAllMocks();
});
it.each([
  ['responsive cleanup', false, false, false],
  ['rejected owned debugger detach', false, false, true],
  ['stalled hook removal', true, false, false],
  ['stalled owned debugger detach', false, true, false],
])(
  'saved UI handles %s after a full window without showing old-document rows',
  async (_name, stallCleanup, stallDetach, rejectDetach) => {
    vi.useFakeTimers();
    let stored: Record<string, unknown> = {};
    Object.assign(chrome.storage, {
      session: {
        get: async () => structuredClone(stored),
        set: async (v: object) => {
          stored = { ...stored, ...structuredClone(v) };
        },
      },
    });
    const connections = new Set<(port: chrome.runtime.Port) => void>();
    Object.assign(chrome, {
      runtime: {
        id: 'extension',
        onConnect: { addListener: (fn: (p: chrome.runtime.Port) => void) => connections.add(fn) },
        connect: () => {
          const clientMessages = new Set<(v: unknown) => void>();
          const serverMessages = new Set<(v: unknown) => void>();
          const disconnects = new Set<() => void>();
          let closed = false;
          const disconnect = () => {
            if (closed) return;
            closed = true;
            for (const fn of disconnects) fn();
          };
          const endpoint = (
            input: Set<(v: unknown) => void>,
            output: Set<(v: unknown) => void>,
          ) => ({
            postMessage: (v: unknown) => {
              for (const fn of output) fn(v);
            },
            disconnect,
            onMessage: { addListener: (fn: (v: unknown) => void) => input.add(fn) },
            onDisconnect: { addListener: (fn: () => void) => disconnects.add(fn) },
          });
          const client = endpoint(clientMessages, serverMessages);
          const server = {
            ...endpoint(serverMessages, clientMessages),
            name: 'matrx:document-network-capture',
            sender: { id: 'extension' },
          };
          for (const fn of connections) fn(server as unknown as chrome.runtime.Port);
          return client;
        },
      },
    });
    const events = new Set<(source: object, method: string, params: object) => void>();
    const emit = (method: string, params: object) => {
      for (const fn of events) fn({ tabId: 37 }, method, params);
    };
    const context = (id: number, uniqueId: string) =>
      emit('Runtime.executionContextCreated', {
        context: { id, uniqueId, auxData: { frameId: 'main', isDefault: true } },
      });
    let binding = '';
    let registered = false;
    let scriptId = '';
    let releaseSetup!: () => void;
    const attach = vi.fn(async () => {});
    const detach = vi.fn(async () => {
      if (stallDetach)
        await new Promise<void>((resolve) => {
          h.releases.add(resolve);
        });
      if (rejectDetach) throw new Error('Chrome refused debugger detach');
    });
    const sendCommand = vi.fn(async (_target, method, params) => {
      // A prior case may finish its already-owned cleanup after this mock is
      // installed. Chrome gives every registration a distinct identifier, so
      // only stall removal of this case's own script. Stalling a late prior
      // removal would hold its shared CDP lease and prevent this case's setup.
      if (
        stallCleanup &&
        method === 'Page.removeScriptToEvaluateOnNewDocument' &&
        params?.identifier === scriptId
      )
        return new Promise<void>((resolve) => {
          h.releases.add(resolve);
        });
      if (method === 'Page.getFrameTree')
        return { frameTree: { frame: { id: 'main', url: h.url } } };
      if (method === 'Runtime.enable') context(1, 'old');
      if (method === 'Runtime.addBinding') binding = params.name;
      if (method === 'Page.addScriptToEvaluateOnNewDocument') {
        await new Promise<void>((resolve) => {
          releaseSetup = () => {
            h.releases.delete(releaseSetup);
            resolve();
          };
          h.releases.add(releaseSetup);
        });
        registered = true;
        scriptId = `script-${++h.nextScriptId}`;
        return { identifier: scriptId };
      }
      if (method === 'Page.reload') {
        expect(registered).toBe(true);
        context(2, 'new');
        // Mirror the document-start main-world hook: the capture core will
        // only authorize its nonce-pinned cleanup after this CDP handshake.
        emit('Runtime.bindingCalled', {
          name: binding,
          executionContextId: 2,
          payload: JSON.stringify({
            __matrx_capture_hook: 'network-tap',
            nonce: 'a'.repeat(32),
          }),
        });
        const packet = (id: number, title: string, sequence: number) =>
          emit('Runtime.bindingCalled', {
            name: binding,
            executionContextId: id,
            payload: JSON.stringify({
              source: 'fetch',
              url: 'https://calendar.invalid/api',
              method: 'GET',
              body: JSON.stringify([{ title }]),
              status: 200,
              request_body_key: 'none',
              request_sequence: sequence,
              ts_ms: 1,
              body_size: 100,
              body_truncated: false,
            }),
          });
        packet(1, 'STALE_DOCUMENT_ROW', 999);
        packet(2, 'CURRENT_DOCUMENT_ROW', 1);
        emit('Page.frameNavigated', { frame: { id: 'main', url: h.url } });
      }
      return {};
    });
    Object.assign(chrome, {
      debugger: {
        attach,
        detach,
        sendCommand,
        onEvent: {
          addListener: (fn: any) => events.add(fn),
          removeListener: (fn: any) => events.delete(fn),
        },
        onDetach: { addListener: vi.fn(), removeListener: vi.fn() },
      },
      tabs: { get: async () => ({ id: 37, groupId: 1, url: h.url }) },
      scripting: {
        executeScript: async (details: { args?: unknown[] }) => {
          const hookCall = details.args?.length === 2;
          return [
            {
              result: hookCall ? true : null,
              documentId: hookCall ? 'replay-document' : 'original-document',
            },
          ];
        },
      },
    });
    startToolDispatcher({ defaultPermissionMode: () => 'act' });
    registerDocumentNetworkCaptureHost(runLocalSavedPattern);
    const drain = async () => {
      for (let i = 0; i < 100; i++) await Promise.resolve();
    };
    render(
      <>
        <PatternsTab />
        <SavedReplayApprovalHost signedIn />
      </>,
    );
    await act(drain);
    fireEvent.click(screen.getByTitle('Run pattern'));
    await vi.dynamicImportSettled();
    await act(drain);
    expect(attach).not.toHaveBeenCalled();
    // Dispatch crosses async storage and messaging boundaries before the
    // approval host receives the request. Advance the fake clock in small,
    // bounded steps instead of relying on an incidental microtask count.
    for (
      let i = 0;
      i < 10 && screen.queryAllByRole('button', { name: 'Allow' }).length === 0;
      i++
    ) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
        await drain();
      });
    }
    const allows = screen.getAllByRole('button', { name: 'Allow' });
    expect(allows).toHaveLength(1);
    const allow = allows[0];
    if (!allow) throw new Error('The saved replay approval did not render.');
    const approvalText = allow.parentElement?.parentElement?.textContent ?? '';
    expect(approvalText).toContain('Events');
    expect(approvalText).toContain('https://calendar.invalid/calendar');
    expect(approvalText).toMatch(/debugger.*reload/i);
    fireEvent.click(allow);
    // The persisted-confirm recovery crosses storage, messaging, and React
    // boundaries before it reaches CDP setup. Keep the setup gate explicit:
    // package import scheduling must not decide whether this guard reaches its
    // intended stalled-cleanup path.
    for (let i = 0; i < 100 && !releaseSetup; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
        await drain();
      });
    }
    expect(releaseSetup).toBeTypeOf('function');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
      releaseSetup();
      await drain();
    });
    expect(sendCommand.mock.calls.some((call) => call[1] === 'Page.reload')).toBe(true);
    await act(async () => {
      // The matching window starts only after setup is released. A full
      // window must elapse before close begins; advancing only ten seconds
      // left the stalled cases before their cleanup boundary.
      await vi.advanceTimersByTimeAsync(20000);
      await drain();
    });
    if (stallCleanup || stallDetach || rejectDetach) {
      await act(async () => {
        // Close has its own timeout. This is a separate budget from the
        // matching window, so a deliberately stalled Chrome acknowledgement
        // cannot be asserted until this second boundary has elapsed.
        await vi.advanceTimersByTimeAsync(20000);
        await drain();
      });
      expect(screen.queryByText('CURRENT_DOCUMENT_ROW')).toBeNull();
      expect(screen.getByText(/Chrome did not confirm removal/)).toBeTruthy();
      expect(bumpPatternRun).not.toHaveBeenCalled();
    } else expect(screen.getByText('CURRENT_DOCUMENT_ROW')).toBeTruthy();
    expect(screen.queryByText('STALE_DOCUMENT_ROW')).toBeNull();
    expect(detach).toHaveBeenCalledOnce();
    if (rejectDetach) {
      detach.mockResolvedValue(undefined);
      const client = await import('@/lib/cdp/client');
      await client.detach(37);
    }
  },
);
