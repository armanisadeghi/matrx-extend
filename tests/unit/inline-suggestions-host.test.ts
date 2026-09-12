import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const USER = '00000000-0000-0000-0000-000000000001';
const ORG = '00000000-0000-0000-0000-000000000002';
const ITEM = '00000000-0000-0000-0000-000000000003';
let runtimeListener:
  | ((
      message: unknown,
      sender: chrome.runtime.MessageSender,
      reply: (value: unknown) => void,
    ) => boolean)
  | null = null;
const targets: chrome.scripting.InjectionTarget[] = [];

vi.mock('@/lib/auth/flow', () => ({ getCurrentUser: async () => ({ id: USER }) }));
vi.mock('@/lib/api/routes/vault', () => ({
  hasRealUserToken: async () => true,
  fetchBrowserLoginMatches: async () => ({
    ok: true,
    data: {
      count: 1,
      matches: [
        {
          item_id: ITEM,
          display_name: 'Work account',
          available_fields: [{ field_key: 'username', fillable: true }],
        },
      ],
    },
  }),
  materializeBrowserLogin: async () => ({
    ok: true,
    data: {
      item_id: ITEM,
      origin: globalThis.location.origin,
      fields: { username: 'INLINE_USER_SENTINEL', password: 'INLINE_PASSWORD_SENTINEL' },
    },
  }),
}));
vi.mock('@/lib/org/active-org', () => ({ getActiveOrganizationId: async () => ORG }));
vi.mock('@/lib/settings/persisted', () => ({ readOfferSavedLoginsEnabled: async () => true }));
vi.mock('@/lib/credentials/sensitive-fields', () => ({
  SENSITIVE_ATTR: 'data-matrx-sensitive',
  rememberSensitiveFields: vi.fn(),
}));

function replyFor(message: unknown): Promise<unknown> {
  return new Promise((resolve) => {
    const kept = runtimeListener?.(
      message,
      { tab: { id: 7 }, frameId: 0, documentId: 'doc-7' } as chrome.runtime.MessageSender,
      resolve,
    );
    expect(kept).toBe(true);
  });
}

beforeEach(() => {
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
});
