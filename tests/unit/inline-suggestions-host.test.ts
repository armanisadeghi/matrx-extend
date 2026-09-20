import { mountGenerationTargetRegistry } from '@/lib/credentials/generation-targets';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const USER = '00000000-0000-0000-0000-000000000001';
const ORG = '00000000-0000-0000-0000-000000000002';
const ITEM = '00000000-0000-0000-0000-000000000003';
const state = vi.hoisted(() => ({
  authenticated: true,
  organization: '00000000-0000-0000-0000-000000000002',
  enabled: true,
  matches: [
    {
      item_id: '00000000-0000-0000-0000-000000000003',
      display_name: 'Work account',
      available_fields: [
        { field_key: 'username', fillable: true },
        { field_key: 'password', fillable: true },
      ],
    },
  ],
  documentId: 'doc-7',
  matchGate: null as Promise<void> | null,
  matchStarted: null as (() => void) | null,
  materializeGate: null as Promise<void> | null,
  materializeStarted: null as (() => void) | null,
  materializeCalls: 0,
  finalFrameGate: null as Promise<void> | null,
  finalFrameStarted: null as (() => void) | null,
  getFrameCalls: 0,
  activeTabId: 7,
  frames: new Map<number, { documentId: string; url: string; parentFrameId: number }>(),
  autoOwnerReport: true,
  focusSequence: 0,
}));
const runtimeListeners: Array<
  (
    message: unknown,
    sender: chrome.runtime.MessageSender,
    reply: (value: unknown) => void,
  ) => boolean
> = [];
const tabMessages: Array<{ tabId: number; message: unknown; options: unknown }> = [];
type RuntimeListener =
  | ((
      message: unknown,
      sender: chrome.runtime.MessageSender,
      reply: (value: unknown) => void,
    ) => boolean)
  | undefined;
const targets: chrome.scripting.InjectionTarget[] = [];
const activationListeners: Array<(info: chrome.tabs.TabActiveInfo) => void> = [];

vi.mock('@/lib/auth/flow', () => ({
  getCurrentUser: async () => (state.authenticated ? { id: USER } : null),
}));
vi.mock('@/lib/api/routes/vault', () => ({
  hasRealUserToken: async () => state.authenticated,
  fetchBrowserLoginMatches: async () => {
    state.matchStarted?.();
    await state.matchGate;
    return { ok: true, data: { count: state.matches.length, matches: state.matches } };
  },
  materializeBrowserLogin: async () => {
    state.materializeCalls++;
    state.materializeStarted?.();
    await state.materializeGate;
    return {
      ok: true,
      data: {
        item_id: ITEM,
        origin: globalThis.location.origin,
        fields: { username: 'INLINE_USER_SENTINEL', password: 'INLINE_PASSWORD_SENTINEL' },
      },
    };
  },
}));
vi.mock('@/lib/org/active-org', () => ({
  getActiveOrganizationId: async () => state.organization,
}));
vi.mock('@/lib/settings/persisted', () => ({
  readOfferSavedLoginsEnabled: async () => state.enabled,
  readCredentialAssistancePresentation: async () => 'on_page',
}));
vi.mock('@/lib/credentials/sensitive-fields', () => ({
  SENSITIVE_ATTR: 'data-matrx-sensitive',
  rememberSensitiveFields: vi.fn(),
}));

function dispatchRuntime(
  message: unknown,
  sender: chrome.runtime.MessageSender,
): { kept: boolean[]; replies: unknown[] } {
  const replies: unknown[] = [];
  const kept = runtimeListeners.map((listener) => listener(message, sender, (value) => replies.push(value)));
  return { kept, replies };
}
function replyFor(
  message: unknown,
  tabId = 7,
  documentId = state.documentId,
  frameId = 0,
): Promise<unknown> {
  return new Promise((resolve) => {
    const sender = {
      tab: { id: tabId },
      frameId,
      documentId,
    } as chrome.runtime.MessageSender;
    if (
      state.autoOwnerReport &&
      (message as { kind?: unknown }).kind === 'credential-suggestions:query'
    )
      dispatchRuntime(
        {
          __matrx: true,
          kind: 'credential-suggestions:focus-owner',
          payload: { stamp: 100, sequence: ++state.focusSequence },
        },
        sender,
      );
    const kept = runtimeListeners.map((listener) => listener(message, sender, resolve));
    expect(kept).toContain(true);
  });
}
function replyForPanel(
  message: unknown,
  sender: Partial<chrome.runtime.MessageSender> = {},
): Promise<unknown> {
  return new Promise((resolve) => {
    const panel = {
      id: 'test-extension',
      url: 'chrome-extension://test-extension/sidepanel.html',
      ...sender,
    } as chrome.runtime.MessageSender;
    const kept = runtimeListeners.map((listener) => listener(message, panel, resolve));
    expect(kept).toContain(true);
  });
}
function registeredField(selector: string): { kind: 'registered_input'; id: string } {
  const input = document.querySelector(selector);
  if (!(input instanceof HTMLInputElement))
    throw new Error(`Missing registered input: ${selector}`);
  input.focus();
  const id = mountGenerationTargetRegistry().registerInput(input);
  if (!id) throw new Error(`Could not register input: ${selector}`);
  return { kind: 'registered_input', id };
}

beforeEach(() => {
  state.authenticated = true;
  state.organization = ORG;
  state.enabled = true;
  state.documentId = 'doc-7';
  state.matchGate = null;
  state.matchStarted = null;
  state.materializeGate = null;
  state.materializeStarted = null;
  state.materializeCalls = 0;
  state.finalFrameGate = null;
  state.finalFrameStarted = null;
  state.getFrameCalls = 0;
  state.activeTabId = 7;
  state.frames = new Map([
    [0, { documentId: state.documentId, url: 'https://login.example.test/', parentFrameId: -1 }],
  ]);
  state.autoOwnerReport = true;
  state.focusSequence = 0;
  state.matches = [
    {
      item_id: ITEM,
      display_name: 'Work account',
      available_fields: [
        { field_key: 'username', fillable: true },
        { field_key: 'password', fillable: true },
      ],
    },
  ];
  targets.length = 0;
  tabMessages.length = 0;
  runtimeListeners.length = 0;
  activationListeners.length = 0;
  history.replaceState({}, '', '/');
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  document.body.innerHTML =
    '<form method="post"><input id="username" autocomplete="username"><input id="password" type="password" autocomplete="current-password"><button type="submit">Sign in</button></form>';
  for (const input of Array.from(document.querySelectorAll('input'))) {
    Object.defineProperty(input, 'getBoundingClientRect', {
      value: () => ({ width: 120, height: 24, top: 10, left: 10, bottom: 34 }),
    });
  }
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      id: 'test-extension',
      getManifest: () => ({ version: 'test' }),
      getURL: (path: string) => `chrome-extension://test-extension/${path}`,
      onMessage: {
        addListener: (listener: RuntimeListener) => listener && runtimeListeners.push(listener),
      },
      sendMessage: async (message: unknown) =>
        new Promise<unknown>((resolve) => {
          const sender = {
            tab: { id: 7 },
            frameId: 0,
            documentId: state.documentId,
          } as chrome.runtime.MessageSender;
          const kept = runtimeListeners.map((listener) => listener(message, sender, resolve));
          if (!kept.includes(true)) resolve(undefined);
        }),
    },
    scripting: {
      executeScript: async ({
        target,
        func,
        args,
      }: {
        target: chrome.scripting.InjectionTarget;
        func: (...args: never[]) => unknown;
        args?: unknown[];
      }) => {
        targets.push(target);
        return [{ result: func(...((args ?? []) as never[])) }];
      },
    },
    tabs: {
      get: async (tabId: number) => ({
        id: tabId,
        windowId: 1,
        active: tabId === state.activeTabId,
      }),
      onRemoved: { addListener: () => undefined },
      onUpdated: { addListener: () => undefined },
      onActivated: {
        addListener: (listener: (info: chrome.tabs.TabActiveInfo) => void) =>
          activationListeners.push(listener),
      },
      sendMessage: async (tabId: number, message: unknown, options: unknown) => {
        tabMessages.push({ tabId, message, options });
        const sender = {
          tab: { id: tabId },
          frameId: 0,
          documentId: (options as { documentId?: string } | undefined)?.documentId,
        } as chrome.runtime.MessageSender;
        for (const listener of runtimeListeners) listener(message, sender, () => undefined);
      },
    },
    webNavigation: {
      getFrame: async ({ frameId }: chrome.webNavigation.GetFrameDetails) => {
        state.getFrameCalls++;
        if (state.finalFrameGate && state.getFrameCalls >= 3) {
          state.finalFrameStarted?.();
          await state.finalFrameGate;
        }
        return state.frames.get(frameId) ?? null;
      },
    },
    permissions: { contains: async () => true },
    storage: { onChanged: { addListener: () => undefined } },
    sidePanel: { open: async () => undefined },
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  runtimeListeners.length = 0;
  vi.resetModules();
  document.body.innerHTML = '';
});

describe('inline saved-login host', () => {
  it('returns the settled panel refusal to the clicked capture card', async () => {
    (globalThis.chrome as unknown as { sidePanel: { open: () => Promise<void> } }).sidePanel = {
      open: async () => {
        throw new Error('`sidePanel.open()` may only be called in response to a user gesture.');
      },
    };
    const { registerInlineCredentialSuggestionHost } = await import(
      '@/lib/credentials/inline-suggestions-host'
    );
    registerInlineCredentialSuggestionHost();

    await expect(
      replyFor({
        __matrx: true,
        kind: 'credential-suggestions:open-vault',
        payload: {},
      }),
    ).resolves.toEqual({
      ok: false,
      reason:
        '`sidePanel.open()` may only be called in response to a user gesture. Open Matrx from the browser toolbar and try again.',
    });
  });

  it.each([
    [
      'inline',
      async (offerId: string) =>
        replyFor({
          __matrx: true,
          kind: 'credential-suggestions:fill',
          payload: { offerId, itemId: ITEM },
        }),
    ],
    [
      'panel',
      async () =>
        replyForPanel({
          __matrx: true,
          kind: 'credential-suggestions:panel-fill',
          payload: { tabId: 7, itemId: ITEM },
        }),
    ],
  ])(
    'reports manual review from the bound dispatcher through the %s result map',
    async (_surface, invoke) => {
      const { registerInlineCredentialSuggestionHost } = await import(
        '@/lib/credentials/inline-suggestions-host'
      );
      registerInlineCredentialSuggestionHost();
      (document.querySelector('#password') as HTMLInputElement).focus();
      const query = (await replyFor({
        __matrx: true,
        kind: 'credential-suggestions:query',
        payload: { field: registeredField('#password') },
      })) as { status: string; offerId: string };
      expect(query.status).toBe('ready');
      const original = chrome.scripting.executeScript;
      chrome.scripting.executeScript = (async (details) => {
        const request = (details as { args?: Array<{ operation?: string }> }).args?.[0];
        if (request?.operation === 'fill')
          return [{ result: { ok: false, reason: 'partial_manual_check' } }];
        return original(details);
      }) as typeof chrome.scripting.executeScript;
      const result = await invoke(query.offerId);
      expect(result).toEqual({
        status: 'partial_manual_check',
        message: 'Matrx could not fully restore the login fields. Review them before signing in.',
      });
      expect(state.materializeCalls).toBe(1);
      expect((document.querySelector('#username') as HTMLInputElement).value).toBe('');
      expect((document.querySelector('#password') as HTMLInputElement).value).toBe('');
    },
  );

  it('refuses forged panel callers and projects only eligible IDs to the sidepanel', async () => {
    const { registerInlineCredentialSuggestionHost } = await import(
      '@/lib/credentials/inline-suggestions-host'
    );
    registerInlineCredentialSuggestionHost();
    const query = await replyFor({
      __matrx: true,
      kind: 'credential-suggestions:query',
      payload: { field: registeredField('#password') },
    });
    expect((query as { status: string }).status).toBe('ready');
    const status = await replyForPanel({
      __matrx: true,
      kind: 'credential-suggestions:panel-status',
      payload: { tabId: 7 },
    });
    expect(status).toEqual({ status: 'ready', itemIds: [ITEM] });
    const replies: unknown[] = [];
    for (const listener of runtimeListeners)
      replies.push(
        listener(
          { __matrx: true, kind: 'credential-suggestions:panel-status', payload: { tabId: 7 } },
          {
            id: 'test-extension',
            url: 'chrome-extension://test-extension/options.html',
          } as chrome.runtime.MessageSender,
          () => undefined,
        ),
      );
    expect(replies).not.toContain(true);
  });

  it('does not write after activation changes away and back while panel materialization waits', async () => {
    const { registerInlineCredentialSuggestionHost } = await import(
      '@/lib/credentials/inline-suggestions-host'
    );
    registerInlineCredentialSuggestionHost();
    (document.querySelector('#password') as HTMLInputElement).focus();
    await replyFor({
      __matrx: true,
      kind: 'credential-suggestions:query',
      payload: { field: registeredField('#password') },
    });
    let release!: () => void;
    state.materializeGate = new Promise((resolve) => {
      release = resolve;
    });
    let materializing!: () => void;
    const materializingNow = new Promise<void>((resolve) => {
      materializing = resolve;
    });
    state.materializeStarted = materializing;
    const filling = replyForPanel({
      __matrx: true,
      kind: 'credential-suggestions:panel-fill',
      payload: { tabId: 7, itemId: ITEM },
    });
    await materializingNow;
    state.activeTabId = 8;
    for (const listener of activationListeners) listener({ tabId: 8, windowId: 1 });
    state.activeTabId = 7;
    for (const listener of activationListeners) listener({ tabId: 7, windowId: 1 });
    release();
    expect(await filling).toMatchObject({ status: 'stale' });
    expect(targets.filter((target) => target.documentIds?.[0] === 'doc-7')).toHaveLength(2);
    expect((document.querySelector('#username') as HTMLInputElement).value).toBe('');
    expect((document.querySelector('#password') as HTMLInputElement).value).toBe('');
  });

  it('claims a panel offer synchronously so duplicate clicks materialize once', async () => {
    const { registerInlineCredentialSuggestionHost } = await import(
      '@/lib/credentials/inline-suggestions-host'
    );
    registerInlineCredentialSuggestionHost();
    (document.querySelector('#password') as HTMLInputElement).focus();
    await replyFor({
      __matrx: true,
      kind: 'credential-suggestions:query',
      payload: { field: registeredField('#password') },
    });
    let release!: () => void;
    state.materializeGate = new Promise((resolve) => {
      release = resolve;
    });
    const first = replyForPanel({
      __matrx: true,
      kind: 'credential-suggestions:panel-fill',
      payload: { tabId: 7, itemId: ITEM },
    });
    const second = replyForPanel({
      __matrx: true,
      kind: 'credential-suggestions:panel-fill',
      payload: { tabId: 7, itemId: ITEM },
    });
    await vi.waitFor(() => expect(state.materializeCalls).toBe(1));
    release();
    expect(await second).toMatchObject({ status: 'stale' });
    expect(await first).toMatchObject({ status: 'filled' });
    expect((document.querySelector('#username') as HTMLInputElement).value).toBe(
      'INLINE_USER_SENTINEL',
    );
    expect((document.querySelector('#password') as HTMLInputElement).value).toBe(
      'INLINE_PASSWORD_SENTINEL',
    );
  });
  it('refuses a same-actor auth invalidation after the panel offer was claimed', async () => {
    const { registerInlineCredentialSuggestionHost } = await import(
      '@/lib/credentials/inline-suggestions-host'
    );
    registerInlineCredentialSuggestionHost();
    (document.querySelector('#password') as HTMLInputElement).focus();
    await replyFor({
      __matrx: true,
      kind: 'credential-suggestions:query',
      payload: { field: registeredField('#password') },
    });
    let release!: () => void;
    let reached!: () => void;
    state.materializeGate = new Promise((r) => {
      release = r;
    });
    const started = new Promise<void>((r) => {
      reached = r;
    });
    state.materializeStarted = reached;
    const fill = replyForPanel({
      __matrx: true,
      kind: 'credential-suggestions:panel-fill',
      payload: { tabId: 7, itemId: ITEM },
    });
    await started;
    for (const listener of runtimeListeners)
      listener(
        { __matrx: true, kind: 'auth:state-changed', payload: {} },
        {} as chrome.runtime.MessageSender,
        () => {},
      );
    release();
    expect(await fill).toMatchObject({ status: 'stale' });
    expect((document.querySelector('#password') as HTMLInputElement).value).toBe('');
  });

  it.each(['query-start', 'matching'])(
    'invalidates a query activated away during %s',
    async (stage) => {
      const { registerInlineCredentialSuggestionHost } = await import(
        '@/lib/credentials/inline-suggestions-host'
      );
      registerInlineCredentialSuggestionHost();
      let release!: () => void;
      let reached!: () => void;
      const gate = new Promise<void>((r) => {
        release = r;
      });
      const started = new Promise<void>((r) => {
        reached = r;
      });
      if (stage === 'matching') {
        state.matchGate = gate;
        state.matchStarted = reached;
      } else {
        const original = chrome.webNavigation.getFrame;
        chrome.webNavigation.getFrame = vi.fn(async (arg: chrome.webNavigation.GetFrameDetails) => {
          reached();
          await gate;
          return original(arg);
        }) as unknown as typeof original;
      }
      (document.querySelector('#password') as HTMLInputElement).focus();
      const query = replyFor({
        __matrx: true,
        kind: 'credential-suggestions:query',
        payload: { field: registeredField('#password') },
      });
      await started;
      for (const tabId of [8, 7])
        for (const listener of activationListeners) listener({ tabId, windowId: 1 });
      release();
      expect(await query).not.toMatchObject({ status: 'ready' });
      expect(
        await replyForPanel({
          __matrx: true,
          kind: 'credential-suggestions:panel-status',
          payload: { tabId: 7 },
        }),
      ).toMatchObject({ status: 'none', itemIds: [] });
    },
  );

  it.each(['tab', 'document'])('rechecks activation after final %s lookup', async (dependency) => {
    const { registerInlineCredentialSuggestionHost } = await import(
      '@/lib/credentials/inline-suggestions-host'
    );
    registerInlineCredentialSuggestionHost();
    (document.querySelector('#password') as HTMLInputElement).focus();
    await replyFor({
      __matrx: true,
      kind: 'credential-suggestions:query',
      payload: { field: registeredField('#password') },
    });
    let release!: () => void;
    let reached!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const started = new Promise<void>((r) => {
      reached = r;
    });
    let calls = 0;
    if (dependency === 'tab') {
      const original = chrome.tabs.get;
      chrome.tabs.get = vi.fn(async (arg: number) => {
        if (++calls === 4) {
          reached();
          await gate;
        }
        return original(arg);
      }) as unknown as typeof original;
    } else {
      const original = chrome.webNavigation.getFrame;
      chrome.webNavigation.getFrame = vi.fn(async (arg: chrome.webNavigation.GetFrameDetails) => {
        if (++calls === 4) {
          reached();
          await gate;
        }
        return original(arg);
      }) as unknown as typeof original;
    }
    const fill = replyForPanel({
      __matrx: true,
      kind: 'credential-suggestions:panel-fill',
      payload: { tabId: 7, itemId: ITEM },
    });
    await started;
    for (const tabId of [8, 7])
      for (const listener of activationListeners) listener({ tabId, windowId: 1 });
    release();
    expect(await fill).toMatchObject({ status: 'stale' });
    expect((document.querySelector('#password') as HTMLInputElement).value).toBe('');
  });

  it.each(['unrelated-first', 'hidden-first', 'unrelated-next', 'hidden-next'])(
    'panel writer refuses %s and clears its partial fill',
    async (mode) => {
      const { registerInlineCredentialSuggestionHost } = await import(
        '@/lib/credentials/inline-suggestions-host'
      );
      registerInlineCredentialSuggestionHost();
      const username = document.querySelector('#username') as HTMLInputElement;
      const password = document.querySelector('#password') as HTMLInputElement;
      const other = document.createElement('input');
      document.body.append(other);
      password.focus();
      await replyFor({
        __matrx: true,
        kind: 'credential-suggestions:query',
        payload: { field: registeredField('#password') },
      });
      const alter = () => {
        if (mode.startsWith('hidden'))
          vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
        else other.focus();
      };
      if (mode.endsWith('first')) alter();
      else username.addEventListener('input', alter, { once: true });
      expect(
        await replyForPanel({
          __matrx: true,
          kind: 'credential-suggestions:panel-fill',
          payload: { tabId: 7, itemId: ITEM },
        }),
      ).toMatchObject({ status: 'stale' });
      expect(username.value).toBe('');
      expect(password.value).toBe('');
      vi.restoreAllMocks();
    },
  );

  it('runs the value-bearing dispatcher after source transfer without module bindings', async () => {
    const { __inlineFillSerializedSourceForTest } = await import(
      '@/lib/credentials/inline-suggestions-host'
    );
    const sourceTransferred = new Function(
      `return (${__inlineFillSerializedSourceForTest});`,
    )() as typeof import('@/lib/credentials/fill-primitive').credentialDomSource;
    const result = sourceTransferred({
      operation: 'fill',
      expected: {
        anchor: '#password',
        username: '#username',
        password: '#password',
        usernameOnly: false,
        pageUrl: `${location.origin}${location.pathname}`,
      },
      requested: [
        { selector: '#username', value: 'INLINE_USER_SENTINEL' },
        { selector: '#password', value: 'INLINE_PASSWORD_SENTINEL' },
      ],
      sensitiveAttr: 'data-matrx-sensitive',
      preserveLegacyFieldBehavior: false,
    });
    expect(result).toEqual({ ok: true });
    expect((document.querySelector('#password') as HTMLInputElement).value).toBe(
      'INLINE_PASSWORD_SENTINEL',
    );
  });

  it('preserves legacy credential-login scroll, focus, and blur behavior in the shared dispatcher', async () => {
    const { credentialDomSource } = await import('@/lib/credentials/fill-primitive');
    const input = document.querySelector('#username') as HTMLInputElement & {
      scrollIntoView: (options?: ScrollIntoViewOptions | boolean) => void;
    };
    const scrolls: ScrollIntoViewOptions[] = [];
    input.scrollIntoView = (options) => {
      if (typeof options === 'object') scrolls.push(options);
    };
    let blurred = 0;
    input.addEventListener('blur', () => blurred++);
    const result = credentialDomSource({
      operation: 'fill',
      expected: null,
      requested: [{ selector: '#username', value: 'INLINE_USER_SENTINEL' }],
      sensitiveAttr: 'data-matrx-sensitive',
      preserveLegacyFieldBehavior: true,
    });
    expect(result).toEqual({ ok: true });
    expect(scrolls).toEqual([{ block: 'center', behavior: 'instant' }]);
    expect(document.activeElement).toBe(input);
    expect(blurred).toBe(1);
  });

  it('fills a bound POST login form once without submitting it', async () => {
    const { registerInlineCredentialSuggestionHost } = await import(
      '@/lib/credentials/inline-suggestions-host'
    );
    registerInlineCredentialSuggestionHost();
    let submits = 0;
    document.querySelector('form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      submits++;
    });
    const query = (await replyFor({
      __matrx: true,
      kind: 'credential-suggestions:query',
      payload: { field: registeredField('#password') },
    })) as { status: string; offerId: string; matches: Array<{ item_id: string }> };
    expect(query.status).toBe('ready');
    expect(query.matches).toEqual([{ item_id: ITEM, display_name: 'Work account' }]);
    const fill = (await replyFor({
      __matrx: true,
      kind: 'credential-suggestions:fill',
      payload: { offerId: query.offerId, itemId: ITEM },
    })) as { status: string };
    expect(fill.status).toBe('filled');
    expect((document.querySelector('#username') as HTMLInputElement).value).toBe(
      'INLINE_USER_SENTINEL',
    );
    expect((document.querySelector('#password') as HTMLInputElement).value).toBe(
      'INLINE_PASSWORD_SENTINEL',
    );
    expect(submits).toBe(0);
    expect(targets.every((target) => target.documentIds?.[0] === 'doc-7')).toBe(true);
    const duplicate = (await replyFor({
      __matrx: true,
      kind: 'credential-suggestions:fill',
      payload: { offerId: query.offerId, itemId: ITEM },
    })) as { status: string };
    expect(duplicate.status).toBe('stale');
  });

  it('refuses a replacement password control after the username input event', async () => {
    const { __inlineFillSerializedSourceForTest } = await import(
      '@/lib/credentials/inline-suggestions-host'
    );
    const source = new Function(
      `return (${__inlineFillSerializedSourceForTest});`,
    )() as typeof import('@/lib/credentials/fill-primitive').credentialDomSource;
    const username = document.querySelector('#username') as HTMLInputElement;
    username.addEventListener('input', () => {
      document.querySelector('#password')?.replaceWith(
        Object.assign(document.createElement('input'), {
          id: 'password',
          type: 'password',
          autocomplete: 'current-password',
        }),
      );
      const replacement = document.querySelector('#password') as HTMLInputElement;
      Object.defineProperty(replacement, 'getBoundingClientRect', {
        value: () => ({ width: 120, height: 24, top: 10, left: 10, bottom: 34 }),
      });
    });
    const result = source({
      operation: 'fill',
      expected: {
        anchor: '#password',
        username: '#username',
        password: '#password',
        usernameOnly: false,
        pageUrl: `${location.origin}${location.pathname}`,
      },
      requested: [
        { selector: '#username', value: 'INLINE_USER_SENTINEL' },
        { selector: '#password', value: 'INLINE_PASSWORD_SENTINEL' },
      ],
      sensitiveAttr: 'data-matrx-sensitive',
      preserveLegacyFieldBehavior: false,
    });
    expect(result).toEqual({ ok: false, reason: 'partial_manual_check' });
    expect((document.querySelector('#username') as HTMLInputElement).value).toBe('');
    expect((document.querySelector('#password') as HTMLInputElement).value).toBe('');
  });

  it('clears the exact connected username after same-document history mutation', async () => {
    const { __inlineFillSerializedSourceForTest } = await import(
      '@/lib/credentials/inline-suggestions-host'
    );
    const source = new Function(
      `return (${__inlineFillSerializedSourceForTest});`,
    )() as typeof import('@/lib/credentials/fill-primitive').credentialDomSource;
    const username = document.querySelector('#username') as HTMLInputElement;
    username.addEventListener('input', () => history.pushState({}, '', '/login-next'));
    const result = source({
      operation: 'fill',
      expected: {
        anchor: '#password',
        username: '#username',
        password: '#password',
        usernameOnly: false,
        pageUrl: `${location.origin}/`,
      },
      requested: [
        { selector: '#username', value: 'INLINE_USER_SENTINEL' },
        { selector: '#password', value: 'INLINE_PASSWORD_SENTINEL' },
      ],
      sensitiveAttr: 'data-matrx-sensitive',
      preserveLegacyFieldBehavior: false,
    });
    expect(result).toEqual({ ok: false });
    expect(username.value).toBe('');
    expect((document.querySelector('#password') as HTMLInputElement).value).toBe('');
  });

  it('fills an explicit username-only continuation without advancing', async () => {
    document.body.innerHTML =
      '<form method="post"><input id="username" autocomplete="username"></form>';
    const input = document.querySelector('#username') as HTMLInputElement;
    Object.defineProperty(input, 'getBoundingClientRect', {
      value: () => ({ width: 120, height: 24, top: 10, left: 10, bottom: 34 }),
    });
    state.matches = [
      {
        item_id: ITEM,
        display_name: 'Work account',
        available_fields: [{ field_key: 'username', fillable: true }],
      },
    ];
    const { registerInlineCredentialSuggestionHost } = await import(
      '@/lib/credentials/inline-suggestions-host'
    );
    registerInlineCredentialSuggestionHost();
    const query = (await replyFor({
      __matrx: true,
      kind: 'credential-suggestions:query',
      payload: { field: registeredField('#username') },
    })) as { status: string; offerId: string };
    expect(query.status).toBe('ready');
    const fill = (await replyFor({
      __matrx: true,
      kind: 'credential-suggestions:fill',
      payload: { offerId: query.offerId, itemId: ITEM },
    })) as { status: string };
    expect(fill.status).toBe('filled');
    expect(input.value).toBe('INLINE_USER_SENTINEL');
  });

  it('rejects payloads that carry an extra selector or URL', async () => {
    const { registerInlineCredentialSuggestionHost } = await import(
      '@/lib/credentials/inline-suggestions-host'
    );
    registerInlineCredentialSuggestionHost();
    const result = (await replyFor({
      __matrx: true,
      kind: 'credential-suggestions:query',
      payload: { field: registeredField('#password'), url: 'https://attacker.invalid' },
    })) as { status: string };
    expect(result.status).toBe('unsafe_destination');
  });

  it('refuses to query when Chrome cannot document-target the injection', async () => {
    const { registerInlineCredentialSuggestionHost } = await import(
      '@/lib/credentials/inline-suggestions-host'
    );
    registerInlineCredentialSuggestionHost();
    (globalThis as { chrome: { webNavigation?: unknown } }).chrome.webNavigation = undefined;
    const result = (await replyFor({
      __matrx: true,
      kind: 'credential-suggestions:query',
      payload: { field: registeredField('#password') },
    })) as { status: string };
    expect(result.status).toBe('unavailable');
  });

  it.each([
    '<form method="get"><input id="password" type="password" autocomplete="current-password"></form>',
    '<form method="post" action="https://attacker.invalid"><input id="password" type="password" autocomplete="current-password"></form>',
    '<form method="post"><input id="password" type="password" autocomplete="new-password"></form>',
    '<form method="post"><input id="otp" autocomplete="one-time-code"></form>',
  ])('refuses hostile login shapes: %s', async (html) => {
    document.body.innerHTML = html;
    const input = document.querySelector('input') as HTMLInputElement;
    Object.defineProperty(input, 'getBoundingClientRect', {
      value: () => ({ width: 120, height: 24, top: 10, left: 10, bottom: 34 }),
    });
    const { registerInlineCredentialSuggestionHost } = await import(
      '@/lib/credentials/inline-suggestions-host'
    );
    registerInlineCredentialSuggestionHost();
    const result = (await replyFor({
      __matrx: true,
      kind: 'credential-suggestions:query',
      payload: { field: registeredField(`#${input.id}`) },
    })) as { status: string };
    expect(result.status).toBe('unsafe_destination');
  });

  it('invalidates a pending offer when its document identity changes', async () => {
    const { registerInlineCredentialSuggestionHost } = await import(
      '@/lib/credentials/inline-suggestions-host'
    );
    registerInlineCredentialSuggestionHost();
    const query = (await replyFor({
      __matrx: true,
      kind: 'credential-suggestions:query',
      payload: { field: registeredField('#password') },
    })) as { status: string; offerId: string };
    state.documentId = 'replacement-document';
    const result = (await replyFor({
      __matrx: true,
      kind: 'credential-suggestions:fill',
      payload: { offerId: query.offerId, itemId: ITEM },
    })) as { status: string };
    expect(result.status).toBe('stale');
    expect((document.querySelector('#password') as HTMLInputElement).value).toBe('');
  });

  it('refuses a selected child after a same-URL sibling replaces its frozen document identity', async () => {
    state.documentId = 'child-a';
    state.frames = new Map([
      [0, { documentId: 'top-document', url: 'https://login.example.test/', parentFrameId: -1 }],
      [11, { documentId: 'child-a', url: 'https://login.example.test/embed', parentFrameId: 0 }],
      [12, { documentId: 'child-b', url: 'https://login.example.test/embed', parentFrameId: 0 }],
    ]);
    const { registerInlineCredentialSuggestionHost } = await import(
      '@/lib/credentials/inline-suggestions-host'
    );
    registerInlineCredentialSuggestionHost();
    const query = (await replyFor(
      {
        __matrx: true,
        kind: 'credential-suggestions:query',
        payload: { field: registeredField('#password') },
      },
      7,
      'child-a',
      11,
    )) as { status: string; offerId: string };
    expect(query.status).toBe('ready');

    // The URL is deliberately unchanged. Only Chrome's document identity is
    // allowed to bind an offer to the selected sibling.
    state.frames.set(11, {
      documentId: 'child-b',
      url: 'https://login.example.test/embed',
      parentFrameId: 0,
    });
    const fill = (await replyFor(
      {
        __matrx: true,
        kind: 'credential-suggestions:fill',
        payload: { offerId: query.offerId, itemId: ITEM },
      },
      7,
      'child-a',
      11,
    )) as { status: string };
    expect(fill.status).not.toBe('filled');
    expect(state.materializeCalls).toBe(0);
    expect((document.querySelector('#username') as HTMLInputElement).value).toBe('');
    expect((document.querySelector('#password') as HTMLInputElement).value).toBe('');
  });

  it('rejects a child offer after its parent becomes the newer focus owner', async () => {
    state.documentId = 'child-a';
    state.frames = new Map([
      [0, { documentId: 'top-document', url: 'https://login.example.test/', parentFrameId: -1 }],
      [11, { documentId: 'child-a', url: 'https://login.example.test/embed', parentFrameId: 0 }],
    ]);
    const { registerInlineCredentialSuggestionHost } = await import(
      '@/lib/credentials/inline-suggestions-host'
    );
    registerInlineCredentialSuggestionHost();
    const query = (await replyFor(
      {
        __matrx: true,
        kind: 'credential-suggestions:query',
        payload: { field: registeredField('#password') },
      },
      7,
      'child-a',
      11,
    )) as { status: string };
    expect(query.status).toBe('ready');
    dispatchRuntime(
      { __matrx: true, kind: 'credential-suggestions:focus-owner', payload: { stamp: 200, sequence: 1 } },
      { tab: { id: 7 }, frameId: 0, documentId: 'top-document' } as chrome.runtime.MessageSender,
    );
    await expect(replyForPanel({
      __matrx: true,
      kind: 'credential-suggestions:panel-status',
      payload: { tabId: 7 },
    })).resolves.toEqual({ status: 'none', itemIds: [] });
    await expect(replyForPanel({
      __matrx: true,
      kind: 'credential-suggestions:panel-fill',
      payload: { tabId: 7, itemId: ITEM },
    })).resolves.toMatchObject({ status: 'stale' });
    expect(state.materializeCalls).toBe(0);
  });

  it('ignores a delayed old child focus report and preserves the newer parent owner', async () => {
    state.documentId = 'child-a';
    state.frames = new Map([
      [0, { documentId: 'top-document', url: 'https://login.example.test/', parentFrameId: -1 }],
      [11, { documentId: 'child-a', url: 'https://login.example.test/embed', parentFrameId: 0 }],
    ]);
    const { registerInlineCredentialSuggestionHost } = await import(
      '@/lib/credentials/inline-suggestions-host'
    );
    registerInlineCredentialSuggestionHost();
    const query = await replyFor(
      {
        __matrx: true,
        kind: 'credential-suggestions:query',
        payload: { field: registeredField('#password') },
      },
      7,
      'child-a',
      11,
    );
    expect((query as { status: string }).status).toBe('ready');
    dispatchRuntime(
      { __matrx: true, kind: 'credential-suggestions:focus-owner', payload: { stamp: 200, sequence: 1 } },
      { tab: { id: 7 }, frameId: 0, documentId: 'top-document' } as chrome.runtime.MessageSender,
    );
    dispatchRuntime(
      { __matrx: true, kind: 'credential-suggestions:focus-owner', payload: { stamp: 100, sequence: 99 } },
      { tab: { id: 7 }, frameId: 11, documentId: 'child-a' } as chrome.runtime.MessageSender,
    );
    await expect(replyForPanel({
      __matrx: true,
      kind: 'credential-suggestions:panel-status',
      payload: { tabId: 7 },
    })).resolves.toEqual({ status: 'none', itemIds: [] });
  });

  it('does not mint an offer when focus ownership changes during matching', async () => {
    state.documentId = 'child-a';
    state.frames = new Map([
      [0, { documentId: 'top-document', url: 'https://login.example.test/', parentFrameId: -1 }],
      [11, { documentId: 'child-a', url: 'https://login.example.test/embed', parentFrameId: 0 }],
    ]);
    const { registerInlineCredentialSuggestionHost } = await import(
      '@/lib/credentials/inline-suggestions-host'
    );
    registerInlineCredentialSuggestionHost();
    let release!: () => void;
    let matching!: () => void;
    state.matchGate = new Promise((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { matching = resolve; });
    state.matchStarted = matching;
    const query = replyFor(
      {
        __matrx: true,
        kind: 'credential-suggestions:query',
        payload: { field: registeredField('#password') },
      },
      7,
      'child-a',
      11,
    );
    await started;
    dispatchRuntime(
      { __matrx: true, kind: 'credential-suggestions:focus-owner', payload: { stamp: 200, sequence: 1 } },
      { tab: { id: 7 }, frameId: 0, documentId: 'top-document' } as chrome.runtime.MessageSender,
    );
    release();
    await expect(query).resolves.toMatchObject({ status: 'unsafe_destination' });
  });

  it('fails closed for equal-stamp cross-frame focus conflicts until a strictly newer owner report', async () => {
    state.documentId = 'child-a';
    state.autoOwnerReport = false;
    state.frames = new Map([
      [0, { documentId: 'top-document', url: 'https://login.example.test/', parentFrameId: -1 }],
      [11, { documentId: 'child-a', url: 'https://login.example.test/embed', parentFrameId: 0 }],
    ]);
    const { registerInlineCredentialSuggestionHost } = await import(
      '@/lib/credentials/inline-suggestions-host'
    );
    registerInlineCredentialSuggestionHost();
    const owner = (frameId: number, documentId: string, stamp: number, sequence: number) =>
      dispatchRuntime(
        { __matrx: true, kind: 'credential-suggestions:focus-owner', payload: { stamp, sequence } },
        { tab: { id: 7 }, frameId, documentId } as chrome.runtime.MessageSender,
      );
    owner(11, 'child-a', 100, 10);
    const initial = (await replyFor(
      { __matrx: true, kind: 'credential-suggestions:query', payload: { field: registeredField('#password') } },
      7, 'child-a', 11,
    )) as { status: string };
    expect(initial.status).toBe('ready');
    owner(0, 'top-document', 100, 1);
    owner(11, 'child-a', 100, 11);
    await expect(replyForPanel({
      __matrx: true,
      kind: 'credential-suggestions:panel-fill',
      payload: { tabId: 7, itemId: ITEM },
    })).resolves.toMatchObject({ status: 'stale' });
    expect(state.materializeCalls).toBe(0);
    owner(11, 'child-a', 101, 1);
    const fresh = (await replyFor(
      { __matrx: true, kind: 'credential-suggestions:query', payload: { field: registeredField('#password') } },
      7, 'child-a', 11,
    )) as { status: string };
    expect(fresh.status).toBe('ready');
  });

  it('rejects an older query when a newer focused query wins the race', async () => {
    const { registerInlineCredentialSuggestionHost } = await import(
      '@/lib/credentials/inline-suggestions-host'
    );
    registerInlineCredentialSuggestionHost();
    let release!: () => void;
    let started!: () => void;
    state.matchGate = new Promise((resolve) => {
      release = resolve;
    });
    const firstFetch = new Promise<void>((resolve) => {
      started = resolve;
    });
    state.matchStarted = started;
    const first = replyFor({
      __matrx: true,
      kind: 'credential-suggestions:query',
      payload: { field: registeredField('#password') },
    });
    await firstFetch;
    state.matchGate = null;
    state.matchStarted = null;
    const second = (await replyFor({
      __matrx: true,
      kind: 'credential-suggestions:query',
      payload: { field: registeredField('#username') },
    })) as { status: string };
    release();
    const older = (await first) as { status: string };
    expect(second.status).toBe('ready');
    expect(older.status).toBe('unsafe_destination');
  });

  it.each(['auth', 'organization', 'privacy'])(
    'refuses a fill when %s changes while materialization is in flight',
    async (change) => {
      const { registerInlineCredentialSuggestionHost } = await import(
        '@/lib/credentials/inline-suggestions-host'
      );
      registerInlineCredentialSuggestionHost();
      const query = (await replyFor({
        __matrx: true,
        kind: 'credential-suggestions:query',
        payload: { field: registeredField('#password') },
      })) as { status: string; offerId: string };
      let release!: () => void;
      state.materializeGate = new Promise((resolve) => {
        release = resolve;
      });
      const filling = replyFor({
        __matrx: true,
        kind: 'credential-suggestions:fill',
        payload: { offerId: query.offerId, itemId: ITEM },
      });
      await Promise.resolve();
      if (change === 'auth') state.authenticated = false;
      if (change === 'organization') state.organization = '00000000-0000-0000-0000-000000000099';
      if (change === 'privacy') state.enabled = false;
      release();
      const result = (await filling) as { status: string };
      expect(['stale', 'unavailable']).toContain(result.status);
      expect((document.querySelector('#password') as HTMLInputElement).value).toBe('');
    },
  );

  it('rechecks generation after the final current-document await before secret injection', async () => {
    const { registerInlineCredentialSuggestionHost } = await import(
      '@/lib/credentials/inline-suggestions-host'
    );
    registerInlineCredentialSuggestionHost();
    const query = (await replyFor({
      __matrx: true,
      kind: 'credential-suggestions:query',
      payload: { field: registeredField('#password') },
    })) as { status: string; offerId: string };
    let releaseFrame!: () => void;
    let finalFrameReached!: () => void;
    state.finalFrameGate = new Promise((resolve) => {
      releaseFrame = resolve;
    });
    const finalFrame = new Promise<void>((resolve) => {
      finalFrameReached = resolve;
    });
    state.finalFrameStarted = finalFrameReached;
    const filling = replyFor({
      __matrx: true,
      kind: 'credential-suggestions:fill',
      payload: { offerId: query.offerId, itemId: ITEM },
    });
    await finalFrame;
    const authResults = runtimeListeners.map((listener) =>
      listener(
        { __matrx: true, kind: 'auth:state-changed', payload: {} },
        {} as chrome.runtime.MessageSender,
        () => undefined,
      ),
    );
    expect(authResults).toContain(false);
    releaseFrame();
    expect((await filling) as { status: string }).toMatchObject({ status: 'stale' });
    expect((document.querySelector('#username') as HTMLInputElement).value).toBe('');
    expect((document.querySelector('#password') as HTMLInputElement).value).toBe('');
  });

  it('fans auth invalidation from the SW to the mounted content receiver at its exact document', async () => {
    const { registerInlineCredentialSuggestionHost } = await import(
      '@/lib/credentials/inline-suggestions-host'
    );
    const { mountInlineCredentialSuggestions } = await import(
      '@/lib/credentials/inline-suggestions'
    );
    registerInlineCredentialSuggestionHost();
    mountInlineCredentialSuggestions();
    const target = document.querySelector('#password') as HTMLInputElement;
    target.focus();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const callsBefore = state.getFrameCalls;
    for (const listener of runtimeListeners)
      listener(
        { __matrx: true, kind: 'auth:state-changed', payload: {} },
        {} as chrome.runtime.MessageSender,
        () => undefined,
      );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(tabMessages).toContainEqual({
      tabId: 7,
      message: {
        __matrx: true,
        kind: 'credential-suggestions:context-changed',
        payload: {},
      },
      options: { documentId: 'doc-7' },
    });
    // tabs.sendMessage invoked the content listener, which re-queried its
    // still-focused field through the real producer/consumer seam.
    expect(state.getFrameCalls).toBeGreaterThan(callsBefore);
  });

  it('globally purges offers and invalidates every affected document on auth change', async () => {
    const { registerInlineCredentialSuggestionHost } = await import(
      '@/lib/credentials/inline-suggestions-host'
    );
    registerInlineCredentialSuggestionHost();
    const first = (await replyFor(
      {
        __matrx: true,
        kind: 'credential-suggestions:query',
        payload: { field: registeredField('#password') },
      },
      7,
      'doc-7',
    )) as { status: string; offerId: string };
    state.activeTabId = 8;
    const second = (await replyFor(
      {
        __matrx: true,
        kind: 'credential-suggestions:query',
        payload: { field: registeredField('#password') },
      },
      8,
      'doc-8',
    )) as { status: string; offerId: string };
    for (const listener of runtimeListeners)
      listener(
        { __matrx: true, kind: 'auth:state-changed', payload: {} },
        {} as chrome.runtime.MessageSender,
        () => undefined,
      );
    expect(tabMessages).toContainEqual({
      tabId: 7,
      message: { __matrx: true, kind: 'credential-suggestions:context-changed', payload: {} },
      options: { documentId: 'doc-7' },
    });
    expect(tabMessages).toContainEqual({
      tabId: 8,
      message: { __matrx: true, kind: 'credential-suggestions:context-changed', payload: {} },
      options: { documentId: 'doc-8' },
    });
    expect(
      await replyFor(
        {
          __matrx: true,
          kind: 'credential-suggestions:fill',
          payload: { offerId: first.offerId, itemId: ITEM },
        },
        7,
        'doc-7',
      ),
    ).toMatchObject({ status: 'stale' });
    expect(
      await replyFor(
        {
          __matrx: true,
          kind: 'credential-suggestions:fill',
          payload: { offerId: second.offerId, itemId: ITEM },
        },
        8,
        'doc-8',
      ),
    ).toMatchObject({ status: 'stale' });
  });

  it('expires an offer by invalidating its exact mounted document without reopening the chooser', async () => {
    vi.useFakeTimers();
    const { registerInlineCredentialSuggestionHost } = await import(
      '@/lib/credentials/inline-suggestions-host'
    );
    const { mountInlineCredentialSuggestions } = await import(
      '@/lib/credentials/inline-suggestions'
    );
    registerInlineCredentialSuggestionHost();
    mountInlineCredentialSuggestions();
    const target = document.querySelector('#password') as HTMLInputElement;
    target.focus();
    await vi.advanceTimersByTimeAsync(0);
    expect(document.querySelector('#matrx-inline-login-suggestion')).not.toBeNull();
    await vi.advanceTimersByTimeAsync(60_001);
    expect(tabMessages).toContainEqual({
      tabId: 7,
      message: {
        __matrx: true,
        kind: 'credential-suggestions:context-changed',
        payload: { requery: false },
      },
      options: { documentId: 'doc-7' },
    });
    expect(document.querySelector('#matrx-inline-login-suggestion')).toBeNull();
    vi.useRealTimers();
  });
});
