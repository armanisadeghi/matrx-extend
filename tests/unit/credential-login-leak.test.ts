/**
 * Plaintext-leak test for `credential_login` (Phase 4 exit gate of
 * /Users/armanisadeghi/code/common-docs/projects/credential-sharing-browser-login/PLAN.md).
 *
 * The whole point of the tool is that the MODEL never sees the credential.
 * This suite proves it by running the real handler — real probe / fill /
 * submit / page-state code, real vault route module — against a live
 * happy-dom login page, with sentinel values standing in for the username and
 * password, then asserting the sentinels appear in exactly ONE place: the page
 * fields themselves.
 *
 * Every egress channel is recorded and searched: the tool result envelope, all
 * `log.*` calls (message AND detail), every outbound HTTP body except the
 * materialize request itself, chrome.storage, the clipboard, thrown errors,
 * and the results of every page-inspection tool run afterwards.
 */

import { _resetSensitiveFieldMemory } from '@/lib/credentials/sensitive-fields';
import { get_form_fields } from '@/lib/tools/handlers/forms';
import {
  get_element_at_point,
  get_element_details,
  inspect_element,
} from '@/lib/tools/handlers/inspect';
import { read_page } from '@/lib/tools/handlers/page-refs';
import { query_elements } from '@/lib/tools/handlers/read';
import type { ToolContext } from '@/lib/tools/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Sentinels ───────────────────────────────────────────────────────────────
// Distinctive enough that a substring search cannot produce a false negative.
const SENTINEL_USER = 'ZZUSERNAMESENTINELZZ';
const SENTINEL_PASSWORD = 'ZZPASSWORDSENTINELZZ';
const SENTINEL_TOTP = '847261';
const ITEM_ID = '11111111-2222-3333-4444-555555555555';
const TAB_ID = 4242;
const PAGE_ORIGIN = 'https://accounts.example.com';
const PAGE_URL = `${PAGE_ORIGIN}/login`;

// ── Recorders ───────────────────────────────────────────────────────────────
interface PostRecord {
  path: string;
  body: unknown;
}
const posts: PostRecord[] = [];
const logCalls: unknown[] = [];
let accessToken: string | null = 'real-user-jwt';

/** Swappable so one test can make the server answer differently. */
let postImpl: (path: string, body: unknown) => Promise<unknown> = async () => ({
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
  apiPost: (path: string, body: unknown) => {
    posts.push({ path, body });
    return postImpl(path, body);
  },
  apiGet: async () => ({ ok: false, status: 404, error: 'unmocked' }),
  apiPatch: async () => ({ ok: false, status: 404, error: 'unmocked' }),
  apiPut: async () => ({ ok: false, status: 404, error: 'unmocked' }),
  apiDelete: async () => ({ ok: false, status: 404, error: 'unmocked' }),
}));

const happyLoginServer = async (path: string, body?: unknown): Promise<unknown> => {
  if (path.endsWith('/matches')) {
    return {
      ok: true,
      data: {
        matches: [
          {
            item_id: ITEM_ID,
            display_name: 'Example account',
            definition_key: 'website_login',
            host: 'accounts.example.com',
          },
        ],
        count: 1,
      },
    };
  }
  if (path.endsWith('/materialize')) {
    const requested = (body as { field_keys?: string[] } | undefined)?.field_keys;
    if (requested) {
      return {
        ok: true,
        data: {
          item_id: ITEM_ID,
          origin: PAGE_ORIGIN,
          fields: Object.fromEntries(
            requested.map((key) => [key, key === 'username' ? SENTINEL_USER : SENTINEL_PASSWORD]),
          ),
        },
      };
    }
    return {
      ok: true,
      data: {
        item_id: ITEM_ID,
        origin: PAGE_ORIGIN,
        username: SENTINEL_USER,
        password: SENTINEL_PASSWORD,
      },
    };
  }
  if (path.endsWith('/result')) return { ok: true, data: undefined };
  return { ok: false, status: 404, error: 'unmocked' };
};

// ── Chrome surface ──────────────────────────────────────────────────────────
// `executeScript` runs the injected function for real, in this realm, against
// the live document — so the probe / fill / submit / page-state code under
// test is the code that actually ships.
let tabUrl = PAGE_URL;
const frameTargets: Array<number[] | undefined> = [];

function installChrome(): void {
  const existing = (globalThis as unknown as { chrome?: Record<string, unknown> }).chrome ?? {};
  (globalThis as unknown as { chrome: unknown }).chrome = {
    ...existing,
    scripting: {
      executeScript: async ({
        target,
        func,
        args,
      }: {
        target: { tabId: number; frameIds?: number[] };
        func: (...a: never[]) => unknown;
        args?: unknown[];
      }) => {
        frameTargets.push(target.frameIds);
        const result = await (func as (...a: unknown[]) => unknown)(...(args ?? []));
        return [{ result }];
      },
    },
    tabs: {
      get: async (id: number) => ({ id, url: tabUrl, title: 'Sign in' }),
      query: async () => [{ id: TAB_ID, url: tabUrl, title: 'Sign in' }],
      onUpdated: { addListener: () => undefined },
      onRemoved: { addListener: () => undefined },
    },
    runtime: { id: 'cihdmkcdjjckfhjpgoedmgfpoljebaml', getManifest: () => ({ version: '0.0.0-test' }) },
  };
}

function setPageUrl(url: string): void {
  const hd = (globalThis as unknown as { happyDOM?: { setURL?: (u: string) => void } }).happyDOM;
  hd?.setURL?.(url);
}

const ctx: ToolContext = {
  conversationId: 'conv-1',
  runId: 'run-1',
  callId: 'call-1',
  agentName: 'test',
  permissionMode: 'act',
  assignedTabId: TAB_ID,
};

/**
 * One-step login page. Clicking submit removes the password field and reveals
 * a sign-out link — the DOM shape `checkAuthState` reads as signed in.
 *
 * `method="post"` is deliberate. A GET login form serializes whatever is in
 * its fields into the URL on submit, which then shows up in `read_page`'s
 * `url`, `get_active_tab`, browsing history, and the Referer header. That
 * exposure is created by the SITE, not by this tool, and it cannot be redacted
 * after the fact without retaining the plaintext the handler deliberately
 * drops. Recorded in the report as a known boundary; GET login forms are
 * vanishingly rare because they are a severe flaw on the site's part.
 */
function renderOneStepLoginPage(): void {
  document.body.innerHTML = `
    <header><a href="/home">Home</a></header>
    <form id="loginform" method="post" action="/session">
      <label for="username">Email</label>
      <input id="username" name="username" type="text" autocomplete="username" />
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" />
      <button id="submit" type="submit">Sign in</button>
    </form>
  `;
  const btn = document.getElementById('submit') as HTMLButtonElement;
  btn.addEventListener('click', () => {
    document.getElementById('password')?.remove();
    const header = document.querySelector('header');
    if (header) header.innerHTML = '<a href="/logout">Sign out</a>';
    sizeEverything();
  });
  sizeEverything();
}

function renderAuthenticatorPage(): void {
  document.body.innerHTML = `
    <header><a href="/home">Home</a></header>
    <form id="mfa" method="post" action="/session">
      <label for="otp">Authenticator code</label>
      <input id="otp" name="otp" inputmode="numeric" autocomplete="one-time-code" />
      <button id="verify" type="submit">Verify</button>
    </form>
  `;
  document.getElementById('verify')?.addEventListener('click', () => {
    document.getElementById('mfa')?.remove();
    const header = document.querySelector('header');
    if (header) header.innerHTML = '<a href="/logout">Sign out</a>';
    sizeEverything();
  });
  sizeEverything();
}

/**
 * happy-dom reports zero-size rects for everything; every probe in the repo
 * treats width + height === 0 as hidden. Give elements a measurable box so the
 * real visibility logic runs instead of short-circuiting.
 */
function sizeEverything(): void {
  for (const el of Array.from(document.querySelectorAll('input, button, a, [role="button"]'))) {
    (el as HTMLElement).getBoundingClientRect = () =>
      ({ width: 120, height: 24, x: 0, y: 0, top: 0, left: 0, right: 120, bottom: 24 }) as DOMRect;
  }
}

async function egressBlob(envelope: unknown): Promise<string> {
  const auditPosts = posts.filter((p) => !p.path.endsWith('/materialize'));
  const storage = await chrome.storage.local.get(null).catch(() => ({}));
  const session = await chrome.storage.session.get(null).catch(() => ({}));
  return JSON.stringify({ envelope, logCalls, auditPosts, storage, session });
}

function expectNoSentinels(blob: string, label: string): void {
  expect(blob.includes(SENTINEL_USER), `${label} leaked the username`).toBe(false);
  expect(blob.includes(SENTINEL_PASSWORD), `${label} leaked the password`).toBe(false);
}

function resetRecorders(): void {
  posts.length = 0;
  logCalls.length = 0;
  frameTargets.length = 0;
  accessToken = 'real-user-jwt';
  postImpl = happyLoginServer;
  tabUrl = PAGE_URL;
  _resetSensitiveFieldMemory();
  installChrome();
  setPageUrl(PAGE_URL);
  renderOneStepLoginPage();
}

describe('credential_login — plaintext never leaves the handler', () => {
  beforeEach(resetRecorders);
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('fills, submits, verifies, and returns only a safe status', async () => {
    const { credential_login } = await import('@/lib/tools/handlers/credential-login');
    const result = await credential_login.run({ action: 'auto' }, ctx);

    expect(result.status).toBe('authenticated');
    // The richer envelope carries only bounded evidence/signals/instructions.
    expect(Object.keys(result).sort()).toEqual(
      ['confidence', 'feedback', 'signals', 'status', 'verdict'].sort(),
    );
    expect(result.feedback.how_to_report).not.toContain(SENTINEL_PASSWORD);

    // The fill actually happened — otherwise this test proves nothing.
    const username = document.getElementById('username') as HTMLInputElement;
    expect(username.value).toBe(SENTINEL_USER);
    expect(username.hasAttribute('data-matrx-sensitive')).toBe(true);

    expectNoSentinels(await egressBlob(result), 'credential_login egress');
  }, 30_000);

  it('injects into the TOP FRAME only', async () => {
    const { credential_login } = await import('@/lib/tools/handlers/credential-login');
    await credential_login.run({ action: 'auto' }, ctx);
    // Every injection the handler makes itself must be frame-pinned.
    // `checkAuthState` is a pre-existing shared primitive that targets the tab
    // and carries no plaintext; it is the only unpinned injection.
    const pinned = frameTargets.filter((f) => f !== undefined);
    expect(pinned.length).toBeGreaterThan(0);
    for (const f of pinned) expect(f).toEqual([0]);
    expect(frameTargets.filter((f) => f === undefined).length).toBeLessThanOrEqual(1);
  }, 30_000);

  it('reports the outcome to the vault audit endpoint without any value', async () => {
    const { credential_login } = await import('@/lib/tools/handlers/credential-login');
    await credential_login.run({ action: 'auto' }, ctx);
    const audit = posts.find((p) => p.path.endsWith('/result'));
    expect(audit).toBeDefined();
    expect(audit?.body).toMatchObject({ status: 'authenticated' });
    expectNoSentinels(JSON.stringify(audit), 'audit POST');
  }, 30_000);

  it('never echoes the filled values back through any page-inspection tool', async () => {
    const { credential_login } = await import('@/lib/tools/handlers/credential-login');
    await credential_login.run({ action: 'auto' }, ctx);

    // A hostile page strips our marker — the extension's own filled-field
    // memory must still redact.
    const username = document.getElementById('username') as HTMLInputElement;
    username.removeAttribute('data-matrx-sensitive');

    const inspections: unknown[] = [];
    inspections.push(await read_page.run(read_page.argsSchema.parse({}), ctx));
    const ref = username.getAttribute('data-matrx-ref');
    inspections.push(await get_form_fields.run(get_form_fields.argsSchema.parse({}), ctx));
    inspections.push(
      await query_elements.run(query_elements.argsSchema.parse({ selector: 'input' }), ctx),
    );
    inspections.push(
      await inspect_element.run(inspect_element.argsSchema.parse({ selector: '#username' }), ctx),
    );
    if (ref) {
      inspections.push(
        await get_element_details.run(
          get_element_details.argsSchema.parse({ ref, include_html: true, include_styles: false }),
          ctx,
        ),
      );
      inspections.push(
        await get_element_details.run(
          get_element_details.argsSchema.parse({
            ref: (document.getElementById('loginform')?.getAttribute('data-matrx-ref') ??
              ref) as string,
            include_html: true,
            include_styles: false,
          }),
          ctx,
        ),
      );
    }
    inspections.push(
      await get_element_at_point.run(get_element_at_point.argsSchema.parse({ x: 1, y: 1 }), ctx),
    );
    expectNoSentinels(JSON.stringify(inspections), 'page-inspection results');
  }, 30_000);
});

describe('credential_login — complete attempt contract', () => {
  beforeEach(resetRecorders);
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('discovers field NAMES and non-secret values without materializing anything', async () => {
    postImpl = async (path, body) => {
      if (path.endsWith('/matches')) {
        expect(body).toMatchObject({ include_field_inventory: true });
        return {
          ok: true,
          data: {
            matches: [
              {
                item_id: ITEM_ID,
                display_name: 'Example account',
                definition_key: 'website_login',
                host: 'accounts.example.com',
                available_fields: [
                  { field_key: 'username', label: 'Email', fillable: true },
                  { field_key: 'password', label: 'Password', fillable: true },
                  {
                    field_key: 'totp_seed',
                    label: 'Authenticator',
                    fillable: false,
                    reason: 'sealed',
                  },
                ],
                non_secret_fields: [{ key: 'account_alias', label: 'Alias', value: 'matrx' }],
              },
            ],
            count: 1,
          },
        };
      }
      throw new Error('discovery must never materialize');
    };
    const { credential_login } = await import('@/lib/tools/handlers/credential-login');
    const result = await credential_login.run({ action: 'discover' }, ctx);
    expect(result.status).toBe('discovery_ready');
    expect(result.available_fields?.map((field) => field.field_key)).toEqual([
      'username',
      'password',
      'totp_seed',
    ]);
    expect(posts.some((post) => post.path.endsWith('/materialize'))).toBe(false);
    expectNoSentinels(await egressBlob(result), 'discovery result');
  });

  it('fills a declared multi-field attempt atomically and returns sanitized evidence', async () => {
    const { credential_login } = await import('@/lib/tools/handlers/credential-login');
    const result = await credential_login.run(
      {
        action: 'attempt',
        credential_item_id: ITEM_ID,
        fields: [
          { selector: '#username', field_key: 'username', clear_first: true },
          { selector: '#password', field_key: 'password', clear_first: true },
        ],
        submit: { kind: 'click', selector: '#submit' },
        expect: { success_selector: 'a[href="/logout"]', timeout_ms: 2_000 },
        reason: 'Test the declared attempt contract.',
      },
      ctx,
    );

    expect(result.status).toBe('authenticated');
    expect(result.confidence).toBeGreaterThanOrEqual(0.75);
    expect(result.evidence?.before.url).toBe(PAGE_URL);
    expect(result.evidence?.after?.url).toBe(`${PAGE_ORIGIN}/session`);
    expect(result.signals?.some((item) => item.kind === 'success_selector')).toBe(true);
    const materialize = posts.find((post) => post.path.endsWith('/materialize'));
    expect(materialize?.body).toMatchObject({ field_keys: ['username', 'password'] });
    expectNoSentinels(await egressBlob(result), 'complete attempt egress');
  }, 30_000);

  it('refuses an incomplete specification at schema validation', async () => {
    const { credential_login } = await import('@/lib/tools/handlers/credential-login');
    const parsed = credential_login.argsSchema.safeParse({
      action: 'attempt',
      fields: [{ selector: '#password', field_key: 'password', literal: 'not-allowed' }],
      submit: { kind: 'click', selector: '#submit' },
    });
    expect(parsed.success).toBe(false);
  });

  it('keeps delegated authenticator material out of args, results, logs, storage, and audit', async () => {
    renderAuthenticatorPage();
    postImpl = async (path, body) => {
      if (path.endsWith('/authenticator-materialize')) {
        expect(body).toMatchObject({
          conversation_id: ctx.conversationId,
          tool_invocation_id: ctx.callId,
          page_url: PAGE_URL,
          code_selector: '#otp',
          submit: { kind: 'click', selector: '#verify' },
          extension_instance_id: 'cihdmkcdjjckfhjpgoedmgfpoljebaml',
        });
        return {
          ok: true,
          data: {
            injection_id: 'injection-1',
            origin: PAGE_ORIGIN,
            code: SENTINEL_TOTP,
            expires_at: new Date(Date.now() + 30_000).toISOString(),
          },
        };
      }
      if (path.endsWith('/result')) return { ok: true, data: undefined };
      return { ok: false, status: 404, error: 'unmocked' };
    };

    const { credential_login } = await import('@/lib/tools/handlers/credential-login');
    const args = {
      action: 'authenticator' as const,
      credential_item_id: ITEM_ID,
      code_selector: '#otp',
      submit: { kind: 'click' as const, selector: '#verify' },
      expect: { success_selector: 'a[href="/logout"]', timeout_ms: 2_000 },
    };
    expect(credential_login.tierFor?.(credential_login.argsSchema.parse(args))).toBe('privileged');
    const result = await credential_login.run(credential_login.argsSchema.parse(args), ctx);

    expect(result.status).toBe('authenticated');
    expect(JSON.stringify(args)).not.toContain(SENTINEL_TOTP);
    const audit = posts.find((post) => post.path.endsWith('/result'));
    expect(JSON.stringify(audit)).not.toContain(SENTINEL_TOTP);
    const nonMaterializePosts = posts.filter(
      (post) => !post.path.endsWith('/authenticator-materialize'),
    );
    const storage = await chrome.storage.local.get(null).catch(() => ({}));
    const session = await chrome.storage.session.get(null).catch(() => ({}));
    expect(
      JSON.stringify({ result, logCalls, nonMaterializePosts, storage, session }),
    ).not.toContain(SENTINEL_TOTP);
  });

  it('refuses a missing first-step selector before materializing Vault fields', async () => {
    const { credential_login } = await import('@/lib/tools/handlers/credential-login');
    const result = await credential_login.run(
      {
        action: 'attempt',
        credential_item_id: ITEM_ID,
        fields: [{ selector: '#not-on-this-page', field_key: 'password', clear_first: true }],
        submit: { kind: 'click', selector: '#submit' },
      },
      ctx,
    );
    expect(result.status).toBe('spec_incomplete');
    expect(result.reason).toBe('selector_not_found');
    expect(posts.some((post) => post.path.endsWith('/materialize'))).toBe(false);
  });

  it('files a value-free report through the canonical feedback route', async () => {
    postImpl = async (path, body) => {
      if (path.endsWith('/report')) {
        expect(body).toEqual({
          kind: 'wrong_verdict',
          where: 'the final login result',
          attempt_id: 'attempt-1',
          description: 'The page was still signed out.',
        });
        return { ok: true, status: 200, data: { id: 'feedback-1', status: 'pending' } };
      }
      throw new Error('report must use only the feedback route');
    };
    const { credential_login } = await import('@/lib/tools/handlers/credential-login');
    const result = await credential_login.run(
      {
        action: 'report',
        kind: 'wrong_verdict',
        where: 'the final login result',
        attempt_id: 'attempt-1',
        description: 'The page was still signed out.',
      },
      ctx,
    );
    expect(result.status).toBe('report_received');
    expectNoSentinels(await egressBlob(result), 'report result');
  });
});

describe('credential_login — unsafe destinations cannot be filled', () => {
  beforeEach(resetRecorders);
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('refuses plain http on a real host before any vault call', async () => {
    tabUrl = 'http://accounts.example.com/login';
    const { credential_login } = await import('@/lib/tools/handlers/credential-login');
    const result = await credential_login.run({ action: 'auto' }, ctx);
    expect(result.status).toBe('unsafe_destination');
    expect(result.reason).toBe('insecure_scheme');
    // Nothing was decrypted, nothing was typed.
    expect(posts).toHaveLength(0);
    expect((document.getElementById('password') as HTMLInputElement).value).toBe('');
  });

  it('refuses when the live page origin is not the origin on the tab', async () => {
    // The tab reports one origin; the live document reports another — i.e. the
    // tab navigated between the URL read and the injection.
    tabUrl = 'https://evil.example.net/login';
    const { credential_login } = await import('@/lib/tools/handlers/credential-login');
    const result = await credential_login.run({ action: 'auto' }, ctx);
    expect(result.status).toBe('unsafe_destination');
    expect(result.reason).toBe('origin_changed_during_probe');
    expect(posts).toHaveLength(0);
  });

  it.each([
    ['an explicit GET form', 'get'],
    ['a form with the browser-default GET method', null],
  ])('refuses %s before any vault call or fill', async (_label, method) => {
    document.body.innerHTML = `
      <form id="loginform" ${method ? `method="${method}"` : ''} action="/session">
        <input id="username" name="username" type="text" autocomplete="username" />
        <input id="password" name="password" type="password" />
        <button id="submit" type="submit">Sign in</button>
      </form>
    `;
    sizeEverything();

    const { credential_login } = await import('@/lib/tools/handlers/credential-login');
    const result = await credential_login.run({ action: 'auto' }, ctx);

    expect(result.status).toBe('unsafe_destination');
    expect(result.reason).toBe('unsafe_get_form');
    expect(posts).toHaveLength(0);
    expect((document.getElementById('username') as HTMLInputElement).value).toBe('');
    expect((document.getElementById('password') as HTMLInputElement).value).toBe('');
  });

  it('refuses a materialized item whose authorized origin is not this page', async () => {
    postImpl = async (path: string) => {
      if (path.endsWith('/matches')) {
        return {
          ok: true,
          data: {
            matches: [
              {
                item_id: ITEM_ID,
                display_name: 'Wrong-origin item',
                definition_key: 'website_login',
                host: 'other.example.org',
              },
            ],
            count: 1,
          },
        };
      }
      if (path.endsWith('/materialize')) {
        return {
          ok: true,
          data: {
            item_id: ITEM_ID,
            // The server authorized a DIFFERENT origin than the live tab.
            origin: 'https://other.example.org',
            username: SENTINEL_USER,
            password: SENTINEL_PASSWORD,
          },
        };
      }
      return { ok: true, data: undefined };
    };

    const { credential_login } = await import('@/lib/tools/handlers/credential-login');
    const result = await credential_login.run({ action: 'auto' }, ctx);

    expect(result.status).toBe('unsafe_destination');
    expect(result.reason).toBe('origin_mismatch');
    // The refusal happens BEFORE any fill.
    expect((document.getElementById('username') as HTMLInputElement).value).toBe('');
    expect((document.getElementById('password') as HTMLInputElement).value).toBe('');
    expectNoSentinels(await egressBlob(result), 'wrong-origin refusal');
  }, 30_000);

  it('refuses to run at all without a real user session', async () => {
    const { credential_login } = await import('@/lib/tools/handlers/credential-login');
    accessToken = null;
    const result = await credential_login.run({ action: 'auto' }, ctx);
    expect(result.status).toBe('unknown');
    expect(result.reason).toBe('matrx_sign_in_required');
    expect(posts).toHaveLength(0);
  });

  it('returns selection_required with ids + titles only when several items match', async () => {
    postImpl = async (path: string) => {
      if (path.endsWith('/matches')) {
        return {
          ok: true,
          data: {
            matches: [
              {
                item_id: 'a',
                display_name: 'Work account',
                definition_key: 'website_login',
                host: 'accounts.example.com',
              },
              {
                item_id: 'b',
                display_name: 'Personal account',
                definition_key: 'website_login',
                host: 'accounts.example.com',
              },
            ],
            count: 2,
          },
        };
      }
      throw new Error('materialize must never be called on a multi-match');
    };
    const { credential_login } = await import('@/lib/tools/handlers/credential-login');
    const result = await credential_login.run({ action: 'auto' }, ctx);
    expect(result.status).toBe('selection_required');
    expect(result.choices).toEqual([
      { credential_item_id: 'a', display_name: 'Work account' },
      { credential_item_id: 'b', display_name: 'Personal account' },
    ]);
    // Nothing was decrypted.
    expect(posts.some((p) => p.path.endsWith('/materialize'))).toBe(false);
  });

  it('returns no_matching_login when nothing matches, without decrypting', async () => {
    postImpl = async (path: string) => {
      if (path.endsWith('/matches')) return { ok: true, data: { matches: [], count: 0 } };
      throw new Error('materialize must never be called on a zero-match');
    };
    const { credential_login } = await import('@/lib/tools/handlers/credential-login');
    const result = await credential_login.run({ action: 'auto' }, ctx);
    expect(result.status).toBe('no_matching_login');
    expect(posts.some((p) => p.path.endsWith('/materialize'))).toBe(false);
  });
});

describe('credential_login — flow variants', () => {
  beforeEach(resetRecorders);
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('handles a two-step username-then-password flow', async () => {
    document.body.innerHTML = `
      <header><a href="/home">Home</a></header>
      <form id="loginform" method="post" action="/session">
        <input id="username" name="username" type="text" autocomplete="username" />
        <button id="next" type="submit">Next</button>
      </form>
    `;
    const next = document.getElementById('next') as HTMLButtonElement;
    let stage = 1;
    next.addEventListener('click', () => {
      if (stage === 1) {
        // Step two reveals the password field and relabels the button.
        const form = document.getElementById('loginform') as HTMLFormElement;
        const pw = document.createElement('input');
        pw.id = 'password';
        pw.setAttribute('name', 'password');
        pw.setAttribute('type', 'password');
        form.insertBefore(pw, next);
        next.textContent = 'Sign in';
        stage = 2;
      } else {
        document.getElementById('password')?.remove();
        const header = document.querySelector('header');
        if (header) header.innerHTML = '<a href="/logout">Sign out</a>';
      }
      sizeEverything();
    });
    sizeEverything();

    const { credential_login } = await import('@/lib/tools/handlers/credential-login');
    const result = await credential_login.run({ action: 'auto' }, ctx);

    expect(result.status).toBe('authenticated');
    expect(stage).toBe(2);
    expect((document.getElementById('username') as HTMLInputElement).value).toBe(SENTINEL_USER);
    expectNoSentinels(await egressBlob(result), 'two-step flow');
  }, 30_000);

  it('CLEARS the filled fields when submission never proceeds', async () => {
    // A dead submit button: the page does not react at all.
    document.body.innerHTML = `
      <header><a href="/home">Home</a></header>
      <form id="loginform" method="post" action="/session">
        <input id="username" name="username" type="text" autocomplete="username" />
        <input id="password" name="password" type="password" />
        <button id="submit" type="submit">Sign in</button>
      </form>
    `;
    (document.getElementById('loginform') as HTMLFormElement).requestSubmit = () => undefined;
    (document.getElementById('loginform') as HTMLFormElement).submit = () => undefined;
    sizeEverything();

    // Run the settle loop's wall clock forward so the 15s bound is reached in
    // a couple of real polls instead of 15 real seconds.
    let clock = Date.now();
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => {
      clock += 6_000;
      return clock;
    });

    const { credential_login } = await import('@/lib/tools/handlers/credential-login');
    const result = await credential_login.run({ action: 'auto' }, ctx);
    nowSpy.mockRestore();

    expect(result.status).toBe('unknown');
    expect(result.reason).toBe('submission_did_not_proceed');
    // Both fields were wiped and the markers removed before returning.
    expect((document.getElementById('username') as HTMLInputElement).value).toBe('');
    expect((document.getElementById('password') as HTMLInputElement).value).toBe('');
    expect(
      document.querySelectorAll('[data-matrx-sensitive]').length,
      'markers must be removed once the values are gone',
    ).toBe(0);
    expectNoSentinels(await egressBlob(result), 'stalled submission');
  }, 30_000);
});
