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
import type { CaptureExistingLogin } from '@/lib/credentials/capture-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const SENTINEL = 'Tr0ub4dor&3-sentinel';
const USER = 'arman@example.com';
const ACTOR = {
  userId: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222',
};
const ITEM_ID = '33333333-3333-4333-8333-333333333333';
const FIELD_ID = '44444444-4444-4444-8444-444444444444';
const SESSION_KEY = 'matrx.credentials.capture.pending.v1';
const SETTINGS_KEY = 'matrx.settings.v1';
const NEVER_KEY = 'matrx.credentials.captureNeverOrigins';

// ── SW-side mocks ───────────────────────────────────────────────────────────

interface Call {
  name: string;
  args: unknown[];
}
const calls: Call[] = [];
const broadcasts: unknown[] = [];
const tabMessages: unknown[] = [];
const logCalls: unknown[] = [];
const localStorage = new Map<string, unknown>();
const sessionStorage = new Map<string, unknown>();
let signedIn = true;
let matches: Array<{ item_id: string; display_name: string }> = [];
let itemFields: Array<{ id: string; field_key: string; is_active: boolean }> = [];
let createGate: Promise<void> | null = null;
let createResult: unknown = { ok: true, data: { id: 'new-item' } };
let updateResult: unknown = { ok: true, data: undefined };
let addResult: unknown = { ok: true, data: undefined };
let sessionSetFailure: Error | null = null;
let sessionRemoveFailure: Error | null = null;
let sessionSetGate: Promise<void> | null = null;
let onSessionSetAwait: (() => void) | null = null;

Object.assign(chrome, {
  storage: {
    local: {
      get: async (keys?: string[] | null) =>
        keys === null
          ? Object.fromEntries(localStorage)
          : Object.fromEntries(
              (keys ?? []).flatMap((key) =>
                localStorage.has(key) ? [[key, localStorage.get(key)]] : [],
              ),
            ),
      set: async (values: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(values)) localStorage.set(key, value);
      },
    },
    session: {
      setAccessLevel: async () => undefined,
      get: async (keys?: string | string[]) => {
        const list = typeof keys === 'string' ? [keys] : (keys ?? [...sessionStorage.keys()]);
        return Object.fromEntries(
          list.flatMap((key) => (sessionStorage.has(key) ? [[key, sessionStorage.get(key)]] : [])),
        );
      },
      set: async (values: Record<string, unknown>) => {
        if (sessionSetFailure) throw sessionSetFailure;
        onSessionSetAwait?.();
        await sessionSetGate;
        for (const [key, value] of Object.entries(values)) sessionStorage.set(key, value);
      },
      remove: async (keys: string | string[]) => {
        if (sessionRemoveFailure) throw sessionRemoveFailure;
        for (const key of typeof keys === 'string' ? [keys] : keys) sessionStorage.delete(key);
      },
    },
  },
  tabs: {
    get: async (id: number) => ({ id, url: 'https://app.example.com/login' }),
    sendMessage: async (tabId: number, message: unknown) => {
      tabMessages.push({ tabId, message });
      return { ok: true };
    },
  },
});

vi.mock('@/lib/api/routes/vault', () => ({
  WEBSITE_LOGIN_DEFINITION_KEY: 'website_login',
  hasRealUserToken: async () => signedIn,
  fetchBrowserLoginMatches: async (url: string) => {
    calls.push({ name: 'matches', args: [url] });
    return { ok: true, data: { matches } };
  },
  createVaultItem: async (input: unknown, options?: unknown) => {
    calls.push({ name: 'create', args: [input, options] });
    await createGate;
    return createResult;
  },
  fetchVaultItem: async (id: string) => {
    calls.push({ name: 'fetchItem', args: [id] });
    return { ok: true, data: { id, fields: itemFields, capabilities: { can_edit: true } } };
  },
  updateVaultFieldValue: async (
    itemId: string,
    fieldId: string,
    value: string,
    options?: unknown,
  ) => {
    calls.push({ name: 'updateValue', args: [itemId, fieldId, value, options] });
    return updateResult;
  },
  addVaultField: async (itemId: string, field: unknown, options?: unknown) => {
    calls.push({ name: 'addField', args: [itemId, field, options] });
    return addResult;
  },
}));
vi.mock('@/lib/auth/flow', () => ({ getCurrentUser: async () => ({ id: ACTOR.userId }) }));
vi.mock('@/lib/org/active-org', () => ({
  getActiveOrganizationId: async () => ACTOR.organizationId,
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
  actor: ACTOR,
  documentId: 'doc-live',
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  calls.length = 0;
  broadcasts.length = 0;
  logCalls.length = 0;
  tabMessages.length = 0;
  signedIn = true;
  matches = [];
  itemFields = [];
  createGate = null;
  createResult = { ok: true, data: { id: 'new-item' } };
  updateResult = { ok: true, data: undefined };
  addResult = { ok: true, data: undefined };
  sessionSetFailure = null;
  sessionRemoveFailure = null;
  sessionSetGate = null;
  onSessionSetAwait = null;
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
    expect(snap).toEqual({
      stage: 'password',
      loginUrl: doc.location.href,
      username: USER,
      password: SENTINEL,
    });
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

  it('refuses a mixed new-password and unclassified confirmation field', async () => {
    const { snapshotLogin } = await import('@/lib/credentials/capture-detector');
    const doc = mount(`<form method="post"><input type="email" autocomplete="email" value="${USER}">
      <input type="password" autocomplete="new-password" value="${SENTINEL}"><input type="password" value="${SENTINEL}"></form>`);
    expect(snapshotLogin(doc.querySelector('form'), doc)).toBeNull();
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
    expect(snap).toEqual({
      stage: 'password',
      loginUrl: doc.location.href,
      username: USER,
      password: SENTINEL,
    });
  });

  it('chooses agreeing explicit new-password controls over a distinct current password', async () => {
    const { snapshotLogin } = await import('@/lib/credentials/capture-detector');
    const doc = mount(`<form method="post"><input autocomplete="username" value="${USER}">
      <input type="password" autocomplete="current-password" value="old-password">
      <input type="password" autocomplete="new-password" value="${SENTINEL}">
      <input type="password" autocomplete="new-password" value="${SENTINEL}"></form>`);
    expect(snapshotLogin(doc.querySelector('form'), doc)).toMatchObject({
      stage: 'password',
      username: USER,
      password: SENTINEL,
    });
  });

  it('refuses conflicting explicit new-password controls', async () => {
    const { snapshotLogin } = await import('@/lib/credentials/capture-detector');
    const doc =
      mount(`<form method="post"><input type="password" autocomplete="current-password" value="old-password">
      <input type="password" autocomplete="new-password" value="${SENTINEL}">
      <input type="password" autocomplete="new-password" value="different-new-password"></form>`);
    expect(snapshotLogin(doc.querySelector('form'), doc)).toBeNull();
  });

  it('captures only an explicit autocomplete=username field as a username-first continuation', async () => {
    const { snapshotLogin } = await import('@/lib/credentials/capture-detector');
    const allowed = mount(
      `<form method="post"><input autocomplete="username" value="${USER}"><button>Continue</button></form>`,
    );
    expect(snapshotLogin(allowed.querySelector('form'), allowed)).toMatchObject({
      stage: 'username_first',
      username: USER,
    });
    const refused = mount(
      `<form method="post"><input type="email" value="${USER}"><button>Continue</button></form>`,
    );
    expect(snapshotLogin(refused.querySelector('form'), refused)).toBeNull();
  });

  it('honors submitter overrides and refuses an insecure or GET effective destination', async () => {
    const { snapshotLogin } = await import('@/lib/credentials/capture-detector');
    const insecure = mount(`<form method="post"><input type="password" value="${SENTINEL}">
      <button type="submit" formaction="http://attacker.invalid">Go</button></form>`);
    expect(snapshotLogin(insecure.querySelector('button'), insecure)).toBeNull();
    const get = mount(`<form method="post"><input type="password" value="${SENTINEL}">
      <button type="submit" formmethod="get">Go</button></form>`);
    expect(snapshotLogin(get.querySelector('button'), get)).toBeNull();
    const crossOrigin =
      mount(`<form method="post" action="https://attacker.invalid"><input type="password" value="${SENTINEL}">
      <button type="submit">Go</button></form>`);
    expect(snapshotLogin(crossOrigin.querySelector('button'), crossOrigin)).toBeNull();
  });

  it('refuses a synthetic submit even when a late SPA form is mounted after its listeners', async () => {
    const { mountCaptureDetector } = await import('@/lib/credentials/capture-detector');
    const sent: unknown[] = [];
    Object.assign(chrome, {
      runtime: {
        id: 'test-extension',
        sendMessage: async (message: unknown) => void sent.push(message),
      },
    });
    document.body.innerHTML = '';
    const dispose = mountCaptureDetector(document);
    const doc = mount(`<form method="post"><input autocomplete="username" value="${USER}">
      <input type="password" value="${SENTINEL}"><button type="submit">Go</button></form>`);
    doc
      .querySelector('form')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await Promise.resolve();
    expect(sent).toEqual([]);
    dispose();
  });
});

// ── 2. SW host ──────────────────────────────────────────────────────────────

const WIRE = {
  stage: 'password' as const,
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
  it('keeps an explicit username-first continuation private until a password-stage candidate arrives', async () => {
    const host = await import('@/lib/credentials/capture-candidates');
    expect(
      await host.holdCandidate(
        71,
        {
          stage: 'username_first',
          loginUrl: WIRE.loginUrl,
          username: USER,
        },
        DEPS,
      ),
    ).toBe(true);
    expect(host.pendingCaptureForTab(71)).toBeNull();
    expect(await host.holdCandidate(71, { ...WIRE, username: null }, DEPS)).toBe(true);
    expect(host.pendingCaptureForTab(71)?.username).toBe(USER);
  });

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

describe('content prompt — page overlay', () => {
  it('resets page styles before applying the fixed top-right position', async () => {
    const { dismissCapturePrompt, showCapturePrompt } = await import(
      '@/lib/credentials/capture-prompt'
    );
    showCapturePrompt({
      candidateId: 'cap-overlay',
      tabId: 7,
      host: 'app.example.com',
      username: USER,
      existing: [],
    });

    const host = document.getElementById('matrx-login-capture-host');
    const style = host?.getAttribute('style') ?? '';
    expect(style.indexOf('all:initial')).toBeGreaterThanOrEqual(0);
    expect(style.indexOf('all:initial')).toBeLessThan(style.indexOf('position:fixed'));
    expect(style).toContain('top:12px;right:12px;z-index:2147483647');
    dismissCapturePrompt();
  });

  it('dismisses only the resolved candidate, never a newer replacement', async () => {
    const { dismissCapturePrompt, showCapturePrompt } = await import(
      '@/lib/credentials/capture-prompt'
    );
    showCapturePrompt({
      candidateId: 'cap-new',
      tabId: 7,
      host: 'app.example.com',
      username: USER,
      existing: [],
    });

    dismissCapturePrompt('cap-old');
    expect(document.getElementById('matrx-login-capture-host')).not.toBeNull();
    dismissCapturePrompt('cap-new');
    expect(document.getElementById('matrx-login-capture-host')).toBeNull();
  });
});

describe('host — decisions', () => {
  it('shares one frozen create command and idempotency key across concurrent clicks', async () => {
    const host = await import('@/lib/credentials/capture-candidates');
    let release!: () => void;
    createGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await host.holdCandidate(55, WIRE, DEPS);
    const id = host.pendingCaptureForTab(55)?.candidateId as string;
    const first = host.applyCaptureDecision({ candidateId: id, action: 'save' });
    const second = host.applyCaptureDecision({ candidateId: id, action: 'save' });
    await vi.waitFor(() => expect(calls.filter((call) => call.name === 'create')).toHaveLength(1));
    const create = calls.find((call) => call.name === 'create');
    expect(create?.args[1]).toMatchObject({
      expectedActor: DEPS.actor,
      idempotencyKey: expect.any(String),
    });
    release();
    expect((await first).status).toBe('saved');
    expect((await second).status).toBe('saved');
  });

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
    expect(tabMessages).toContainEqual({
      tabId: 5,
      message: {
        __matrx: true,
        kind: 'credential-capture:resolved',
        payload: { candidateId: id },
      },
    });
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
    expect(calls.find((c) => c.name === 'updateValue')?.args.slice(0, 3)).toEqual([
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
    expect(calls.find((c) => c.name === 'addField')?.args.slice(0, 2)).toEqual([
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

  it('signed-out at decision time clears the bound candidate without writing', async () => {
    const host = await import('@/lib/credentials/capture-candidates');
    await host.holdCandidate(10, WIRE, DEPS);
    const id = host.pendingCaptureForTab(10)?.candidateId as string;
    signedIn = false;
    expect((await host.applyCaptureDecision({ candidateId: id, action: 'save' })).status).toBe(
      'sign_in_required',
    );
    expect(calls.find((c) => c.name === 'create')).toBeUndefined();
    expect(host.pendingCaptureForTab(10)).toBeNull();
  });
});

describe('host — registered worker listeners and session continuity', () => {
  type Listener = (
    message: unknown,
    sender: chrome.runtime.MessageSender,
    reply: (value: unknown) => void,
  ) => boolean;
  const listeners: Listener[] = [];
  const updated: Array<(tabId: number, info: chrome.tabs.TabChangeInfo) => void> = [];
  const alarms: Array<(alarm: chrome.alarms.Alarm) => void> = [];
  const storageChanges: Array<
    (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void
  > = [];
  const alarmCalls: unknown[] = [];

  function sender(tabId = 33): chrome.runtime.MessageSender {
    return {
      id: 'test-extension',
      tab: { id: tabId },
      frameId: 0,
      documentId: 'doc-live',
      url: 'https://app.example.com/login',
    } as chrome.runtime.MessageSender;
  }
  async function ask(message: unknown, from = sender()): Promise<unknown> {
    return new Promise((resolve) => {
      expect(listeners.some((listener) => listener(message, from, resolve))).toBe(true);
    });
  }

  beforeEach(async () => {
    listeners.length = 0;
    updated.length = 0;
    alarms.length = 0;
    storageChanges.length = 0;
    alarmCalls.length = 0;
    (globalThis as unknown as { chrome: unknown }).chrome = {
      runtime: {
        id: 'test-extension',
        onMessage: { addListener: (listener: Listener) => listeners.push(listener) },
      },
      storage: {
        local: {
          get: async (keys?: string[] | null) =>
            keys === null
              ? Object.fromEntries(localStorage)
              : Object.fromEntries(
                  (keys ?? []).flatMap((key) =>
                    localStorage.has(key) ? [[key, localStorage.get(key)]] : [],
                  ),
                ),
          set: async (values: Record<string, unknown>) => {
            for (const [key, value] of Object.entries(values)) localStorage.set(key, value);
          },
        },
        session: {
          setAccessLevel: async () => undefined,
          get: async (key: string) =>
            sessionStorage.has(key) ? { [key]: sessionStorage.get(key) } : {},
          set: async (values: Record<string, unknown>) => {
            if (sessionSetFailure) throw sessionSetFailure;
            onSessionSetAwait?.();
            await sessionSetGate;
            for (const [key, value] of Object.entries(values)) sessionStorage.set(key, value);
          },
          remove: async (key: string) => {
            if (sessionRemoveFailure) throw sessionRemoveFailure;
            sessionStorage.delete(key);
          },
        },
        onChanged: {
          addListener: (
            listener: (
              changes: Record<string, chrome.storage.StorageChange>,
              areaName: string,
            ) => void,
          ) => storageChanges.push(listener),
        },
      },
      tabs: {
        get: async (id: number) => ({ id, url: 'https://app.example.com/login' }),
        sendMessage: async (tabId: number, message: unknown) => {
          tabMessages.push({ tabId, message });
          return { ok: true };
        },
        onUpdated: {
          addListener: (listener: (tabId: number, info: chrome.tabs.TabChangeInfo) => void) =>
            updated.push(listener),
        },
        onRemoved: { addListener: () => undefined },
      },
      webNavigation: {
        getFrame: async () => ({ documentId: 'doc-live', url: 'https://app.example.com/login' }),
      },
      alarms: {
        create: (name: string, info: unknown) => alarmCalls.push({ name, info }),
        clear: async () => true,
        onAlarm: {
          addListener: (listener: (alarm: chrome.alarms.Alarm) => void) => alarms.push(listener),
        },
      },
    };
    const host = await import('@/lib/credentials/capture-candidates');
    host._simulateCaptureWorkerRestartForTest();
    host.registerCredentialCaptureHost();
  });

  it('rehydrates before an extension-page status request and schedules idle expiry', async () => {
    const host = await import('@/lib/credentials/capture-candidates');
    await host.holdCandidate(33, WIRE, DEPS);
    host._simulateCaptureWorkerRestartForTest();
    host.registerCredentialCaptureHost();
    const response = await ask(
      { __matrx: true, kind: 'credential-capture:status', payload: { tabId: 33 } },
      {
        id: 'test-extension',
        url: 'chrome-extension://test-extension/sidepanel.html',
      } as chrome.runtime.MessageSender,
    );
    expect(response).toMatchObject({ tabId: 33, host: 'app.example.com' });
    expect(
      alarmCalls.some(
        (call) => (call as { name: string }).name === 'matrx.credentials.capture.expiry',
      ),
    ).toBe(true);
    for (const listener of alarms)
      listener({ name: 'matrx.credentials.capture.expiry' } as chrome.alarms.Alarm);
  });

  it('hydrates and removes an expired session record when the alarm is the first worker wake', async () => {
    const host = await import('@/lib/credentials/capture-candidates');
    await host.holdCandidate(33, WIRE, DEPS);
    const stored = sessionStorage.get('matrx.credentials.capture.pending.v1') as Record<
      string,
      Record<string, unknown>
    >;
    for (const row of Object.values(stored)) {
      row.createdAt = Date.now() - 181_000;
      row.expiresAt = Date.now() - 1_000;
    }
    host._simulateCaptureWorkerRestartForTest();
    host.registerCredentialCaptureHost();
    for (const listener of alarms)
      listener({ name: 'matrx.credentials.capture.expiry' } as chrome.alarms.Alarm);
    await vi.waitFor(() =>
      expect(sessionStorage.has('matrx.credentials.capture.pending.v1')).toBe(false),
    );
  });

  it('auth change is a first wake: it hydrates the persisted draft before purging it', async () => {
    const host = await import('@/lib/credentials/capture-candidates');
    await host.holdCandidate(33, WIRE, DEPS);
    host._simulateCaptureWorkerRestartForTest();
    signedIn = false;
    host.registerCredentialCaptureHost();
    for (const listener of listeners)
      listener({ __matrx: true, kind: 'auth:state-changed' }, sender(), () => undefined);
    await vi.waitFor(() => expect(sessionStorage.has(SESSION_KEY)).toBe(false));
  });

  it('settings change is a first wake: it reads the real local settings blob before purging', async () => {
    const host = await import('@/lib/credentials/capture-candidates');
    await host.holdCandidate(33, WIRE, DEPS);
    host._simulateCaptureWorkerRestartForTest();
    localStorage.set(SETTINGS_KEY, JSON.stringify({ state: { captureLoginsEnabled: false } }));
    host.registerCredentialCaptureHost();
    for (const listener of storageChanges)
      listener({ [SETTINGS_KEY]: { newValue: localStorage.get(SETTINGS_KEY) } }, 'local');
    await vi.waitFor(() => expect(sessionStorage.has(SESSION_KEY)).toBe(false));
  });

  it.each([
    {
      name: 'a create missing its password field',
      operation: {
        kind: 'create_item',
        key: '55555555-5555-4555-8555-555555555555',
        body: {
          display_name: 'app.example.com',
          fields: [{ field_key: 'username', value: USER }],
          definition_key: 'website_login',
          login_urls: ['https://app.example.com/login'],
          browser_fill_enabled: true,
        },
      },
    },
    {
      name: 'a create with a value from another candidate',
      operation: {
        kind: 'create_item',
        key: '55555555-5555-4555-8555-555555555555',
        body: {
          display_name: 'app.example.com',
          fields: [
            { field_key: 'username', value: USER },
            { field_key: 'password', value: 'wrong-candidate-password' },
          ],
          definition_key: 'website_login',
          login_urls: ['https://app.example.com/login'],
          browser_fill_enabled: true,
        },
      },
    },
    {
      name: 'a create addressed to another host',
      operation: {
        kind: 'create_item',
        key: '55555555-5555-4555-8555-555555555555',
        body: {
          display_name: 'other.example.com',
          fields: [
            { field_key: 'username', value: USER },
            { field_key: 'password', value: SENTINEL },
          ],
          definition_key: 'website_login',
          login_urls: ['https://app.example.com/login'],
          browser_fill_enabled: true,
        },
      },
    },
    {
      name: 'an update whose persisted target is not a UUID',
      operation: {
        kind: 'update_field',
        key: '55555555-5555-4555-8555-555555555555',
        itemId: 'not-a-uuid',
        fieldId: FIELD_ID,
        body: { value: SENTINEL },
      },
    },
    {
      name: 'an add whose body has an unrelated value',
      operation: {
        kind: 'add_field',
        key: '55555555-5555-4555-8555-555555555555',
        itemId: ITEM_ID,
        body: { field_key: 'password', value: 'wrong-candidate-password' },
      },
    },
  ])('refuses $name instead of replaying a corrupted persisted command', async ({ operation }) => {
    const host = await import('@/lib/credentials/capture-candidates');
    await host.holdCandidate(33, WIRE, DEPS);
    const id = host.pendingCaptureForTab(33)?.candidateId as string;
    const stored = sessionStorage.get(SESSION_KEY) as Record<string, Record<string, unknown>>;
    const row = stored['33'];
    if (!row) throw new Error('the held candidate must be persisted before restart');
    row.state = 'in_flight';
    row.operation = operation;
    host._simulateCaptureWorkerRestartForTest();

    expect((await host.applyCaptureDecision({ candidateId: id, action: 'save' })).status).toBe(
      'expired',
    );
    expect(sessionStorage.has(SESSION_KEY)).toBe(false);
    expect(
      calls.filter((call) => ['create', 'updateValue', 'addField'].includes(call.name)),
    ).toEqual([]);
  });

  it('startup purges persisted drafts when capture is disabled or the origin is Never', async () => {
    const host = await import('@/lib/credentials/capture-candidates');
    await host.holdCandidate(33, WIRE, DEPS);
    localStorage.set(SETTINGS_KEY, JSON.stringify({ state: { captureLoginsEnabled: false } }));
    host._simulateCaptureWorkerRestartForTest();
    expect(
      (await host.applyCaptureDecision({ candidateId: 'unknown', action: 'save' })).status,
    ).toBe('expired');
    expect(sessionStorage.has(SESSION_KEY)).toBe(false);

    localStorage.delete(SETTINGS_KEY);
    await host.holdCandidate(33, WIRE, DEPS);
    localStorage.set(NEVER_KEY, ['https://app.example.com']);
    host._simulateCaptureWorkerRestartForTest();
    expect(
      (await host.applyCaptureDecision({ candidateId: 'unknown', action: 'save' })).status,
    ).toBe('expired');
    expect(sessionStorage.has(SESSION_KEY)).toBe(false);
  });

  function resolved(candidateId: string): unknown[] {
    return tabMessages.filter(
      (entry) =>
        (entry as { message?: { kind?: string; payload?: { candidateId?: string } } }).message
          ?.kind === 'credential-capture:resolved' &&
        (entry as { message?: { payload?: { candidateId?: string } } }).message?.payload
          ?.candidateId === candidateId,
    );
  }

  it('fails closed with a reopen remedy when trusted-session storage cannot hold a draft', async () => {
    const host = await import('@/lib/credentials/capture-candidates');
    sessionSetFailure = new Error('session unavailable');
    expect(await host.holdCandidate(33, WIRE, DEPS)).toBe(false);
    expect(host.pendingCaptureForTab(33)).toMatchObject({ unavailable: true });
    expect(
      calls.filter((call) => ['create', 'updateValue', 'addField'].includes(call.name)),
    ).toEqual([]);
  });

  it('treats a failed empty-key removal as successful after a value-free snapshot commits', async () => {
    const host = await import('@/lib/credentials/capture-candidates');
    await host.holdCandidate(33, WIRE, DEPS);
    const id = host.pendingCaptureForTab(33)?.candidateId as string;
    sessionRemoveFailure = new Error('empty-key removal unavailable');
    expect((await host.applyCaptureDecision({ candidateId: id, action: 'dismiss' })).status).toBe(
      'dismissed',
    );
    expect(sessionStorage.get(SESSION_KEY)).toEqual({});
    expect(JSON.stringify(sessionStorage.get(SESSION_KEY))).not.toContain(SENTINEL);
    expect(resolved(id)).toHaveLength(1);

    host._simulateCaptureWorkerRestartForTest();
    expect(
      (await host.applyCaptureDecision({ candidateId: 'no-draft', action: 'dismiss' })).status,
    ).toBe('expired');
  });

  it('does not resolve a dismissed draft until one of the plaintext-erasure writes succeeds', async () => {
    const host = await import('@/lib/credentials/capture-candidates');
    await host.holdCandidate(33, WIRE, DEPS);
    const id = host.pendingCaptureForTab(33)?.candidateId as string;
    sessionSetFailure = new Error('empty snapshot unavailable');
    sessionRemoveFailure = new Error('key removal unavailable');
    const failed = await host.applyCaptureDecision({ candidateId: id, action: 'dismiss' });
    expect(failed).toMatchObject({ ok: false, status: 'error' });
    expect(failed.message).toContain('Reopen the extension');
    expect(resolved(id)).toHaveLength(0);
    expect(host.pendingCaptureForTab(33)).toMatchObject({ unavailable: true });

    sessionSetFailure = null;
    sessionRemoveFailure = null;
    host._simulateCaptureWorkerRestartForTest();
    expect((await host.applyCaptureDecision({ candidateId: id, action: 'dismiss' })).status).toBe(
      'dismissed',
    );
    expect(resolved(id)).toHaveLength(1);
  });

  it('keeps a committed mutation frozen and unresolved until cleanup succeeds, then replays its receipt', async () => {
    const host = await import('@/lib/credentials/capture-candidates');
    await host.holdCandidate(33, WIRE, DEPS);
    const id = host.pendingCaptureForTab(33)?.candidateId as string;
    let release!: () => void;
    createGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const saving = host.applyCaptureDecision({ candidateId: id, action: 'save' });
    await vi.waitFor(() => expect(calls.filter((call) => call.name === 'create')).toHaveLength(1));
    sessionSetFailure = new Error('empty snapshot unavailable');
    sessionRemoveFailure = new Error('key removal unavailable');
    const firstCreate = calls.find((call) => call.name === 'create') as Call;
    release();
    const firstResult = await saving;
    expect(firstResult).toMatchObject({ ok: false, status: 'error' });
    expect(firstResult.message).toContain('Vault change was committed');
    expect(resolved(id)).toHaveLength(0);

    const directRetry = await host.applyCaptureDecision({ candidateId: id, action: 'save' });
    expect(directRetry).toMatchObject({ ok: false, status: 'error' });
    expect(directRetry.message).toContain('Capture cleanup could not finish');
    const listenerRetry = await ask({
      __matrx: true,
      kind: 'credential-capture:decision',
      payload: { candidateId: id, action: 'save' },
    });
    expect(listenerRetry).toMatchObject({ ok: false, status: 'error' });
    expect((listenerRetry as { message: string }).message).toContain(
      'Capture cleanup could not finish',
    );
    const unavailableStatus = await ask(
      { __matrx: true, kind: 'credential-capture:status', payload: { tabId: 33 } },
      {
        id: 'test-extension',
        url: 'chrome-extension://test-extension/sidepanel.html',
      } as chrome.runtime.MessageSender,
    );
    expect(unavailableStatus).toMatchObject({ tabId: 33, unavailable: true });
    expect(calls.filter((call) => call.name === 'create')).toHaveLength(1);
    expect(resolved(id)).toHaveLength(0);

    sessionSetFailure = null;
    sessionRemoveFailure = null;
    host._simulateCaptureWorkerRestartForTest();
    expect((await host.applyCaptureDecision({ candidateId: id, action: 'save' })).status).toBe(
      'saved',
    );
    const creates = calls.filter((call) => call.name === 'create');
    expect(creates).toHaveLength(2);
    expect(creates[1]?.args).toEqual(firstCreate.args);
    expect(resolved(id)).toHaveLength(1);
  });

  it('does not send after an invalidation lands while the final frozen-command persist is awaiting', async () => {
    const host = await import('@/lib/credentials/capture-candidates');
    await host.holdCandidate(33, WIRE, DEPS);
    const id = host.pendingCaptureForTab(33)?.candidateId as string;
    let release!: () => void;
    sessionSetGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let persisted!: () => void;
    const persistedFrozenCommand = new Promise<void>((resolve) => {
      persisted = resolve;
    });
    onSessionSetAwait = persisted;
    const saving = host.applyCaptureDecision({ candidateId: id, action: 'save' });
    await persistedFrozenCommand;
    for (const listener of listeners)
      listener({ __matrx: true, kind: 'auth:state-changed' }, sender(), () => undefined);
    release();
    expect((await saving).status).toBe('expired');
    expect(calls.find((call) => call.name === 'create')).toBeUndefined();
  });

  async function replayLostResponse(kind: 'create' | 'update' | 'add'): Promise<void> {
    const host = await import('@/lib/credentials/capture-candidates');
    if (kind !== 'create') {
      matches = [{ item_id: ITEM_ID, display_name: 'Example' }];
      itemFields =
        kind === 'update' ? [{ id: FIELD_ID, field_key: 'password', is_active: true }] : [];
    }
    if (kind === 'create') createResult = { ok: false, failure: { kind: 'network_error' } };
    if (kind === 'update') updateResult = { ok: false, failure: { kind: 'network_error' } };
    if (kind === 'add') addResult = { ok: false, failure: { kind: 'network_error' } };
    await host.holdCandidate(33, WIRE, DEPS);
    const id = host.pendingCaptureForTab(33)?.candidateId as string;
    expect(
      (
        await host.applyCaptureDecision({
          candidateId: id,
          action: kind === 'create' ? 'save' : 'update',
          ...(kind === 'create' ? {} : { itemId: ITEM_ID }),
        })
      ).status,
    ).toBe('error');
    const name = kind === 'create' ? 'create' : kind === 'update' ? 'updateValue' : 'addField';
    const first = calls.find((call) => call.name === name) as Call;
    host._simulateCaptureWorkerRestartForTest();
    if (kind === 'create') createResult = { ok: true, data: { id: 'new-item' } };
    if (kind === 'update') updateResult = { ok: true, data: undefined };
    if (kind === 'add') addResult = { ok: true, data: undefined };
    expect(
      (
        await host.applyCaptureDecision({
          candidateId: id,
          action: kind === 'create' ? 'save' : 'update',
          ...(kind === 'create' ? {} : { itemId: ITEM_ID }),
        })
      ).status,
    ).toBe(kind === 'create' ? 'saved' : 'updated');
    const writes = calls.filter((call) => call.name === name);
    expect(writes).toHaveLength(2);
    expect(writes[1]?.args).toEqual(first.args);
    if (kind === 'update')
      expect(calls.filter((call) => call.name === 'fetchItem')).toHaveLength(1);
  }

  it.each(['create', 'update', 'add'] as const)(
    'replays a lost-response %s command with the same frozen target and idempotency key',
    async (kind) => replayLostResponse(kind),
  );

  it('rejects a hostile page relay before it can observe or decide a candidate', async () => {
    const host = await import('@/lib/credentials/capture-candidates');
    await host.holdCandidate(33, WIRE, DEPS);
    const id = host.pendingCaptureForTab(33)?.candidateId;
    const response = await ask(
      {
        __matrx: true,
        kind: 'credential-capture:decision',
        payload: { candidateId: id, action: 'save' },
      },
      { ...sender(), id: 'forged-extension' } as chrome.runtime.MessageSender,
    );
    expect(response).toMatchObject({ status: 'expired' });
    expect(calls.find((call) => call.name === 'create')).toBeUndefined();
  });

  it('advances the tab epoch before delayed matching can commit after cross-origin navigation', async () => {
    const host = await import('@/lib/credentials/capture-candidates');
    let release!: (value: CaptureExistingLogin[]) => void;
    let started!: () => void;
    const startedMatch = new Promise<void>((resolve) => {
      started = resolve;
    });
    const delayed = new Promise<CaptureExistingLogin[]>((resolve) => {
      release = resolve;
    });
    const hold = host.holdCandidate(33, WIRE, {
      ...DEPS,
      matches: async () => {
        started();
        return delayed;
      },
    });
    await startedMatch;
    for (const listener of updated)
      listener(33, { url: 'https://other.example/login' } as chrome.tabs.TabChangeInfo);
    release([]);
    expect(await hold).toBe(false);
    expect(host.pendingCaptureForTab(33)).toBeNull();
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
    for (const api of [
      'chrome.storage.local',
      'chrome.storage.sync',
      'localStorage',
      'sessionStorage',
      'indexedDB',
    ]) {
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
