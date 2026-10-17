/**
 * Vault side-panel security suite (the extension half).
 *
 * The Vault screens are `@ai-matrx/vault`; this extension supplies the page-side
 * abilities and the save-on-submit writes. Three properties have to hold here,
 * and each one is cheap to break by accident:
 *
 *   1. **Nothing reaches the Vault without a real user JWT.** The extension's
 *      guest fingerprint identity is rejected server-side by design; the client
 *      must short-circuit BEFORE issuing a request so it never depends on that
 *      rejection landing.
 *   2. **Plaintext-bearing writes are silent and unlogged.**
 *   3. **The panel and the `credential_login` tool agree on what "fillable"
 *      means.** Two copies of the destination rule is how a UI starts offering
 *      a fill the handler refuses.
 *
 * The final block greps the feature's own source, because a persistence call
 * added later would pass tsc, pass biome, and silently defeat (2).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  fillOutcomeOf,
  matchErrorOf,
  newPasswordFillOf,
  newPasswordFindOf,
  signInOutcomeOf,
} from '@/features/vault/extension-vault-host';
import {
  isFillablePageUrl,
  isSafeDestination,
  normalizeLoginUrl,
} from '@/lib/credentials/login-urls';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const SENTINEL = 'ZZVAULTREVEALSENTINELZZ';
const ITEM_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

// ── Recorders shared by the route tests ─────────────────────────────────────

interface Call {
  method: string;
  path: string;
  body?: unknown;
  opts?: { silent?: boolean } | undefined;
}
const calls: Call[] = [];
const logCalls: unknown[] = [];
let accessToken: string | null = 'real-user-jwt';
let respond: (call: Call) => { ok: boolean; status: number; data?: unknown; error?: string } =
  () => ({
    ok: false,
    status: 500,
    error: 'no impl',
  });

vi.mock('@/lib/auth/flow', () => ({
  getAccessToken: async () => accessToken,
  refreshAccessToken: async () => null,
}));

vi.mock('@/lib/debug/log', () => {
  const record =
    (level: string) =>
    (source: string, message: string, detail?: unknown, tag?: string): void => {
      logCalls.push({ level, source, message, detail, tag });
    };
  return {
    log: {
      info: record('info'),
      success: record('success'),
      warn: record('warn'),
      error: record('error'),
    },
    captureError: (e: unknown) => ({ message: String(e) }),
  };
});

vi.mock('@/lib/api/matrx-api', async () =>
  (await import('../helpers/wire-bridge')).wireBridge('/api'),
);
vi.mock('@/lib/api/client', () => ({
  STATUS_INVALID_BODY: -1,
  apiGet: async (path: string) => {
    const call: Call = { method: 'GET', path };
    calls.push(call);
    return respond(call);
  },
  apiPost: async (path: string, body: unknown, _signal?: unknown, opts?: { silent?: boolean }) => {
    const call: Call = { method: 'POST', path, body, opts };
    calls.push(call);
    return respond(call);
  },
  apiPatch: async (path: string, body: unknown) => {
    const call: Call = { method: 'PATCH', path, body };
    calls.push(call);
    return respond(call);
  },
  apiPut: async (path: string, body: unknown, _signal?: unknown, opts?: { silent?: boolean }) => {
    const call: Call = { method: 'PUT', path, body, opts };
    calls.push(call);
    return respond(call);
  },
  apiDelete: async (path: string) => {
    const call: Call = { method: 'DELETE', path };
    calls.push(call);
    return respond(call);
  },
}));

beforeEach(() => {
  calls.length = 0;
  logCalls.length = 0;
  accessToken = 'real-user-jwt';
});

// ── 1. The sign-in gate ─────────────────────────────────────────────────────

describe('vault routes — a real user JWT or nothing', () => {
  it('short-circuits EVERY route with sign_in_required and issues no request', async () => {
    accessToken = null;
    const vault = await import('@/lib/api/routes/vault');

    const results = await Promise.all([
      vault.fetchVaultItem(ITEM_ID),
      vault.createVaultItem({ display_name: 'x', fields: [{ field_key: 'password', value: 'x' }] }),
      vault.fetchBrowserLoginMatches('https://example.com/login'),
      vault.updateVaultFieldValue(ITEM_ID, 'field-1', 'x'),
      vault.addVaultField(ITEM_ID, { field_key: 'pin', value: 'x' }),
    ]);

    for (const result of results) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.failure).toEqual({ kind: 'sign_in_required' });
    }
    // The whole point: the guest fingerprint identity never leaves the machine.
    expect(calls).toHaveLength(0);
  });

  it('maps 401 / 403 / 5xx onto distinct, actionable failures', async () => {
    const vault = await import('@/lib/api/routes/vault');
    for (const [status, kind] of [
      [401, 'sign_in_required'],
      [403, 'forbidden'],
      [500, 'server_error'],
    ] as const) {
      respond = () => ({ ok: false, status, error: 'nope' });
      const result = await vault.fetchVaultItem(ITEM_ID);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.failure.kind).toBe(kind);
    }
  });

  it('keeps failed and malformed match responses distinct from a real empty match list', async () => {
    const vault = await import('@/lib/api/routes/vault');

    respond = () => ({ ok: false, status: 403, error: 'forbidden' });
    const forbidden = await vault.fetchBrowserLoginMatches('https://example.com/login');
    expect(forbidden).toEqual({ ok: false, failure: { kind: 'forbidden' } });

    respond = () => ({ ok: false, status: 0, error: 'offline' });
    const offline = await vault.fetchBrowserLoginMatches('https://example.com/login');
    expect(offline).toEqual({ ok: false, failure: { kind: 'server_error', status: 0 } });

    respond = () => ({ ok: true, status: 200, data: { count: 0 } });
    const malformed = await vault.fetchBrowserLoginMatches('https://example.com/login');
    expect(malformed).toEqual({ ok: false, failure: { kind: 'server_error', status: 200 } });

    respond = () => ({ ok: true, status: 200, data: { matches: [], count: 0 } });
    const empty = await vault.fetchBrowserLoginMatches('https://example.com/login');
    expect(empty).toEqual({ ok: true, data: { matches: [], count: 0 } });
  });
});

// ── 2. Plaintext-bearing writes are silent and unlogged ─────────────────────

describe('save-on-submit writes', () => {
  it('sends the plaintext-bearing routes with silent:true and never logs the value', async () => {
    const vault = await import('@/lib/api/routes/vault');
    respond = () => ({ ok: true, status: 200, data: { id: ITEM_ID, display_name: 'x' } });
    await vault.createVaultItem({
      display_name: 'x',
      fields: [{ field_key: 'password', value: SENTINEL }],
    });
    expect(calls[0]?.opts?.silent).toBe(true);

    calls.length = 0;
    respond = () => ({ ok: true, status: 200, data: { id: 'field-1' } });
    await vault.updateVaultFieldValue(ITEM_ID, 'field-1', SENTINEL);
    expect(calls[0]?.method).toBe('PUT');
    expect(calls[0]?.path).toBe(`/api/vault/items/${ITEM_ID}/fields/field-1/value`);
    expect(calls[0]?.opts?.silent).toBe(true);

    calls.length = 0;
    respond = () => ({ ok: true, status: 201, data: { id: 'field-2' } });
    await vault.addVaultField(ITEM_ID, { field_key: 'pin', value: SENTINEL });
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.path).toBe(`/api/vault/items/${ITEM_ID}/fields`);
    expect(calls[0]?.opts?.silent).toBe(true);

    expect(JSON.stringify(logCalls)).not.toContain(SENTINEL);
  });
});

// ── 2b. The page abilities speak the package's codes ────────────────────────

describe('side-panel page abilities (@ai-matrx/vault host)', () => {
  it('maps the focused-frame Fill reply onto the package outcome', () => {
    expect(fillOutcomeOf('filled')).toBe('filled');
    expect(fillOutcomeOf('partial_manual_check')).toBe('partial');
    expect(fillOutcomeOf('stale')).toBe('no_field');
    expect(fillOutcomeOf(undefined)).toBe('unavailable');
    expect(fillOutcomeOf('something-new')).toBe('unavailable');
  });

  it('maps every credential_login status onto a Sign in outcome, unknown last', () => {
    expect(signInOutcomeOf('authenticated')).toBe('signed_in');
    expect(signInOutcomeOf('needs_mfa')).toBe('needs_code');
    expect(signInOutcomeOf('captcha_or_takeover')).toBe('challenge');
    expect(signInOutcomeOf('credentials_rejected')).toBe('rejected');
    expect(signInOutcomeOf('selection_required')).toBe('several');
    expect(signInOutcomeOf('no_matching_login')).toBe('no_match');
    expect(signInOutcomeOf('unsafe_destination')).toBe('unsafe');
    expect(signInOutcomeOf('sign_in_required')).toBe('signed_out');
    expect(signInOutcomeOf('vault_error')).toBe('unknown');
  });

  it('keeps a failed match read a failure, never an empty list', () => {
    expect(matchErrorOf('sign_in_required')).toBe('sign_in_required');
    expect(matchErrorOf('forbidden')).toBe('forbidden');
    expect(matchErrorOf('fill_setup_required')).toBe('fill_setup_required');
    expect(matchErrorOf('server_error')).toBe('server_error');
  });

  it('turns generation offers into targets and refusals into codes', () => {
    expect(
      newPasswordFindOf({
        status: 'ready',
        offers: [
          {
            id: 'o1',
            origin: 'https://a.example.com',
            frameId: 0,
            fieldCount: 2,
            constraints: [],
            expiresAt: 1,
          },
          {
            id: 'o2',
            origin: 'https://b.example.com',
            frameId: 3,
            fieldCount: 1,
            constraints: [],
            expiresAt: 1,
          },
        ],
      }),
    ).toEqual({
      status: 'ready',
      targets: [
        { id: 'o1', origin: 'https://a.example.com', fieldCount: 2, topFrame: true },
        { id: 'o2', origin: 'https://b.example.com', fieldCount: 1, topFrame: false },
      ],
    });
    expect(newPasswordFindOf({ status: 'no_targets', message: 'x' })).toEqual({ status: 'none' });
    expect(newPasswordFindOf({ status: 'unsafe_destination', message: 'x' })).toEqual({
      status: 'unsafe',
    });
    expect(newPasswordFindOf(null)).toEqual({ status: 'unavailable' });
    expect(newPasswordFillOf({ status: 'filled', message: '' })).toBe('filled');
    expect(newPasswordFillOf({ status: 'partial_manual_check', message: '' })).toBe('partial');
    expect(newPasswordFillOf({ status: 'rolled_back', message: '' })).toBe('refused');
    expect(newPasswordFillOf({ status: 'refused_unchanged', message: '' })).toBe('refused');
    expect(newPasswordFillOf(null)).toBe('unavailable');
  });
});

// ── 3. Destination rules — panel and tool must agree ────────────────────────

describe('destination rules', () => {
  it('allows https anywhere and http only on loopback', () => {
    expect(isSafeDestination(new URL('https://accounts.example.com/login'))).toBe(true);
    expect(isSafeDestination(new URL('http://localhost:3000/login'))).toBe(true);
    expect(isSafeDestination(new URL('http://127.0.0.1:8000/login'))).toBe(true);
    expect(isSafeDestination(new URL('http://accounts.example.com/login'))).toBe(false);
    expect(isSafeDestination(new URL('file:///tmp/login.html'))).toBe(false);
    expect(isSafeDestination(new URL('chrome://settings'))).toBe(false);
  });

  it('refuses unparsable and non-web page urls', () => {
    expect(isFillablePageUrl(null)).toBe(false);
    expect(isFillablePageUrl('')).toBe(false);
    expect(isFillablePageUrl('not a url')).toBe(false);
    expect(isFillablePageUrl('chrome-extension://abc/sidepanel.html')).toBe(false);
  });

  it('normalizes a page url to origin+path, dropping query and hash', () => {
    // Query strings carry one-time session state; keeping them would make an
    // `exact` match never fire again.
    expect(normalizeLoginUrl('https://a.example.com/login?next=%2Fx#top')).toBe(
      'https://a.example.com/login',
    );
    expect(normalizeLoginUrl('https://a.example.com')).toBe('https://a.example.com/');
    expect(normalizeLoginUrl('garbage')).toBeNull();
  });

  it('is the SAME rule the credential_login handler enforces', () => {
    // The handler must import it, not re-declare it — a second copy is how a
    // panel starts advertising a fill the tool would refuse.
    const handler = readFileSync(
      join(process.cwd(), 'src/lib/tools/handlers/credential-login.ts'),
      'utf8',
    );
    expect(handler).toContain("from '@/lib/credentials/login-urls'");
    expect(handler).not.toMatch(/function\s+isSafeDestination/);
  });

  it('the panel fills through the shared handler, honouring its browser gate', () => {
    const hook = readFileSync(join(process.cwd(), 'src/features/vault/useVaultPage.ts'), 'utf8');
    // ONE fill implementation: the panel calls the handler, it does not
    // re-derive origins, re-detect fields, or call materialize itself.
    expect(hook).toContain('credential_login.run(');
    expect(hook).not.toContain('materializeBrowserLogin');
    // Calling run() directly skips the SW dispatcher, which is where the
    // per-browser gate normally lives — the panel must apply it itself.
    expect(hook).toContain('isBrowserSupported(credential_login.supportedBrowsers)');
  });
});

// ── 4. Nothing in this feature persists a credential ────────────────────────

describe('no-persistence guard', () => {
  const FILES = [
    'src/lib/api/routes/vault.ts',
    'src/lib/credentials/login-urls.ts',
    'src/features/vault/useVaultPage.ts',
    'src/features/vault/extension-vault-host.ts',
    'src/features/vault/VaultView.tsx',
  ];
  // `chrome.tabs` is fine (opening the web vault); persistence is not.
  const BANNED = ['chrome.storage', 'localStorage', 'sessionStorage', 'indexedDB', 'IDBFactory'];

  /** Comments NAME these APIs to forbid them — scan the code, not the prose. */
  function stripComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  }

  for (const file of FILES) {
    it(`${file} never touches a persistence API`, () => {
      const code = stripComments(readFileSync(join(process.cwd(), file), 'utf8'));
      for (const api of BANNED) {
        expect(code, `${file} must not reference ${api}`).not.toContain(api);
      }
    });
  }

  it('the panel never reveals a value itself: the package screens own reveal', () => {
    for (const file of ['src/features/vault/VaultView.tsx', 'src/features/vault/useVaultPage.ts']) {
      const code = readFileSync(join(process.cwd(), file), 'utf8');
      expect(code).not.toContain('materializeBrowserLogin');
      expect(code).not.toMatch(/\/reveal\b/);
    }
  });
});
