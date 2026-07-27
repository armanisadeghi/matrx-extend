/**
 * Vault side-panel security suite.
 *
 * The panel is the first surface in this extension that shows a user their own
 * credentials. Three properties have to hold, and each one is cheap to break by
 * accident:
 *
 *   1. **Nothing reaches the Vault without a real user JWT.** The extension's
 *      guest fingerprint identity is rejected server-side by design; the client
 *      must short-circuit BEFORE issuing a request so it never depends on that
 *      rejection landing.
 *   2. **A revealed value is transient and unlogged.** It lives in one
 *      auto-clearing holder, never in a log line, never in storage.
 *   3. **The panel and the `credential_login` tool agree on what "fillable"
 *      and "already covered" mean.** Two copies of the destination rule is how
 *      a UI starts offering a fill the handler refuses.
 *
 * The final block greps the feature's own source, because a persistence call
 * added later would pass tsc, pass biome, and silently defeat (2).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  coversPage,
  isFillablePageUrl,
  isSafeDestination,
  loginUrlLabel,
  normalizeLoginUrl,
  primaryHost,
  withPageAdded,
} from '@/lib/credentials/login-urls';
import { createTransientSecret } from '@/lib/credentials/transient-secret';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
      vault.fetchMyVaultItems(),
      vault.fetchVaultItemsSharedWithMe(),
      vault.fetchVaultItem(ITEM_ID),
      vault.updateVaultItemMetadata(ITEM_ID, { browser_fill_enabled: true }),
      vault.createVaultItem({ display_name: 'x', fields: [{ field_key: 'password', value: 'x' }] }),
      vault.revealVaultField(ITEM_ID, 'password'),
      vault.fetchBrowserLoginMatches('https://example.com/login'),
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
      const result = await vault.fetchMyVaultItems();
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.failure.kind).toBe(kind);
    }
  });
});

// ── 2. Reveal is transient, silent, and unlogged ────────────────────────────

describe('reveal', () => {
  it('returns the value to the caller and never puts it in a log line', async () => {
    const vault = await import('@/lib/api/routes/vault');
    respond = () => ({
      ok: true,
      status: 200,
      data: { item_id: ITEM_ID, field_key: 'password', value: SENTINEL },
    });

    const result = await vault.revealVaultField(ITEM_ID, 'password');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toBe(SENTINEL);

    const loggedText = JSON.stringify(logCalls);
    expect(loggedText).not.toContain(SENTINEL);
  });

  it('sends the plaintext-bearing routes with silent:true', async () => {
    const vault = await import('@/lib/api/routes/vault');
    respond = () => ({ ok: true, status: 200, data: { value: SENTINEL } });
    await vault.revealVaultField(ITEM_ID, 'password');

    // A malformed 2xx body makes the client's JSON parse error quote the body.
    // `silent` is what keeps that quote out of the debug log.
    const revealCall = calls.find((c) => c.path.endsWith('/reveal'));
    expect(revealCall?.opts?.silent).toBe(true);

    calls.length = 0;
    respond = () => ({ ok: true, status: 200, data: { id: ITEM_ID, display_name: 'x' } });
    await vault.createVaultItem({
      display_name: 'x',
      fields: [{ field_key: 'password', value: SENTINEL }],
    });
    expect(calls[0]?.opts?.silent).toBe(true);
  });

  it('refuses a non-string value instead of handing back a partial body', async () => {
    const vault = await import('@/lib/api/routes/vault');
    respond = () => ({ ok: true, status: 200, data: { value: { nested: SENTINEL } } });
    const result = await vault.revealVaultField(ITEM_ID, 'password');
    expect(result.ok).toBe(false);
    expect(JSON.stringify(logCalls)).not.toContain(SENTINEL);
  });
});

describe('createTransientSecret', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('clears itself after the window and reports the value gone', () => {
    const seen: (string | null)[] = [];
    const secret = createTransientSecret({ clearAfterMs: 30_000, onChange: (v) => seen.push(v) });

    secret.hold(SENTINEL);
    expect(secret.get()).toBe(SENTINEL);

    vi.advanceTimersByTime(29_999);
    expect(secret.get()).toBe(SENTINEL);

    vi.advanceTimersByTime(1);
    expect(secret.get()).toBeNull();
    expect(seen).toEqual([SENTINEL, null]);
  });

  it('replaces rather than accumulates, and restarts the clock', () => {
    const secret = createTransientSecret({ clearAfterMs: 1000 });
    secret.hold('first');
    vi.advanceTimersByTime(900);
    secret.hold('second');
    // The FIRST value's timer must not fire and wipe the second early, and the
    // second must not inherit the first's remaining 100ms.
    vi.advanceTimersByTime(900);
    expect(secret.get()).toBe('second');
    vi.advanceTimersByTime(100);
    expect(secret.get()).toBeNull();
  });

  it('clear() is idempotent and cancels the pending timer', () => {
    const seen: (string | null)[] = [];
    const secret = createTransientSecret({ clearAfterMs: 1000, onChange: (v) => seen.push(v) });
    secret.hold(SENTINEL);
    secret.clear();
    secret.clear();
    vi.advanceTimersByTime(5000);
    expect(secret.get()).toBeNull();
    // One hold, one clear — a second clear must not emit another change.
    expect(seen).toEqual([SENTINEL, null]);
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

  it('coversPage honours each match mode', () => {
    const urls = ['https://a.example.com/login'];
    expect(coversPage(urls, 'host', 'https://a.example.com/settings')).toBe(true);
    expect(coversPage(urls, 'exact', 'https://a.example.com/settings')).toBe(false);
    expect(coversPage(urls, 'exact', 'https://a.example.com/login?x=1')).toBe(true);
    expect(coversPage(urls, 'never', 'https://a.example.com/login')).toBe(false);
    expect(coversPage(urls, 'host', 'https://b.example.com/login')).toBe(false);
    expect(coversPage(urls, 'host', null)).toBe(false);
  });

  it('withPageAdded is idempotent and stores the normalized form', () => {
    const start = ['https://a.example.com/login'];
    expect(withPageAdded(start, 'https://a.example.com/login?next=1')).toEqual(start);
    expect(withPageAdded(start, 'https://b.example.com/signin?x=1')).toEqual([
      'https://a.example.com/login',
      'https://b.example.com/signin',
    ]);
    expect(withPageAdded(start, 'garbage')).toEqual(start);
  });

  it('derives display labels without throwing on junk', () => {
    expect(primaryHost(['not-a-url', 'https://a.example.com/login'])).toBe('a.example.com');
    expect(primaryHost([])).toBeNull();
    expect(loginUrlLabel('https://a.example.com/login')).toBe('a.example.com/login');
    expect(loginUrlLabel('https://a.example.com/')).toBe('a.example.com');
    expect(loginUrlLabel('junk')).toBe('junk');
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
    const hook = readFileSync(join(process.cwd(), 'src/features/vault/useVault.ts'), 'utf8');
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
    'src/lib/credentials/transient-secret.ts',
    'src/lib/credentials/login-urls.ts',
    'src/features/vault/useVault.ts',
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

  it('the panel holds a revealed value only in useTransientSecret', () => {
    const view = readFileSync(join(process.cwd(), 'src/features/vault/VaultView.tsx'), 'utf8');
    expect(view).toContain('useTransientSecret');
    // The data hook must never see plaintext — reveal is called from the field
    // component and its result goes straight into the transient holder.
    const hook = readFileSync(join(process.cwd(), 'src/features/vault/useVault.ts'), 'utf8');
    expect(hook).not.toContain('revealVaultField');
  });
});
