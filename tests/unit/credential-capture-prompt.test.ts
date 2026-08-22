/**
 * "Save this login?" — page-driven capture.
 *
 *   1. the content-side detector snapshots the right thing and refuses the
 *      unsafe / ambiguous cases;
 *   2. the SW host gates, holds, prompts, applies decisions, and NEVER lets
 *      the password out except to the Vault write routes;
 *   3. grep guards: the value-bearing path stays off the logging bus and off
 *      every persistence API.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const SENTINEL = 'Tr0ub4dor&3-sentinel';
const USER = 'arman@example.com';

// ── SW-side mocks ───────────────────────────────────────────────────────────

interface Call {
  name: string;
  args: unknown[];
}
const calls: Call[] = [];
const broadcasts: unknown[] = [];
const logCalls: unknown[] = [];
let signedIn = true;
let matches: Array<{ item_id: string; display_name: string }> = [];
let itemFields: Array<{ id: string; field_key: string; is_active: boolean }> = [];

vi.mock('@/lib/api/routes/vault', () => ({
  WEBSITE_LOGIN_DEFINITION_KEY: 'website_login',
  hasRealUserToken: async () => signedIn,
  fetchBrowserLoginMatches: async (url: string) => {
    calls.push({ name: 'matches', args: [url] });
    return { ok: true, data: { matches } };
  },
  createVaultItem: async (input: unknown) => {
    calls.push({ name: 'create', args: [input] });
    return { ok: true, data: { id: 'new-item' } };
  },
  fetchVaultItem: async (id: string) => {
    calls.push({ name: 'fetchItem', args: [id] });
    return { ok: true, data: { id, fields: itemFields } };
  },
  updateVaultFieldValue: async (itemId: string, fieldId: string, value: string) => {
    calls.push({ name: 'updateValue', args: [itemId, fieldId, value] });
    return { ok: true, data: undefined };
  },
  addVaultField: async (itemId: string, field: unknown) => {
    calls.push({ name: 'addField', args: [itemId, field] });
    return { ok: true, data: undefined };
  },
}));
vi.mock('@/lib/messaging/native', () => ({
  on: () => () => undefined,
  send: async () => undefined,
  broadcast: (kind: string, payload: unknown) => {
    broadcasts.push({ kind, payload });
  },
}));
vi.mock('@/lib/debug/log', () => {
  const rec =
    (level: string) =>
    (...args: unknown[]) => {
      logCalls.push([level, ...args]);
    };
  return { log: { info: rec('info'), warn: rec('warn'), error: rec('error'), success: rec('ok') } };
});

const DEPS = {
  enabled: async () => true,
  signedIn: async () => signedIn,
  never: async () => false,
  prompt: async () => undefined,
};

beforeEach(() => {
  calls.length = 0;
  broadcasts.length = 0;
  logCalls.length = 0;
  signedIn = true;
  matches = [];
  itemFields = [];
  vi.useFakeTimers();
});
afterEach(async () => {
  const host = await import('@/lib/credentials/capture-candidates');
  host._resetCaptureCandidates();
  vi.useRealTimers();
});

// ── 1. Detector ─────────────────────────────────────────────────────────────

function mount(html: string): Document {
  document.body.innerHTML = html;
  // happy-dom reports 0×0 rects; the detector treats that as hidden. Give
  // every input a box so "visible" means what it means in a real page.
  for (const input of Array.from(document.querySelectorAll('input'))) {
    input.getBoundingClientRect = () =>
      ({ width: 100, height: 20, top: 0, left: 0, right: 100, bottom: 20, x: 0, y: 0 }) as DOMRect;
  }
  return document;
}

describe('detector — snapshotLogin', () => {
  it('captures username + password from an ordinary POST form', async () => {
    const { snapshotLogin } = await import('@/lib/credentials/capture-detector');
    const doc = mount(`<form method="post"><input name="email" type="text" value="${USER}">
      <input type="password" name="pw" value="${SENTINEL}"><button type="submit">Go</button></form>`);
    const snap = snapshotLogin(doc.querySelector('form'), doc);
    expect(snap).toEqual({ loginUrl: doc.location.href, username: USER, password: SENTINEL });
  });

  it('refuses a GET form — the password would land in the URL', async () => {
    const { snapshotLogin } = await import('@/lib/credentials/capture-detector');
    const doc = mount(
      `<form><input type="text" value="${USER}"><input type="password" value="${SENTINEL}"></form>`,
    );
    expect(snapshotLogin(doc.querySelector('form'), doc)).toBeNull();
  });

  it('refuses a change-password form (two different password values)', async () => {
    const { snapshotLogin } = await import('@/lib/credentials/capture-detector');
    const doc = mount(
      `<form method="post"><input type="password" value="old"><input type="password" value="${SENTINEL}"></form>`,
    );
    expect(snapshotLogin(doc.querySelector('form'), doc)).toBeNull();
  });

  it('accepts a sign-up form (password + matching confirm)', async () => {
    const { snapshotLogin } = await import('@/lib/credentials/capture-detector');
    const doc = mount(`<form method="post"><input type="email" autocomplete="email" value="${USER}">
      <input type="password" autocomplete="new-password" value="${SENTINEL}"><input type="password" value="${SENTINEL}"></form>`);
    expect(snapshotLogin(doc.querySelector('form'), doc)?.password).toBe(SENTINEL);
  });

  it('ignores a one-time-code box and an empty password', async () => {
    const { snapshotLogin } = await import('@/lib/credentials/capture-detector');
    const otp = mount(
      `<form method="post"><input type="password" autocomplete="one-time-code" value="123456"></form>`,
    );
    expect(snapshotLogin(otp.querySelector('form'), otp)).toBeNull();
    const empty = mount(
      `<form method="post"><input type="text" value="${USER}"><input type="password" value=""></form>`,
    );
    expect(snapshotLogin(empty.querySelector('form'), empty)).toBeNull();
  });

  it('prefers the autocomplete=username/email input over other text boxes', async () => {
    const { snapshotLogin } = await import('@/lib/credentials/capture-detector');
    const doc = mount(`<form method="post"><input type="text" name="search" value="cats">
      <input type="text" autocomplete="username" value="${USER}"><input type="password" value="${SENTINEL}"></form>`);
    expect(snapshotLogin(doc.querySelector('form'), doc)?.username).toBe(USER);
  });

  it('finds a form-less SPA login from the password box itself', async () => {
    const { snapshotLogin } = await import('@/lib/credentials/capture-detector');
    const doc = mount(`<div><input type="text" placeholder="Email address" value="${USER}">
      <input type="password" id="pw" value="${SENTINEL}"><button>Sign in</button></div>`);
    const snap = snapshotLogin(doc.getElementById('pw'), doc);
    expect(snap).toEqual({ loginUrl: doc.location.href, username: USER, password: SENTINEL });
  });
});

// ── 2. SW host ──────────────────────────────────────────────────────────────

const WIRE = {
  loginUrl: 'https://app.example.com/login?next=%2F#x',
  username: USER,
  password: SENTINEL,
};

describe('host — gates', () => {
  it('refuses http, disabled, signed-out, and never-listed origins', async () => {
    const host = await import('@/lib/credentials/capture-candidates');
    expect(
      await host.holdCandidate(1, { ...WIRE, loginUrl: 'http://app.example.com/login' }, DEPS),
    ).toBe(false);
    expect(await host.holdCandidate(1, WIRE, { ...DEPS, enabled: async () => false })).toBe(false);
    expect(await host.holdCandidate(1, WIRE, { ...DEPS, signedIn: async () => false })).toBe(false);
    expect(await host.holdCandidate(1, WIRE, { ...DEPS, never: async () => true })).toBe(false);
    expect(host.pendingCaptureForTab(1)).toBeNull();
    expect(calls).toHaveLength(0);
  });
});

describe('host — hold, status, prompt', () => {
  it('holds a candidate and exposes ONLY value-free metadata', async () => {
    const host = await import('@/lib/credentials/capture-candidates');
    matches = [{ item_id: 'item-1', display_name: 'Example (work)' }];
    const prompted: unknown[] = [];
    expect(
      await host.holdCandidate(7, WIRE, { ...DEPS, prompt: async (c) => void prompted.push(c.id) }),
    ).toBe(true);
    const meta = host.pendingCaptureForTab(7);
    expect(meta).toMatchObject({
      tabId: 7,
      host: 'app.example.com',
      username: USER,
      existing: [{ item_id: 'item-1', display_name: 'Example (work)' }],
    });
    expect(JSON.stringify(meta)).not.toContain(SENTINEL);
    // Matches were resolved against the NORMALIZED destination (no query/hash).
    expect(calls[0]).toEqual({ name: 'matches', args: ['https://app.example.com/login'] });
    // The SPA fallback prompts after the grace period.
    expect(prompted).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1600);
    expect(prompted).toHaveLength(1);
    // Nothing broadcast or logged carries the value.
    expect(JSON.stringify(broadcasts)).not.toContain(SENTINEL);
    expect(JSON.stringify(logCalls)).not.toContain(SENTINEL);
  });

  it('a second submit on the same tab replaces the first', async () => {
    const host = await import('@/lib/credentials/capture-candidates');
    await host.holdCandidate(3, WIRE, DEPS);
    const first = host.pendingCaptureForTab(3)?.candidateId;
    await host.holdCandidate(3, { ...WIRE, username: 'other@example.com' }, DEPS);
    const second = host.pendingCaptureForTab(3);
    expect(second?.candidateId).not.toBe(first);
    expect(second?.username).toBe('other@example.com');
  });

  it('forgets the candidate after the TTL', async () => {
    const host = await import('@/lib/credentials/capture-candidates');
    await host.holdCandidate(4, WIRE, DEPS);
    expect(host.pendingCaptureForTab(4)).not.toBeNull();
    await vi.advanceTimersByTimeAsync(host.CANDIDATE_TTL_MS + 10);
    expect(host.pendingCaptureForTab(4)).toBeNull();
    const r = await host.applyCaptureDecision({ candidateId: 'cap-4-1-x', action: 'save' });
    expect(r.status).toBe('expired');
    expect(calls.find((c) => c.name === 'create')).toBeUndefined();
  });
});

describe('host — decisions', () => {
  it('save → ONE createVaultItem with the value, then the candidate is gone', async () => {
    const host = await import('@/lib/credentials/capture-candidates');
    await host.holdCandidate(5, WIRE, DEPS);
    const id = host.pendingCaptureForTab(5)?.candidateId as string;
    const r = await host.applyCaptureDecision({ candidateId: id, action: 'save' });
    expect(r).toMatchObject({ ok: true, status: 'saved' });
    const create = calls.find((c) => c.name === 'create');
    expect(create?.args[0]).toEqual({
      display_name: 'app.example.com',
      fields: [
        { field_key: 'username', value: USER },
        { field_key: 'password', value: SENTINEL },
      ],
      definition_key: 'website_login',
      login_urls: ['https://app.example.com/login'],
      browser_fill_enabled: true,
    });
    expect(host.pendingCaptureForTab(5)).toBeNull();
    // A second save of the same id is refused — the value was dropped.
    expect((await host.applyCaptureDecision({ candidateId: id, action: 'save' })).status).toBe(
      'expired',
    );
    expect(JSON.stringify(broadcasts)).not.toContain(SENTINEL);
    expect(JSON.stringify(logCalls)).not.toContain(SENTINEL);
  });

  it('update → PUT on the existing password field of a server-matched item only', async () => {
    const host = await import('@/lib/credentials/capture-candidates');
    matches = [{ item_id: 'item-1', display_name: 'Example' }];
    itemFields = [
      { id: 'f-user', field_key: 'username', is_active: true },
      { id: 'f-pass', field_key: 'password', is_active: true },
    ];
    await host.holdCandidate(6, WIRE, DEPS);
    const id = host.pendingCaptureForTab(6)?.candidateId as string;
    // An item the server did NOT match for this site is refused outright.
    expect(
      (await host.applyCaptureDecision({ candidateId: id, action: 'update', itemId: 'stranger' }))
        .status,
    ).toBe('error');
    expect(calls.find((c) => c.name === 'updateValue')).toBeUndefined();
    const r = await host.applyCaptureDecision({
      candidateId: id,
      action: 'update',
      itemId: 'item-1',
    });
    expect(r.status).toBe('updated');
    expect(calls.find((c) => c.name === 'updateValue')?.args).toEqual([
      'item-1',
      'f-pass',
      SENTINEL,
    ]);
    expect(host.pendingCaptureForTab(6)).toBeNull();
  });

  it('update on an item without a password field adds one', async () => {
    const host = await import('@/lib/credentials/capture-candidates');
    matches = [{ item_id: 'item-2', display_name: 'Example' }];
    itemFields = [{ id: 'f-user', field_key: 'username', is_active: true }];
    await host.holdCandidate(8, WIRE, DEPS);
    const id = host.pendingCaptureForTab(8)?.candidateId as string;
    expect(
      (await host.applyCaptureDecision({ candidateId: id, action: 'update', itemId: 'item-2' }))
        .status,
    ).toBe('updated');
    expect(calls.find((c) => c.name === 'addField')?.args).toEqual([
      'item-2',
      { field_key: 'password', value: SENTINEL },
    ]);
  });

  it('dismiss drops; never drops AND remembers the origin (origin only)', async () => {
    const host = await import('@/lib/credentials/capture-candidates');
    const settings = await import('@/lib/credentials/capture-settings');
    await host.holdCandidate(9, WIRE, DEPS);
    const a = host.pendingCaptureForTab(9)?.candidateId as string;
    expect((await host.applyCaptureDecision({ candidateId: a, action: 'dismiss' })).status).toBe(
      'dismissed',
    );
    expect(host.pendingCaptureForTab(9)).toBeNull();

    await host.holdCandidate(9, WIRE, DEPS);
    const b = host.pendingCaptureForTab(9)?.candidateId as string;
    expect((await host.applyCaptureDecision({ candidateId: b, action: 'never' })).status).toBe(
      'never',
    );
    expect(await settings.readNeverCaptureOrigins()).toEqual(['https://app.example.com']);
    expect(await settings.isNeverCaptureOrigin('https://app.example.com')).toBe(true);
    const stored = JSON.stringify(await chrome.storage.local.get(null));
    expect(stored).not.toContain(SENTINEL);
    expect(stored).not.toContain(USER);
    await settings.removeNeverCaptureOrigin('https://app.example.com');
    expect(await settings.readNeverCaptureOrigins()).toEqual([]);
    expect(calls.filter((c) => c.name === 'create' || c.name === 'updateValue')).toHaveLength(0);
  });

  it('signed-out at decision time → sign_in_required, nothing written, candidate kept', async () => {
    const host = await import('@/lib/credentials/capture-candidates');
    await host.holdCandidate(10, WIRE, DEPS);
    const id = host.pendingCaptureForTab(10)?.candidateId as string;
    signedIn = false;
    expect((await host.applyCaptureDecision({ candidateId: id, action: 'save' })).status).toBe(
      'sign_in_required',
    );
    expect(calls.find((c) => c.name === 'create')).toBeUndefined();
    expect(host.pendingCaptureForTab(10)).not.toBeNull();
  });
});

// ── 3. Grep guards ──────────────────────────────────────────────────────────

function code(file: string): string {
  return readFileSync(join(process.cwd(), file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('plaintext path stays off the bus and off every persistence API', () => {
  it('the SW host receives the candidate RAW — never via on()/send() — and never persists', () => {
    const src = code('src/lib/credentials/capture-candidates.ts');
    expect(src).not.toMatch(/\bon<[^>]*>\(\s*CHANNELS\.CREDENTIAL_CAPTURE_CANDIDATE/);
    expect(src).not.toMatch(/\bon\(\s*CHANNELS\.CREDENTIAL_CAPTURE_CANDIDATE/);
    expect(src).toContain('chrome.runtime.onMessage.addListener');
    for (const api of ['chrome.storage', 'localStorage', 'sessionStorage', 'indexedDB']) {
      expect(src, `capture-candidates.ts must not reference ${api}`).not.toContain(api);
    }
    // The only log line mentions tab + host after a prompt attempt — no payload object.
    expect(src).not.toMatch(/log\.\w+\([^)]*password/);
  });

  it('the content-side detector and prompt never import the logging bus or log', () => {
    for (const file of [
      'src/lib/credentials/capture-detector.ts',
      'src/lib/credentials/capture-prompt.ts',
    ]) {
      const src = code(file);
      expect(src, `${file} must not use the logging message bus`).not.toContain(
        '@/lib/messaging/native',
      );
      expect(src, `${file} must not import the debug log`).not.toContain('@/lib/debug/log');
      expect(src, `${file} must not console.*`).not.toMatch(/\bconsole\./);
      for (const api of ['chrome.storage', 'localStorage', 'sessionStorage', 'indexedDB']) {
        expect(src, `${file} must not reference ${api}`).not.toContain(api);
      }
    }
  });

  it('the side-panel card talks metadata only (send/on) and holds no value', () => {
    const src = code('src/features/vault/PendingCaptureCard.tsx');
    expect(src).not.toContain('password');
    expect(src).not.toContain('CREDENTIAL_CAPTURE_CANDIDATE');
    for (const api of ['chrome.storage', 'localStorage', 'sessionStorage', 'indexedDB']) {
      expect(src).not.toContain(api);
    }
  });
});
