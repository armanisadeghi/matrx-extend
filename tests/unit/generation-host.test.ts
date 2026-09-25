import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const USER = '00000000-0000-0000-0000-000000000001';
const ORG = '00000000-0000-0000-0000-000000000002';
const state = vi.hoisted(() => ({
  user: '00000000-0000-0000-0000-000000000001' as string | null,
  org: '00000000-0000-0000-0000-000000000002' as string | null,
  active: true,
  focused: true,
  permitted: true,
  documentId: 'frame-document',
  topDocumentId: 'top-document',
  fillGate: null as Promise<void> | null,
  focusedWindowGate: null as Promise<void> | null,
  focusedWindowAvailable: true,
  fills: 0,
  discoveries: 0,
  actorCalls: 0,
  actorGate: null as Promise<void> | null,
  registryInvalidations: [] as string[][],
}));
const listeners: Array<
  (
    message: unknown,
    sender: chrome.runtime.MessageSender,
    reply: (value: unknown) => void,
  ) => boolean
> = [];
const connects: Array<(port: chrome.runtime.Port) => void> = [];
const disconnects = new Set<() => void>();
let connectionId: string | null = null;
const activation: Array<(info: chrome.tabs.TabActiveInfo) => void> = [];
const committed: Array<(details: chrome.webNavigation.WebNavigationFramedCallbackDetails) => void> =
  [];
const tabMessages: unknown[] = [];

vi.mock('@/lib/auth/flow', () => ({
  getCurrentUser: async () => {
    state.actorCalls += 1;
    if (state.actorCalls > 1) await state.actorGate;
    return state.user ? { id: state.user } : null;
  },
}));
vi.mock('@/lib/api/routes/vault', () => ({ hasRealUserToken: async () => !!state.user }));
vi.mock('@/lib/org/active-org', () => ({ getActiveOrganizationId: async () => state.org }));

function sender(
  overrides: Partial<chrome.runtime.MessageSender> = {},
): chrome.runtime.MessageSender {
  return {
    id: 'extension-id',
    url: 'chrome-extension://extension-id/sidepanel.html',
    documentId: 'panel-document',
    ...overrides,
  } as chrome.runtime.MessageSender;
}
function openConnection(from = sender()) {
  let id: string | null = null;
  const localDisconnects = new Set<() => void>();
  const port = {
    name: 'matrx-generation-panel-v1',
    sender: from,
    postMessage: (handshake: { connectionId?: string }) => {
      id = handshake.connectionId ?? null;
    },
    disconnect: () => localDisconnects.forEach((listener) => listener()),
    onDisconnect: { addListener: (listener: () => void) => localDisconnects.add(listener) },
  } as unknown as chrome.runtime.Port;
  connects.forEach((listener) => listener(port));
  expect(id).toMatch(/^[a-f0-9]{36}$/);
  return { id: id!, disconnect: () => localDisconnects.forEach((listener) => listener()) };
}
function ask(message: unknown, from = sender()): Promise<unknown> {
  return new Promise((resolve) => {
    if (!connectionId) connectionId = openConnection(from).id;
    if (message && typeof message === 'object' && !('connectionId' in message))
      Object.assign(message, { connectionId });
    const returns = listeners.map((listener) => listener(message, from, resolve));
    expect(returns).toContain(true);
  });
}
function request(operation: 'discover' | 'use' | 'discard', fields: Record<string, unknown> = {}) {
  return { __matrxCredentialGeneration: true, operation, ...fields };
}

beforeEach(() => {
  listeners.length = 0;
  connects.length = 0;
  disconnects.clear();
  connectionId = null;
  activation.length = 0;
  committed.length = 0;
  tabMessages.length = 0;
  state.user = USER;
  state.org = ORG;
  state.active = true;
  state.focused = true;
  state.permitted = true;
  state.documentId = 'frame-document';
  state.topDocumentId = 'top-document';
  state.fillGate = null;
  state.focusedWindowGate = null;
  state.focusedWindowAvailable = true;
  state.fills = 0;
  state.discoveries = 0;
  state.actorCalls = 0;
  state.actorGate = null;
  state.registryInvalidations = [];
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      id: 'extension-id',
      getURL: (path: string) => `chrome-extension://extension-id/${path}`,
      sendMessage: async (message: unknown) => {
        tabMessages.push(message);
      },
      onMessage: {
        addListener: (
          listener: (
            message: unknown,
            from: chrome.runtime.MessageSender,
            reply: (value: unknown) => void,
          ) => boolean,
        ) => listeners.push(listener),
      },
      onConnect: {
        addListener: (listener: (port: chrome.runtime.Port) => void) => connects.push(listener),
      },
    },
    tabs: {
      get: async (tabId: number) => ({ id: tabId, windowId: 1, active: state.active }),
      sendMessage: async (_tabId: number, message: unknown) => {
        tabMessages.push(message);
      },
      onRemoved: { addListener: () => undefined },
      onUpdated: { addListener: () => undefined },
      onActivated: {
        addListener: (listener: (info: chrome.tabs.TabActiveInfo) => void) =>
          activation.push(listener),
      },
    },
    windows: {
      get: async () => ({ focused: state.focused }),
      getLastFocused: async () => {
        await state.focusedWindowGate;
        return state.focusedWindowAvailable
          ? { id: 1, focused: state.focused }
          : { id: undefined, focused: false };
      },
      onRemoved: { addListener: () => undefined },
      onFocusChanged: { addListener: () => undefined },
    },
    permissions: { contains: async () => state.permitted },
    webNavigation: {
      getAllFrames: async () => [
        {
          frameId: 0,
          documentId: state.topDocumentId,
          url: 'https://parent.example.test/settings',
        },
        { frameId: 3, documentId: state.documentId, url: 'https://frame.example.test/reset' },
      ],
      getFrame: async ({ frameId }: { frameId: number }) =>
        frameId === 0
          ? { documentId: state.topDocumentId, url: 'https://parent.example.test/settings' }
          : { documentId: state.documentId, url: 'https://frame.example.test/reset' },
      onCommitted: {
        addListener: (
          listener: (details: chrome.webNavigation.WebNavigationFramedCallbackDetails) => void,
        ) => committed.push(listener),
      },
    },
    scripting: {
      executeScript: async ({
        target,
        args,
      }: { target: chrome.scripting.InjectionTarget; args?: unknown[] }) => {
        expect(target).toMatchObject({ tabId: 7, documentIds: expect.any(Array) });
        if (Array.isArray(args?.[0])) {
          state.registryInvalidations.push(args[0] as string[]);
          return [{ result: undefined }];
        }
        const operation = (args?.[0] as { operation: string }).operation;
        if (operation === 'discover_new_password_groups')
          return [
            {
              result: {
                groups: [
                  {
                    targets: [
                      {
                        id: `opaque-field-${++state.discoveries}`,
                        openShadowPath: [],
                        constraint: {
                          minLength: 12,
                          maxLength: 64,
                          pattern: null,
                          autocomplete: 'new-password',
                          roleEvidence: 'new_password',
                        },
                      },
                    ],
                  },
                ],
              },
            },
          ];
        state.fills++;
        await state.fillGate;
        return [{ result: { status: 'filled' } }];
      },
    },
    storage: { onChanged: { addListener: () => undefined } },
  };
});
afterEach(() => {
  vi.useRealTimers();
  vi.resetModules();
  vi.restoreAllMocks();
});

describe('generated password host', () => {
  it('discovers an exact permitted frame and fills it once through the registered raw listener', async () => {
    const { registerGeneratedPasswordHost } = await import('@/lib/credentials/generation-host');
    registerGeneratedPasswordHost();
    const found = (await ask(request('discover', { tabId: 7 }))) as {
      status: string;
      offers: Array<{ id: string; frameId: number; origin: string; fieldCount: number }>;
    };
    expect(found).toMatchObject({ status: 'ready' });
    expect(found.offers).toHaveLength(2);
    const frameOffer = found.offers.find((offer) => offer.frameId === 3)!;
    expect(frameOffer).toMatchObject({ origin: 'https://frame.example.test', fieldCount: 1 });
    const [first, replay] = await Promise.all([
      ask(request('use', { offerId: frameOffer.id, value: 'A-generated-password-12' })),
      ask(request('use', { offerId: frameOffer.id, value: 'A-generated-password-12' })),
    ]);
    expect(first).toMatchObject({ status: 'filled' });
    expect(replay).toMatchObject({ status: 'stale' });
    expect(state.fills).toBe(1);
  });

  it('rejects content-script and wrong extension-page callers before dispatch', async () => {
    const { registerGeneratedPasswordHost } = await import('@/lib/credentials/generation-host');
    registerGeneratedPasswordHost();
    const raw = listeners[0]!;
    expect(
      raw(
        request('discover', { tabId: 7 }),
        sender({ tab: { id: 7 } as chrome.tabs.Tab }),
        () => undefined,
      ),
    ).toBe(false);
    expect(
      raw(
        request('discover', { tabId: 7 }),
        sender({ url: 'chrome-extension://extension-id/options.html' }),
        () => undefined,
      ),
    ).toBe(false);
  });

  it('refuses tokenless generation messages before discovery', async () => {
    const { registerGeneratedPasswordHost } = await import('@/lib/credentials/generation-host');
    registerGeneratedPasswordHost();
    expect(listeners[0]!(request('discover', { tabId: 7 }), sender(), () => undefined)).toBe(false);
    expect(state.discoveries).toBe(0);
  });

  it('leaves unrelated extension ports untouched', async () => {
    const { registerGeneratedPasswordHost } = await import('@/lib/credentials/generation-host');
    registerGeneratedPasswordHost();
    const disconnect = vi.fn();
    const port = {
      name: 'matrx-mic-channel',
      sender: sender(),
      disconnect,
    } as unknown as chrome.runtime.Port;
    connects.forEach((listener) => listener(port));
    expect(disconnect).not.toHaveBeenCalled();
  });

  it('invalidates only the disconnected panel connection and refuses its old offer', async () => {
    const { registerGeneratedPasswordHost } = await import('@/lib/credentials/generation-host');
    registerGeneratedPasswordHost();
    const owner = openConnection();
    const found = (await ask({ ...request('discover', { tabId: 7 }), connectionId: owner.id })) as {
      offers: Array<{ id: string; frameId: number }>;
    };
    const offer = found.offers.find((candidate) => candidate.frameId === 3)!;
    owner.disconnect();
    await expect(
      ask({
        ...request('use', { offerId: offer.id, value: 'A-generated-password-12' }),
        connectionId: owner.id,
      }),
    ).resolves.toMatchObject({ status: 'stale' });
    expect(state.fills).toBe(0);
  });

  it('refuses a second panel token without claiming the owner offer', async () => {
    const { registerGeneratedPasswordHost } = await import('@/lib/credentials/generation-host');
    registerGeneratedPasswordHost();
    const owner = openConnection();
    const other = openConnection();
    const found = (await ask({ ...request('discover', { tabId: 7 }), connectionId: owner.id })) as {
      offers: Array<{ id: string; frameId: number }>;
    };
    const offer = found.offers.find((candidate) => candidate.frameId === 3)!;
    await expect(
      ask({
        ...request('use', { offerId: offer.id, value: 'A-generated-password-12' }),
        connectionId: other.id,
      }),
    ).resolves.toMatchObject({ status: 'stale' });
    await expect(
      ask({
        ...request('use', { offerId: offer.id, value: 'A-generated-password-12' }),
        connectionId: owner.id,
      }),
    ).resolves.toMatchObject({ status: 'filled' });
    expect(state.fills).toBe(1);
  });

  it('clears injected registry targets when its connection dies before discovery publication', async () => {
    const { registerGeneratedPasswordHost } = await import('@/lib/credentials/generation-host');
    registerGeneratedPasswordHost();
    const owner = openConnection();
    let release!: () => void;
    state.actorGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pending = ask({ ...request('discover', { tabId: 7 }), connectionId: owner.id });
    await vi.waitFor(() => expect(state.discoveries).toBeGreaterThan(0));
    owner.disconnect();
    release();
    await expect(pending).resolves.toMatchObject({ status: 'stale' });
    expect(state.registryInvalidations.flat()).toContain('opaque-field-1');
  });

  it('refuses a disconnected use before DOM dispatch', async () => {
    const { registerGeneratedPasswordHost } = await import('@/lib/credentials/generation-host');
    registerGeneratedPasswordHost();
    const owner = openConnection();
    const found = (await ask({ ...request('discover', { tabId: 7 }), connectionId: owner.id })) as {
      offers: Array<{ id: string; frameId: number }>;
    };
    const offer = found.offers.find((candidate) => candidate.frameId === 3)!;
    let release!: () => void;
    state.focusedWindowGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pending = ask({
      ...request('use', { offerId: offer.id, value: 'A-generated-password-12' }),
      connectionId: owner.id,
    });
    owner.disconnect();
    release();
    await expect(pending).resolves.toMatchObject({ status: 'stale' });
    expect(state.fills).toBe(0);
  });

  it('refuses absent host permission without executing the DOM primitive', async () => {
    state.permitted = false;
    const { registerGeneratedPasswordHost } = await import('@/lib/credentials/generation-host');
    registerGeneratedPasswordHost();
    await expect(ask(request('discover', { tabId: 7 }))).resolves.toMatchObject({
      status: 'unsafe_destination',
    });
    expect(state.fills).toBe(0);
  });

  it('fences an in-flight use when navigation changes the frame document', async () => {
    const { registerGeneratedPasswordHost } = await import('@/lib/credentials/generation-host');
    registerGeneratedPasswordHost();
    const found = (await ask(request('discover', { tabId: 7 }))) as {
      offers: Array<{ id: string; frameId: number }>;
    };
    const offer = found.offers.find((candidate) => candidate.frameId === 3)!;
    state.fillGate = new Promise<void>((resolve) => setTimeout(resolve, 0));
    const pending = ask(request('use', { offerId: offer.id, value: 'A-generated-password-12' }));
    committed.forEach((listener) =>
      listener({ tabId: 7 } as chrome.webNavigation.WebNavigationFramedCallbackDetails),
    );
    await expect(pending).resolves.toMatchObject({ status: 'stale' });
    expect(tabMessages).toContainEqual(
      expect.objectContaining({
        __matrxCredentialGeneration: true,
        operation: 'invalidated',
        offerIds: expect.any(Array),
      }),
    );
  });

  it('invalidates offers when the active tab changes in the sidepanel window', async () => {
    const { registerGeneratedPasswordHost } = await import('@/lib/credentials/generation-host');
    registerGeneratedPasswordHost();
    const found = (await ask(request('discover', { tabId: 7 }))) as {
      offers: Array<{ id: string; frameId: number }>;
    };
    const offer = found.offers.find((candidate) => candidate.frameId === 3)!;
    activation.forEach((listener) => listener({ tabId: 9, windowId: 1 }));
    await expect(
      ask(request('use', { offerId: offer.id, value: 'A-generated-password-12' })),
    ).resolves.toMatchObject({ status: 'stale' });
    expect(state.fills).toBe(0);
  });

  it('refuses discovery when activation changes away and back while focused-window binding awaits', async () => {
    let release!: () => void;
    state.focusedWindowGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { registerGeneratedPasswordHost } = await import('@/lib/credentials/generation-host');
    registerGeneratedPasswordHost();
    const pending = ask(request('discover', { tabId: 7 }));
    activation.forEach((listener) => listener({ tabId: 9, windowId: 1 }));
    activation.forEach((listener) => listener({ tabId: 7, windowId: 1 }));
    release();
    await expect(pending).resolves.toMatchObject({ status: 'stale' });
  });

  it('does not inject after actor or organization changes between discovery and use', async () => {
    const { registerGeneratedPasswordHost } = await import('@/lib/credentials/generation-host');
    registerGeneratedPasswordHost();
    const found = (await ask(request('discover', { tabId: 7 }))) as {
      offers: Array<{ id: string; frameId: number }>;
    };
    state.org = '00000000-0000-0000-0000-000000000099';
    const offer = found.offers.find((candidate) => candidate.frameId === 3)!;
    await expect(
      ask(request('use', { offerId: offer.id, value: 'A-generated-password-12' })),
    ).resolves.toMatchObject({ status: 'stale' });
    expect(state.fills).toBe(0);
  });

  it('discards selected offers without accepting arbitrary target data', async () => {
    const { registerGeneratedPasswordHost } = await import('@/lib/credentials/generation-host');
    registerGeneratedPasswordHost();
    const found = (await ask(request('discover', { tabId: 7 }))) as {
      offers: Array<{ id: string }>;
    };
    await expect(ask(request('discard', { offerIds: [found.offers[0]!.id] }))).resolves.toEqual({
      status: 'discarded',
    });
    await expect(
      ask(request('use', { offerId: found.offers[0]!.id, value: 'A-generated-password-12' })),
    ).resolves.toMatchObject({ status: 'stale' });
  });

  it('claims use before deferred focused-window lookup and consumes the replay', async () => {
    const { registerGeneratedPasswordHost } = await import('@/lib/credentials/generation-host');
    registerGeneratedPasswordHost();
    const found = (await ask(request('discover', { tabId: 7 }))) as {
      offers: Array<{ id: string; frameId: number }>;
    };
    let release!: () => void;
    state.focusedWindowGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const offer = found.offers.find((candidate) => candidate.frameId === 3)!;
    const first = ask(request('use', { offerId: offer.id, value: 'A-generated-password-12' }));
    await expect(
      ask(request('use', { offerId: offer.id, value: 'A-generated-password-12' })),
    ).resolves.toMatchObject({ status: 'stale' });
    release();
    await expect(first).resolves.toMatchObject({ status: 'filled' });
    expect(state.fills).toBe(1);
  });

  it('returns a fixed refusal when no focused normal window can be found', async () => {
    state.focusedWindowAvailable = false;
    const { registerGeneratedPasswordHost } = await import('@/lib/credentials/generation-host');
    registerGeneratedPasswordHost();
    await expect(ask(request('discover', { tabId: 7 }))).resolves.toMatchObject({
      status: 'unavailable',
    });
  });

  it('does not broadcast an invalidation after a successful use cleanup', async () => {
    const { registerGeneratedPasswordHost } = await import('@/lib/credentials/generation-host');
    registerGeneratedPasswordHost();
    const found = (await ask(request('discover', { tabId: 7 }))) as {
      offers: Array<{ id: string; frameId: number }>;
    };
    const offer = found.offers.find((candidate) => candidate.frameId === 3)!;
    await expect(
      ask(request('use', { offerId: offer.id, value: 'A-generated-password-12' })),
    ).resolves.toMatchObject({ status: 'filled' });
    expect(
      tabMessages.filter(
        (message) => (message as { operation?: string }).operation === 'invalidated',
      ),
    ).toEqual([]);
  });

  it('expires a one-shot offer and broadcasts only a value-free invalidation', async () => {
    vi.useFakeTimers();
    const { registerGeneratedPasswordHost } = await import('@/lib/credentials/generation-host');
    registerGeneratedPasswordHost();
    const found = (await ask(request('discover', { tabId: 7 }))) as {
      offers: Array<{ id: string }>;
    };
    await vi.advanceTimersByTimeAsync(30_001);
    await expect(
      ask(request('use', { offerId: found.offers[0]!.id, value: 'A-generated-password-12' })),
    ).resolves.toMatchObject({ status: 'stale' });
    expect(tabMessages).toContainEqual(
      expect.objectContaining({
        __matrxCredentialGeneration: true,
        operation: 'invalidated',
        offerIds: expect.any(Array),
      }),
    );
    expect(JSON.stringify(tabMessages)).not.toContain('A-generated-password-12');
    vi.useRealTimers();
  });

  it('does not let an old expiry timer invalidate a newer offer', async () => {
    vi.useFakeTimers();
    const { registerGeneratedPasswordHost } = await import('@/lib/credentials/generation-host');
    registerGeneratedPasswordHost();
    const older = (await ask(request('discover', { tabId: 7 }))) as {
      offers: Array<{ id: string }>;
    };
    await vi.advanceTimersByTimeAsync(10);
    const newer = (await ask(request('discover', { tabId: 7 }))) as {
      offers: Array<{ id: string }>;
    };
    const newerIds = new Set(newer.offers.map((offer) => offer.id));
    await vi.advanceTimersByTimeAsync(29_991);
    const invalidated = tabMessages.filter(
      (message) => (message as { operation?: string }).operation === 'invalidated',
    ) as Array<{ offerIds: string[] }>;
    expect(invalidated.flatMap((message) => message.offerIds).some((id) => newerIds.has(id))).toBe(
      false,
    );
    await expect(
      ask(request('use', { offerId: newer.offers[0]!.id, value: 'A-generated-password-12' })),
    ).resolves.toMatchObject({ status: 'filled' });
    expect(older.offers).not.toEqual(newer.offers);
  });
});
