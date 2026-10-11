/**
 * The extension as a client of Matrx 2: the paired socket, `browser.register`, and the agent calls
 * Matrx 2 sends this browser.
 *
 * Shape (the contract is `@ai-matrx/desktop-protocol`'s cap browser, protocol 1.28):
 *   1. find Matrx 2 with `GET /v1/health` (./discovery.ts) and pair with `POST /v1/pair`;
 *   2. connect to `/v1/connect` with subprotocols `matrx.v1` + `bearer.<pair token>`, hello as
 *      clientType "extension" (the package client does this);
 *   3. once the welcome arrives, `browser.register` with this profile's instance id, a label, the
 *      browser, the extension version and the person's AI Matrx access token. Matrx 2 drives this
 *      browser only when that account is the one Matrx 2 is signed in to;
 *   4. each `browser.invoke` runs through the same permission-gated executor as every other
 *      outside caller (`handleWebmcpCall`, initiator 'desktop': action tools always ask the person,
 *      privileged tools are refused). While the person is being asked, `browser.progress`
 *      (awaiting_confirmation) tells Matrx 2 to keep waiting; the answer goes back as
 *      `browser.result`.
 *
 * The socket lives in the service worker: Chrome 116+ (our minimum) keeps a worker alive while its
 * WebSocket carries traffic, and the client's 25 s heartbeat is that traffic. Matrx Local's socket
 * (../ws-offscreen.ts) is a separate channel and is untouched.
 *
 * When dialing stops: Matrx 2 disconnecting this browser (Computer › Browsers › Disconnect) stops
 * it until the person reconnects from the extension or the browser restarts; Browser connection
 * turned off stops it until Matrx 2 reports it on again; a reset pairing code heals by itself
 * (every dial asks `/v1/pair` for the current token).
 */

import { log } from '@/lib/debug/log';
import {
  BEARER_PREFIX,
  type BrowserInvokeEvent,
  type BrowserKind,
  type BrowserSession,
  SUBPROTOCOL,
} from '@ai-matrx/desktop-protocol';
import {
  type DesktopClient,
  type DesktopClientState,
  type WebSocketFactory,
  createDesktopClient,
} from '@ai-matrx/desktop-protocol/client';
import { type Matrx2Found, findMatrx2, pairWithMatrx2 } from './discovery';

// ─── Collaborators (injectable for tests; production defaults wired in ./wire.ts) ─────────────

export interface Matrx2CallOutcome {
  ok: boolean;
  result?: unknown;
  error?: string;
}

export interface Matrx2Deps {
  /** The permission-gated executor (`handleWebmcpCall` with initiator 'desktop'). */
  runTool: (
    call: { callId: string; toolName: string; args: Record<string, unknown> },
    hooks: { onAwaitingConfirmation: () => void; onRunning: () => void },
  ) => Promise<Matrx2CallOutcome>;
  /** The person's current AI Matrx access token, or null when signed out. */
  accessToken: () => Promise<string | null>;
  extensionVersion: () => string;
  /** Default: globalThis.WebSocket. */
  webSocket?: WebSocketFactory;
  find?: () => Promise<Matrx2Found | null>;
  pair?: typeof pairWithMatrx2;
  /** Survives service-worker restarts, not browser restarts (chrome.storage.session). */
  sessionStore?: {
    get: (key: string) => Promise<unknown>;
    set: (key: string, value: unknown) => Promise<void>;
  };
  localStore?: {
    get: (key: string) => Promise<unknown>;
    set: (key: string, value: unknown) => Promise<void>;
  };
  brands?: () => string[];
}

// ─── Public state (Debug › Bridges, Settings) ────────────────────────────────────────────────

export type Matrx2Status =
  /** Matrx 2 is not running on this computer (or not found yet). */
  | 'not_found'
  /** Matrx 2 has Browser connection turned off. */
  | 'off'
  | 'connecting'
  /** Connected and registered; `session.state` says whether agents may drive this browser. */
  | 'connected'
  /** The person disconnected this browser in Matrx 2; it stays off until they reconnect. */
  | 'disconnected'
  | 'error';

export interface Matrx2State {
  status: Matrx2Status;
  port: number | null;
  appVersion: string | null;
  session: BrowserSession | null;
  calls: number;
  lastError: string | null;
}

const STOP_KEY = 'matrx2.stopped';
const INSTANCE_KEY = 'matrx2.clientInstance';
const LABEL_KEY = 'matrx2.clientLabel';
/** Consecutive failed dials before the socket gives up and the 30 s probe takes over. */
const MAX_FAILED_DIALS = 4;
/** Room left in Matrx 2's message cap for the envelope around a result. */
const RESULT_HEADROOM_BYTES = 64 * 1024;

let deps: Matrx2Deps | null = null;
let client: DesktopClient | null = null;
let found: Matrx2Found | null = null;
let registeredOnce = false;
let state: Matrx2State = {
  status: 'not_found',
  port: null,
  appVersion: null,
  session: null,
  calls: 0,
  lastError: null,
};
const listeners = new Set<(s: Matrx2State) => void>();
const running = new Set<string>();

export function getMatrx2State(): Matrx2State {
  return state;
}

export function onMatrx2Change(cb: (s: Matrx2State) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function setState(patch: Partial<Matrx2State>): void {
  state = { ...state, ...patch };
  for (const cb of [...listeners]) {
    try {
      cb(state);
    } catch (err) {
      log.warn('desktop', 'Matrx 2 state listener threw', (err as Error).message);
    }
  }
}

/** The open, registered client, for desktop_run_command. Null unless agents may use it. */
export function getMatrx2Client(): DesktopClient | null {
  return client && state.status === 'connected' && state.session?.routable ? client : null;
}

export function configureMatrx2(d: Matrx2Deps): void {
  deps = d;
}

// ─── Stores ──────────────────────────────────────────────────────────────────────────────────

const chromeSession = {
  get: async (key: string) => (await chrome.storage.session.get([key]))[key],
  set: async (key: string, value: unknown) => chrome.storage.session.set({ [key]: value }),
};
const chromeLocal = {
  get: async (key: string) => (await chrome.storage.local.get([key]))[key],
  set: async (key: string, value: unknown) => chrome.storage.local.set({ [key]: value }),
};

type StopReason = 'disconnected' | 'off';

async function readStop(d: Matrx2Deps): Promise<StopReason | null> {
  try {
    const v = await (d.sessionStore ?? chromeSession).get(STOP_KEY);
    return v === 'disconnected' || v === 'off' ? v : null;
  } catch {
    return null;
  }
}

async function writeStop(d: Matrx2Deps, reason: StopReason | null): Promise<void> {
  try {
    await (d.sessionStore ?? chromeSession).set(STOP_KEY, reason);
  } catch {
    // swallow-ok: without session storage the stop lasts only this worker's life
  }
}

/** This Chrome profile's stable id: minted once, kept in local storage. */
export async function clientInstance(d: Matrx2Deps): Promise<string> {
  const store = d.localStore ?? chromeLocal;
  const existing = await store.get(INSTANCE_KEY).catch(() => null);
  if (typeof existing === 'string' && /^[A-Za-z0-9_.:-]{1,64}$/.test(existing)) return existing;
  const minted = `ext_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
  await store.set(INSTANCE_KEY, minted).catch(() => undefined);
  return minted;
}

/** Which browser this is, from the brand list Chromium reports. */
export function browserKind(brands: string[]): { kind: BrowserKind; name: string } {
  const has = (s: string) => brands.some((b) => b.toLowerCase().includes(s));
  if (has('edge')) return { kind: 'edge', name: 'Edge' };
  if (has('brave')) return { kind: 'brave', name: 'Brave' };
  if (has('opera')) return { kind: 'opera', name: 'Opera' };
  if (has('vivaldi')) return { kind: 'vivaldi', name: 'Vivaldi' };
  if (has('arc')) return { kind: 'arc', name: 'Arc' };
  if (has('google chrome')) return { kind: 'chrome', name: 'Chrome' };
  if (has('firefox')) return { kind: 'firefox', name: 'Firefox' };
  if (has('chromium')) return { kind: 'chromium', name: 'Chromium' };
  return { kind: 'other', name: 'Browser' };
}

function defaultBrands(): string[] {
  const uaData = (
    navigator as Navigator & { userAgentData?: { brands?: Array<{ brand: string }> } }
  ).userAgentData;
  const brands = uaData?.brands?.map((b) => b.brand) ?? [];
  if (brands.length === 0 && /firefox/i.test(navigator.userAgent)) return ['Firefox'];
  return brands;
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────────────────────

/**
 * Bring the connection to where it should be. Safe to call on every probe tick, on sign-in and on
 * sign-out: it dials only when Matrx 2 is here and the person has not turned this browser off.
 */
export async function ensureMatrx2Connection(): Promise<Matrx2State> {
  const d = deps;
  if (!d) return state;
  const stop = await readStop(d);
  const here = await (d.find ?? findMatrx2)();
  if (!here) {
    if (!client || client.getState().status !== 'open') {
      dropClient();
      setState({ status: 'not_found', port: null, appVersion: null, session: null });
    }
    return state;
  }
  found = here;
  setState({ port: here.port, appVersion: here.health.version });
  if (here.health.browser_connection === 'off') {
    dropClient();
    if (stop !== 'disconnected') await writeStop(d, 'off');
    setState({ status: stop === 'disconnected' ? 'disconnected' : 'off', session: null });
    return state;
  }
  if (stop === 'off') await writeStop(d, null); // turned back on: resume by itself
  if (stop === 'disconnected') {
    setState({ status: 'disconnected', session: null });
    return state;
  }
  if (!client) startClient(d);
  else if (client.getState().status === 'open') await register(d); // a new sign-in re-checks the account
  return state;
}

/** A person pressed Reconnect: clear a Matrx 2 "Disconnect" and dial again. */
export async function reconnectMatrx2(): Promise<Matrx2State> {
  if (!deps) return state;
  await writeStop(deps, null);
  dropClient();
  return ensureMatrx2Connection();
}

/** Close for good (tests, sign-out of the browser is NOT a reason: a signed-out session is listed). */
export function stopMatrx2(): void {
  dropClient();
  setState({ status: 'not_found', session: null });
}

function dropClient(): void {
  if (!client) return;
  const c = client;
  client = null;
  registeredOnce = false;
  c.close();
}

function startClient(d: Matrx2Deps): void {
  const c = createDesktopClient({
    url: async () => {
      const here = (await (d.find ?? findMatrx2)()) ?? found;
      if (!here) throw new Error('Matrx 2 is not running');
      found = here;
      return `ws://127.0.0.1:${here.port}${here.health.ws_path}`;
    },
    // Re-read on every dial, so a pairing code reset in Matrx 2 heals here without a step.
    protocols: async () => {
      if (!found) throw new Error('Matrx 2 is not running');
      const pair = await (d.pair ?? pairWithMatrx2)(found.baseUrl, await clientInstance(d));
      return [SUBPROTOCOL, `${BEARER_PREFIX}${pair.pair_token}`];
    },
    clientType: 'extension',
    clientVersion: d.extensionVersion(),
    ...(d.webSocket ? { webSocket: d.webSocket } : {}),
    onDiagnostic: (diag) => {
      if (diag.kind === 'handler_threw')
        log.warn('desktop', `Matrx 2 client: ${diag.where}`, diag.error);
    },
  });
  client = c;
  setState({ status: 'connecting', lastError: null });
  c.on('browser.invoke', (payload) => {
    void handleInvoke(c, d, payload);
  });
  c.subscribe(() => {
    if (client !== c) return;
    void onClientState(c, d, c.getState());
  });
  c.connect();
}

async function onClientState(
  c: DesktopClient,
  d: Matrx2Deps,
  s: DesktopClientState,
): Promise<void> {
  if (s.status === 'open') {
    // Once per open socket: every reconnect is a new session on Matrx 2's side.
    if (!registeredOnce) {
      registeredOnce = true;
      await register(d);
    }
    return;
  }
  registeredOnce = false;
  if (s.status === 'closed') {
    client = null;
    if (s.outcome === 'not_owned') {
      // Matrx 2 said no: either the person pressed Disconnect, or turned Browser connection off.
      const health = found ? await (d.find ?? findMatrx2)() : null;
      const off = health?.health.browser_connection === 'off';
      await writeStop(d, off ? 'off' : 'disconnected');
      setState({ status: off ? 'off' : 'disconnected', session: null, lastError: null });
    } else {
      setState({
        status: 'error',
        session: null,
        lastError: s.lastError?.message ?? s.outcome ?? 'closed',
      });
    }
    return;
  }
  if (s.status === 'reconnecting') {
    if (s.attempts >= MAX_FAILED_DIALS) {
      // Matrx 2 went away. Stop dialing; the 30 s probe reconnects when it is back.
      dropClient();
      setState({ status: 'not_found', session: null, lastError: s.lastError?.message ?? null });
      return;
    }
    setState({ status: 'connecting', session: null });
    return;
  }
  if (c === client && (s.status === 'connecting' || s.status === 'handshaking'))
    setState({ status: 'connecting' });
}

async function register(d: Matrx2Deps): Promise<void> {
  const c = client;
  if (!c) return;
  const { kind, name } = browserKind((d.brands ?? defaultBrands)());
  const instance = await clientInstance(d);
  const storedLabel = await (d.localStore ?? chromeLocal).get(LABEL_KEY).catch(() => null);
  const label =
    typeof storedLabel === 'string' && storedLabel.trim() ? storedLabel.trim().slice(0, 128) : name;
  const token = await d.accessToken().catch(() => null);
  try {
    const out = await c.request('browser.register', {
      client_instance: instance,
      client_label: label,
      browser: kind,
      extension_version: d.extensionVersion().slice(0, 32),
      account_token: token && token.length >= 16 && token.length <= 8192 ? token : null,
    });
    if (client !== c) return;
    setState({ status: 'connected', session: out.session, lastError: null });
    log.info(
      'desktop',
      `Matrx 2: registered as ${out.session.client_label} (${out.session.state})`,
    );
  } catch (err) {
    if (client !== c) return;
    setState({
      status: 'error',
      lastError: `Could not register with Matrx 2: ${(err as Error).message}`,
    });
  }
}

/** Matrx 2's error codes, from the executor's words. */
function errorCode(message: string): string | null {
  if (/not registered/i.test(message)) return 'tool_not_found';
  if (/denied|said no|declined/i.test(message)) return 'denied';
  if (/tier and not callable|admin-only/i.test(message)) return 'not_allowed';
  if (/failed schema/i.test(message)) return 'invalid_args';
  if (/permission/i.test(message)) return 'needs_permission';
  return null;
}

async function handleInvoke(
  c: DesktopClient,
  d: Matrx2Deps,
  call: BrowserInvokeEvent,
): Promise<void> {
  if (running.has(call.call_id)) return;
  running.add(call.call_id);
  const progress = (phase: 'awaiting_confirmation' | 'running') => {
    void c.request('browser.progress', { call_id: call.call_id, phase }).catch(() => undefined);
  };
  let outcome: Matrx2CallOutcome;
  try {
    outcome = await d.runTool(
      { callId: call.call_id, toolName: call.tool, args: call.args },
      {
        onAwaitingConfirmation: () => progress('awaiting_confirmation'),
        onRunning: () => progress('running'),
      },
    );
  } catch (err) {
    outcome = {
      ok: false,
      error: `The extension could not run ${call.tool}: ${(err as Error).message}`,
    };
  }
  setState({ calls: state.calls + 1 });
  const answer = outcome.ok
    ? { call_id: call.call_id, ok: true, result: outcome.result ?? null, error: null }
    : {
        call_id: call.call_id,
        ok: false,
        result: null,
        error: {
          message: (outcome.error ?? 'The tool failed').slice(0, 1000),
          code: errorCode(outcome.error ?? ''),
        },
      };
  try {
    const size = outcome.ok
      ? new TextEncoder().encode(JSON.stringify(answer.result ?? null)).length
      : 0;
    const cap =
      (c.getState().welcome?.limits.max_message_bytes ?? 8_388_608) - RESULT_HEADROOM_BYTES;
    if (size > cap) {
      await c.request('browser.result', {
        call_id: call.call_id,
        ok: false,
        result: null,
        error: {
          message: `${call.tool} returned ${size} bytes, more than Matrx 2 accepts in one answer`,
          code: 'payload_too_large',
        },
      });
    } else {
      await c.request('browser.result', answer);
    }
  } catch (err) {
    log.warn('desktop', `Matrx 2: could not answer ${call.tool}`, (err as Error).message);
  } finally {
    running.delete(call.call_id);
  }
}

/** Test seam: forget every module-level record. */
export function __resetMatrx2ForTests(): void {
  dropClient();
  deps = null;
  found = null;
  registeredOnce = false;
  running.clear();
  listeners.clear();
  state = {
    status: 'not_found',
    port: null,
    appVersion: null,
    session: null,
    calls: 0,
    lastError: null,
  };
}
