/**
 * Plaintext-leak + flow test for `credential_login` actions capture/propose_recipe
 * (D-11 on-the-fly capture; formerly the standalone `capture_credential` tool).
 *
 * The whole point: the agent hits a login it has NO stored credential for, the
 * USER types the credential into a box, and THE AGENT NEVER SEES IT. The value
 * moves card → vault write, never through the service-worker handler, a tool
 * argument, a tool result, a log line, or the SW↔card broadcast.
 *
 * This suite proves it two ways:
 *   1. The SW implementation (`runCredentialCapture`) never receives, holds, or emits a
 *      value — the "card" is simulated by answering the capture broadcast with
 *      an item_id only, and every egress channel is searched for the sentinel.
 *   2. The vault route (`captureCredential`) sends the user-typed values to the
 *      server on `field_values` and returns a value-free receipt — the value
 *      appears in the outbound body (expected) and NOWHERE in the result, log,
 *      or storage.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const SENTINEL_USER = 'ZZCAPUSERSENTINELZZ';
const SENTINEL_PASSWORD = 'ZZCAPPASSSENTINELZZ';
const ITEM_ID = '99999999-8888-7777-6666-555555555555';
const TAB_ID = 7373;
const PAGE_ORIGIN = 'https://admin.example.com';
const PAGE_URL = `${PAGE_ORIGIN}/login`;

// ── Recorders ───────────────────────────────────────────────────────────────
interface PostRecord {
  path: string;
  body: unknown;
}
const posts: PostRecord[] = [];
const logCalls: unknown[] = [];
const broadcasts: Array<{ kind: string; payload: unknown }> = [];
let accessToken: string | null = 'real-user-jwt';
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

// The SW → card / card → SW channel. We intercept the SW's outgoing capture
// request and answer it as the card would (item_id only, never a value).
type CaptureHandler = (payload: unknown) => unknown;
let captureResponder: CaptureHandler | null = null;
let autoRespond = true;
vi.mock('@/lib/messaging/native', () => ({
  broadcast: (kind: string, payload: unknown) => {
    broadcasts.push({ kind, payload });
    // Simulate the card answering the capture request.
    if (kind === 'tool:capture-credential-request' && captureResponder && autoRespond) {
      const req = payload as { callId: string; branch: string };
      // The card writes the credential (card → server) then responds with the
      // item_id + branch only — never a value.
      queueMicrotask(() =>
        captureResponder?.({
          callId: req.callId,
          ok: true,
          credential_item_id: ITEM_ID,
          branch: req.branch,
          propose_recipe: req.branch === 'unknown',
        }),
      );
    }
  },
  on: (kind: string, handler: CaptureHandler) => {
    if (kind === 'tool:capture-credential-response') {
      captureResponder = (payload: unknown) => handler(payload);
    }
    return () => {
      if (kind === 'tool:capture-credential-response') captureResponder = null;
    };
  },
}));

function installChrome(): void {
  const existing = (globalThis as unknown as { chrome?: Record<string, unknown> }).chrome ?? {};
  (globalThis as unknown as { chrome: unknown }).chrome = {
    ...existing,
    tabs: {
      query: async () => [{ id: TAB_ID, url: PAGE_URL }],
      get: async () => ({ id: TAB_ID, url: PAGE_URL }),
      onRemoved: { addListener: () => {} },
    },
    runtime: { getManifest: () => ({ version: '0.0.0-test' }) },
  };
}

async function importFresh() {
  vi.resetModules();
  const cap = await import('@/lib/tools/handlers/credential-capture');
  const vault = await import('@/lib/api/routes/vault');
  return { cap, vault };
}

const ctx = {
  callId: 'call-cap-1',
  conversationId: 'conv-1',
  agentName: 'Agent',
  assignedTabId: TAB_ID,
} as unknown as import('@/lib/tools/types').ToolContext;

beforeEach(() => {
  posts.length = 0;
  logCalls.length = 0;
  broadcasts.length = 0;
  accessToken = 'real-user-jwt';
  captureResponder = null;
  autoRespond = true;
  installChrome();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function allEgress(result: unknown): string {
  // Everything the model / SW could observe: the tool result, the SW→card
  // request payload, and every log line. (The card → server POST body is the
  // one legitimate place a value travels; it is asserted separately.)
  return JSON.stringify({ result, broadcasts, logCalls });
}

describe('credential_login capture — the SW implementation never sees a value', () => {
  it('captures via the card and the value never reaches the handler, result, log, or broadcast', async () => {
    const { cap } = await importFresh();
    postImpl = async (path) => {
      if (path.endsWith('/capture-context')) {
        return {
          ok: true,
          status: 200,
          data: {
            branch: 'unknown',
            normalized_origin: PAGE_ORIGIN,
            recipe: null,
            guidance: 'document it',
          },
        };
      }
      return { ok: false, status: 404, error: 'unmocked' };
    };

    const result = await cap.runCredentialCapture(
      {
        action: 'capture',
        display_name: 'Example Admin',
        fields: [
          { field_key: 'username', selector: '#u', label: 'Email', secret: false },
          { field_key: 'password', selector: '#p', label: 'Password', secret: true },
        ],
      } as never,
      ctx,
    );

    expect(result.status).toBe('captured');
    expect(result.proceed).toBe(true);
    expect(result.branch).toBe('unknown');
    expect(result.propose_recipe).toBe(true);

    // The sentinels were never introduced into the handler at all (the card
    // holds them). Assert they appear NOWHERE the model/SW can observe.
    const egress = allEgress(result);
    expect(egress).not.toContain(SENTINEL_USER);
    expect(egress).not.toContain(SENTINEL_PASSWORD);

    // The SW→card request must carry field NAMES + selectors only — never a value.
    const req = broadcasts.find((b) => b.kind === 'tool:capture-credential-request');
    expect(req).toBeTruthy();
    expect(JSON.stringify(req?.payload)).not.toContain('value');

    // The request carries a future expiry — the card refuses a late Save past it
    // (the tool returns `timed_out` to the agent at that moment), so a stale card
    // can never write a credential after the agent moved on.
    const expiresAt = (req?.payload as { expires_at_ms?: number }).expires_at_ms;
    expect(typeof expiresAt).toBe('number');
    expect(expiresAt).toBeGreaterThan(Date.now());
  });

  it('arguments schema has no value field on any variant', async () => {
    const { cap } = await importFresh();
    // A value key on a field arg must be rejected by the schema.
    const parsed = cap.CaptureArgs.safeParse({
      action: 'capture',
      display_name: 'x',
      fields: [{ field_key: 'password', selector: '#p', value: SENTINEL_PASSWORD }],
    });
    // zod .object with unknown key is stripped, not errored — assert it never
    // survives into the parsed args.
    if (parsed.success) {
      expect(JSON.stringify(parsed.data)).not.toContain(SENTINEL_PASSWORD);
      expect(JSON.stringify(parsed.data)).not.toContain('"value"');
    }
  });

  it('refuses cleanly on an unsafe (non-https) destination', async () => {
    const { cap } = await importFresh();
    (globalThis as unknown as { chrome: Record<string, unknown> }).chrome.tabs = {
      query: async () => [{ id: TAB_ID, url: 'http://admin.example.com/login' }],
      get: async () => ({ id: TAB_ID, url: 'http://admin.example.com/login' }),
      onRemoved: { addListener: () => {} },
    };
    const result = await cap.runCredentialCapture(
      {
        action: 'capture',
        display_name: 'x',
        fields: [{ field_key: 'password', selector: '#p' }],
      } as never,
      ctx,
    );
    expect(result.status).toBe('unsafe_destination');
    // No capture card was ever shown for an unsafe page.
    expect(broadcasts.find((b) => b.kind === 'tool:capture-credential-request')).toBeUndefined();
  });

  it('a cancelled card yields status cancelled, no value anywhere', async () => {
    const { cap } = await importFresh();
    postImpl = async (path) =>
      path.endsWith('/capture-context')
        ? {
            ok: true,
            status: 200,
            data: {
              branch: 'unknown',
              normalized_origin: PAGE_ORIGIN,
              recipe: null,
              guidance: 'x',
            },
          }
        : { ok: false, status: 404, error: 'unmocked' };
    // Disable the auto-success responder; we will cancel manually.
    autoRespond = false;
    const runP = cap.runCredentialCapture(
      {
        action: 'capture',
        display_name: 'x',
        fields: [{ field_key: 'password', selector: '#p' }],
      } as never,
      ctx,
    );
    // Wait until the handler has broadcast its capture request + registered
    // its listener, then answer with a cancel.
    for (
      let i = 0;
      i < 100 && !broadcasts.some((b) => b.kind === 'tool:capture-credential-request');
      i++
    ) {
      await new Promise((r) => setTimeout(r, 5));
    }
    captureResponder?.({ callId: ctx.callId, cancelled: true });
    const result = await runP;
    expect(result.status).toBe('cancelled');
    expect(allEgress(result)).not.toContain(SENTINEL_PASSWORD);
  });
});

describe('captureCredential vault route — value goes to the write body only', () => {
  it('sends field_values to /capture and returns a value-free receipt', async () => {
    const { vault } = await importFresh();
    postImpl = async (path, body) => {
      if (path.endsWith('/capture')) {
        // The server got the values (that is the whole point of the write)...
        const b = body as { field_values?: Record<string, string> };
        expect(b.field_values?.password).toBe(SENTINEL_PASSWORD);
        // ...and answers with a value-free receipt.
        return {
          ok: true,
          status: 200,
          data: {
            status: 'captured',
            credential_item_id: ITEM_ID,
            branch: 'unknown',
            field_keys: ['password', 'username'],
            proceed: true,
            propose_recipe: true,
          },
        };
      }
      return { ok: false, status: 404, error: 'unmocked' };
    };

    const result = await vault.captureCredential({
      display_name: 'Example Admin',
      login_url: PAGE_URL,
      fields: [
        { field_key: 'username', selector: '#u', secret: false },
        { field_key: 'password', selector: '#p', secret: true },
      ],
      field_values: { username: SENTINEL_USER, password: SENTINEL_PASSWORD },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.credential_item_id).toBe(ITEM_ID);
      // The receipt carries NO value.
      expect(JSON.stringify(result.data)).not.toContain(SENTINEL_PASSWORD);
    }
    // The value appears ONLY in the /capture request body, and that POST is silent.
    const capturePost = posts.find((p) => p.path.endsWith('/capture'));
    expect(capturePost).toBeTruthy();
    // It never leaked into a log line.
    expect(JSON.stringify(logCalls)).not.toContain(SENTINEL_PASSWORD);
  });

  it('proposeLoginRecipe carries selectors, never a value', async () => {
    const { vault } = await importFresh();
    postImpl = async (path) =>
      path.endsWith('/recipe-proposal')
        ? {
            ok: true,
            status: 200,
            data: {
              status: 'proposed',
              recipe_id: null,
              normalized_origin: PAGE_ORIGIN,
              provenance: 'human',
              recipe: {},
            },
          }
        : { ok: false, status: 404, error: 'unmocked' };
    const result = await vault.proposeLoginRecipe({
      normalized_origin: PAGE_ORIGIN,
      field_map: [{ selector: '#p', field_key: 'password' }],
      submit: { kind: 'click', selector: '#go' },
    });
    expect(result.ok).toBe(true);
    const proposalPost = posts.find((p) => p.path.endsWith('/recipe-proposal'));
    expect(JSON.stringify(proposalPost?.body)).not.toContain(SENTINEL_PASSWORD);
  });
});
