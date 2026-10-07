/**
 * A reload first retires the old offscreen document. The desktop reconnect
 * must wait: both operations own that singleton document, and reversing them
 * destroys the fresh socket's owner after it opens.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { on } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import { matchesAllowedOrigin } from '@/lib/origin-allowlist';
import { readDefaultPermissionMode } from '@/lib/settings/persisted';
import { handleWebmcpCall } from '@/lib/tools/dispatch';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
};

const mocks = vi.hoisted(() => ({
  close: vi.fn(),
  deferOffscreen: vi.fn(),
  probe: vi.fn(async () => ({ transport: 'http' as const, health: null, lastChecked: 1 })),
  connect: vi.fn(),
}));

vi.mock('@/lib/agenda/scanner', () => ({
  registerAgendaNotificationClicks: vi.fn(),
  scanAndNotify: vi.fn(),
  startAgendaScanner: vi.fn(),
}));
vi.mock('@/lib/audio/audible-log', () => ({ startAudibleLog: vi.fn() }));
vi.mock('@/lib/auth/flow', () => ({ refreshAccessToken: vi.fn() }));
vi.mock('@/lib/auth/identity', () => ({ logExtensionIdentityOnce: vi.fn() }));
vi.mock('@/lib/auth/safari-background', () => ({ registerSafariAuthorizationBackground: vi.fn() }));
vi.mock('@/lib/cdp/client', () => ({ reconcileOnBoot: vi.fn() }));
vi.mock('@/lib/debug/bridge-traffic', () => ({
  hydrateBridgeTrafficEnabled: vi.fn(),
  recordBridgeTraffic: vi.fn(),
}));
vi.mock('@/lib/debug/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
  startDebugRelay: vi.fn(),
}));
vi.mock('@/lib/demos/event-capture', () => ({ onCapturedEvent: vi.fn() }));
vi.mock('@/lib/desktop/bridge', () => ({
  desktopRpc: vi.fn(),
  probeDesktop: mocks.probe,
  startDesktopProbeAlarm: vi.fn(),
}));
vi.mock('@/lib/desktop/discovery', () => ({
  invalidateEnginePortCache: vi.fn(),
  resetEngineDiscoveryBackoff: vi.fn(),
}));
vi.mock('@/lib/desktop/local-browser/controller', () => ({ startLocalBrowserController: vi.fn() }));
vi.mock('@/lib/desktop/native', () => ({ resetNativeProbeBackoff: vi.fn() }));
vi.mock('@/lib/desktop/types', () => ({ desktopHealthSnapshotKey: vi.fn(() => 'health') }));
vi.mock('@/lib/desktop/ws-client', () => ({
  connectWs: mocks.connect,
  installWsRouter: vi.fn(),
  shouldBackgroundReopenWs: vi.fn(() => false),
}));
vi.mock('@/lib/desktop/ws-invoke', () => ({ registerWsReverseInvocationHandler: vi.fn() }));
vi.mock('@/lib/frontend-bridge/broadcast', () => ({
  connectBroadcast: vi.fn(),
  disconnectBroadcast: vi.fn(),
}));
vi.mock('@/lib/frontend-bridge/handler', () => ({
  FRONTEND_RPC_CHANNEL: 'frontend:rpc',
  FrontendRpcEnvelopeSchema: { safeParse: vi.fn() },
  handleFrontendRpc: vi.fn(),
}));
vi.mock('@/lib/realtime/host', () => ({ stopRealtimeHost: vi.fn() }));
vi.mock('@/lib/scheduler-host', () => ({
  startSchedulerHost: vi.fn(),
  stopSchedulerHost: vi.fn(),
}));
vi.mock('@/lib/scheduler-host/handlers/ping', () => ({}));
vi.mock('@/lib/broker/sw-host', () => ({
  clearBrokerCacheOnSignOut: vi.fn(),
  registerBrokerHandlers: vi.fn(),
}));
vi.mock('@/lib/context-menus/setup', () => ({ setupContextMenus: vi.fn() }));
vi.mock('@/lib/credentials/assistance-status', () => ({
  reconcileCredentialAssistanceActionOnBoot: vi.fn(async () => undefined),
  registerCredentialAssistanceStatus: vi.fn(),
}));
vi.mock('@/lib/credentials/capture-candidates', () => ({
  registerCredentialCaptureHost: vi.fn(),
  rehydrateCredentialCaptureCandidates: vi.fn(),
}));
vi.mock('@/lib/credentials/generation-host', () => ({ registerGeneratedPasswordHost: vi.fn() }));
vi.mock('@/lib/credentials/inline-suggestions-host', () => ({
  registerInlineCredentialSuggestionHost: vi.fn(),
}));
vi.mock('@/lib/messaging/native', () => ({ broadcast: vi.fn(), on: vi.fn(() => () => undefined) }));
vi.mock('@/lib/messaging/schemas', () => ({
  CHANNELS: { DESKTOP_AVAILABILITY: 'desktop:availability', WEBMCP_CALL: 'webmcp:call' },
}));
vi.mock('@/lib/origin-allowlist', () => ({ matchesAllowedOrigin: vi.fn() }));
vi.mock('@/lib/settings/persisted', () => ({ readDefaultPermissionMode: vi.fn() }));
vi.mock('@/lib/stream/active-runs', () => ({ hasRecentActiveStream: mocks.close }));
vi.mock('@/lib/stream/offscreen-proxy', () => ({
  cancelStream: vi.fn(),
  deferOffscreenAcquisitionUntil: mocks.deferOffscreen,
  ensureOffscreen: vi.fn(),
  startStream: vi.fn(),
}));
vi.mock('@/lib/supabase/client', () => ({ setSupabaseSession: vi.fn() }));
vi.mock('@/lib/supabase/queries', () => ({ lookupCapturedByUrl: vi.fn() }));
vi.mock('@/lib/tools/dispatch', () => ({
  handleWebmcpCall: vi.fn(),
  recordAssignedTab: vi.fn(),
  runLocalNetworkDiscovery: vi.fn(),
  runLocalSavedPattern: vi.fn(),
  startToolDispatcher: vi.fn(),
}));
vi.mock('@/lib/webmcp/register', () => ({ registerToolsOnActiveTab: vi.fn() }));
vi.mock('@/state/pilot', () => ({
  getPilotSessionSnapshotAsync: vi.fn(async () => ({ active: false })),
  usePilotStore: { getState: () => ({ isGroupValid: vi.fn() }) },
}));

describe('reload startup ordering', () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('does not reconnect the desktop until stale offscreen cleanup finishes', async () => {
    const cleanup = deferred<boolean>();
    mocks.close.mockReturnValue(cleanup.promise);
    vi.stubGlobal('chrome', {
      alarms: { onAlarm: { addListener: vi.fn() } },
      runtime: {
        onMessage: { addListener: vi.fn() },
        onConnect: { addListener: vi.fn() },
      },
      storage: { local: { get: vi.fn(async () => ({})) }, onChanged: { addListener: vi.fn() } },
      tabs: { onUpdated: { addListener: vi.fn() } },
    });
    const { bootstrapBackground } = await import('@/lib/background/bootstrap');

    bootstrapBackground();
    expect(mocks.deferOffscreen).toHaveBeenCalledWith(cleanup.promise);
    // Let every independent bootstrap task make progress. The cleanup stays
    // unresolved, so a reconnect here would recreate the race.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.probe).not.toHaveBeenCalled();
    expect(mocks.connect).not.toHaveBeenCalled();

    cleanup.resolve(false);
    for (let attempt = 0; attempt < 10 && mocks.probe.mock.calls.length === 0; attempt += 1)
      await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.probe).toHaveBeenCalledOnce();
    expect(mocks.connect).toHaveBeenCalledOnce();
  });

  it('fails open only when the read-only stale-offscreen preflight times out', async () => {
    vi.useFakeTimers();
    mocks.close.mockReturnValue(new Promise<boolean>(() => undefined));
    vi.stubGlobal('chrome', {
      alarms: { onAlarm: { addListener: vi.fn() } },
      runtime: {
        onMessage: { addListener: vi.fn() },
        onConnect: { addListener: vi.fn() },
      },
      storage: { local: { get: vi.fn(async () => ({})) }, onChanged: { addListener: vi.fn() } },
      tabs: { onUpdated: { addListener: vi.fn() } },
    });
    const { bootstrapBackground } = await import('@/lib/background/bootstrap');

    bootstrapBackground();
    await vi.advanceTimersByTimeAsync(5_000);
    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.probe).toHaveBeenCalledOnce();
    expect(mocks.connect).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});

describe('WebMCP page sender routing', () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('binds calls to their origin tab and refuses a sender without a tab', async () => {
    let originOpen = true;
    mocks.close.mockResolvedValue(false);
    vi.mocked(matchesAllowedOrigin).mockReturnValue(true);
    vi.mocked(readDefaultPermissionMode).mockResolvedValue('act');
    vi.mocked(handleWebmcpCall).mockResolvedValue({ ok: true, result: 'called' });
    vi.stubGlobal('chrome', {
      alarms: { onAlarm: { addListener: vi.fn() } },
      runtime: { onMessage: { addListener: vi.fn() }, onConnect: { addListener: vi.fn() } },
      storage: { local: { get: vi.fn(async () => ({})) }, onChanged: { addListener: vi.fn() } },
      tabs: {
        onUpdated: { addListener: vi.fn() },
        get: vi.fn(async (id: number) => {
          if (!originOpen || id !== 17) throw new Error('No tab with id');
          return { id };
        }),
      },
    });
    const { bootstrapBackground } = await import('@/lib/background/bootstrap');
    bootstrapBackground();
    const listener = vi.mocked(on).mock.calls.find(([kind]) => kind === CHANNELS.WEBMCP_CALL)?.[1];
    expect(listener).toBeDefined();
    const payload = { callId: 'page-tab', toolName: 'read_active_page', args: {} };
    const sender: chrome.runtime.MessageSender = {
      tab: {
        id: 17,
        url: 'https://aimatrx.com/',
        index: 0,
        pinned: false,
        highlighted: false,
        windowId: 1,
        active: false,
        incognito: false,
        selected: false,
        discarded: false,
        autoDiscardable: true,
        groupId: -1,
      },
    };
    expect(await listener?.(payload, sender)).toEqual({ ok: true, result: 'called' });
    expect(handleWebmcpCall).toHaveBeenCalledWith(payload, {
      permissionMode: 'act',
      initiator: 'page',
      assignedTabId: 17,
    });
    vi.mocked(handleWebmcpCall).mockClear();
    expect(await listener?.(payload, { url: 'https://aimatrx.com/' })).toEqual({
      ok: false,
      error: 'webmcp: origin tab unavailable',
    });
    expect(handleWebmcpCall).not.toHaveBeenCalled();
    originOpen = false;
    expect(await listener?.(payload, sender)).toEqual({
      ok: false,
      error: 'webmcp: origin tab unavailable',
    });
    expect(handleWebmcpCall).not.toHaveBeenCalled();
  });
});
