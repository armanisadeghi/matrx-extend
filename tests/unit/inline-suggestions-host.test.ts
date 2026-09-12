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
}));
let runtimeListener:
  | ((
      message: unknown,
      sender: chrome.runtime.MessageSender,
      reply: (value: unknown) => void,
    ) => boolean)
  | null = null;
const targets: chrome.scripting.InjectionTarget[] = [];

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
}));
vi.mock('@/lib/credentials/sensitive-fields', () => ({
  SENSITIVE_ATTR: 'data-matrx-sensitive',
  rememberSensitiveFields: vi.fn(),
}));

function replyFor(message: unknown): Promise<unknown> {
  return new Promise((resolve) => {
    const kept = runtimeListener?.(
      message,
      { tab: { id: 7 }, frameId: 0, documentId: state.documentId } as chrome.runtime.MessageSender,
      resolve,
    );
    expect(kept).toBe(true);
  });
}

beforeEach(() => {
  state.authenticated = true;
  state.organization = ORG;
  state.enabled = true;
  state.documentId = 'doc-7';
  state.matchGate = null;
  state.matchStarted = null;
  state.materializeGate = null;
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
  document.body.innerHTML =
    '<form method="post"><input id="username" autocomplete="username"><input id="password" type="password" autocomplete="current-password"><button type="submit">Sign in</button></form>';
  for (const input of Array.from(document.querySelectorAll('input'))) {
    Object.defineProperty(input, 'getBoundingClientRect', {
      value: () => ({ width: 120, height: 24, top: 10, left: 10, bottom: 34 }),
    });
  }
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      getManifest: () => ({ version: 'test' }),
      onMessage: {
        addListener: (listener: typeof runtimeListener) => {
          runtimeListener = listener;
        },
      },
      sendMessage: async () => undefined,
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
      onRemoved: { addListener: () => undefined },
      onUpdated: { addListener: () => undefined },
    },
    webNavigation: { getFrame: async () => ({ documentId: state.documentId }) },
    storage: { onChanged: { addListener: () => undefined } },
    sidePanel: { open: async () => undefined },
  };
});

afterEach(() => {
  runtimeListener = null;
  vi.resetModules();
  document.body.innerHTML = '';
});

describe('inline saved-login host', () => {
  it('runs the value-bearing fill source after source transfer without module bindings', async () => {
    const { __inlineFillSerializedSourceForTest } = await import(
      '@/lib/credentials/inline-suggestions-host'
    );
    const sourceTransferred = new Function(
      `return (${__inlineFillSerializedSourceForTest});`,
    )() as (
      expected: unknown,
      username: string | null,
      password: string | null,
      sensitiveAttr: string,
    ) => { ok: boolean };
    const result = sourceTransferred(
      {
        anchor: '#password',
        username: '#username',
        password: '#password',
        usernameOnly: false,
        pageUrl: `${location.origin}${location.pathname}`,
      },
      'INLINE_USER_SENTINEL',
      'INLINE_PASSWORD_SENTINEL',
      'data-matrx-sensitive',
    );
    expect(result).toEqual({ ok: true });
    expect((document.querySelector('#password') as HTMLInputElement).value).toBe(
      'INLINE_PASSWORD_SENTINEL',
    );
  });

  it('preserves legacy credential-login scroll, focus, and blur behavior in the shared field primitive', async () => {
    const { fillSensitiveFieldSource } = await import('@/lib/credentials/fill-primitive');
    const input = document.querySelector('#username') as HTMLInputElement & {
      scrollIntoView: (options?: ScrollIntoViewOptions | boolean) => void;
    };
    const scrolls: ScrollIntoViewOptions[] = [];
    input.scrollIntoView = (options) => {
      if (typeof options === 'object') scrolls.push(options);
    };
    let blurred = 0;
    input.addEventListener('blur', () => blurred++);
    const result = fillSensitiveFieldSource(
      '#username',
      'INLINE_USER_SENTINEL',
      'data-matrx-sensitive',
    );
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
      payload: { fieldSelector: '#password' },
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
    const source = new Function(`return (${__inlineFillSerializedSourceForTest});`)() as (
      expected: unknown,
      username: string | null,
      password: string | null,
      attr: string,
    ) => { ok: boolean };
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
    const result = source(
      {
        anchor: '#password',
        username: '#username',
        password: '#password',
        usernameOnly: false,
        pageUrl: `${location.origin}${location.pathname}`,
      },
      'INLINE_USER_SENTINEL',
      'INLINE_PASSWORD_SENTINEL',
      'data-matrx-sensitive',
    );
    expect(result).toEqual({ ok: false });
    expect((document.querySelector('#username') as HTMLInputElement).value).toBe('');
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
      payload: { fieldSelector: '#username' },
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
      payload: { fieldSelector: '#password', url: 'https://attacker.invalid' },
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
      payload: { fieldSelector: '#password' },
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
      payload: { fieldSelector: `#${input.id}` },
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
      payload: { fieldSelector: '#password' },
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
      payload: { fieldSelector: '#password' },
    });
    await firstFetch;
    state.matchGate = null;
    state.matchStarted = null;
    const second = (await replyFor({
      __matrx: true,
      kind: 'credential-suggestions:query',
      payload: { fieldSelector: '#username' },
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
        payload: { fieldSelector: '#password' },
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
});
