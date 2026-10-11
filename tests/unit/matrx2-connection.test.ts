/**
 * The extension's Matrx 2 connection against a device double that speaks the published contract:
 * every message the extension sends is parsed with `@ai-matrx/desktop-protocol`'s own schemas
 * (HelloMsg, RequestMsg, OPS[op].params), and every message the double sends is parsed with them
 * too (Welcome, OPS[op].result, EVENTS) — so a wire shape the real Matrx 2 core would refuse fails
 * here. The behaviours mirror matrx-desktop's conformance suite (test/conformance/extension-bridge).
 */
import {
  BEARER_PREFIX,
  BrowserSession,
  CloseCode,
  EVENTS,
  HelloMsg,
  OPS,
  PING_TEXT,
  PONG_TEXT,
  PROTOCOL_VERSION,
  RequestMsg,
  SUBPROTOCOL,
  Welcome,
} from '@ai-matrx/desktop-protocol';
import type { WebSocketLike } from '@ai-matrx/desktop-protocol/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/debug/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
}));

import {
  __resetMatrx2ForTests,
  browserKind,
  configureMatrx2,
  ensureMatrx2Connection,
  getMatrx2Client,
  getMatrx2State,
  type Matrx2Deps,
  reconnectMatrx2,
} from '@/lib/desktop/matrx2/connection';
import type { Matrx2Found } from '@/lib/desktop/matrx2/discovery';

const OWNER_TOKEN = 'owner-access-token-0123456789';

type Sent = { op: string; params: Record<string, unknown> };

/** One socket the device double accepted. */
class FakeSocket implements WebSocketLike {
  readyState = 0;
  binaryType = 'arraybuffer';
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  constructor(
    readonly url: string,
    readonly protocols: string[],
    private readonly device: FakeDevice,
  ) {
    queueMicrotask(() => {
      if (!device.accepting) {
        this.readyState = 3;
        this.onclose?.({ code: 1006, reason: '' });
        return;
      }
      this.readyState = 1;
      this.onopen?.({});
    });
  }
  send(data: string | ArrayBuffer | Uint8Array): void {
    if (typeof data !== 'string') throw new Error('the extension never sends binary');
    if (data === PING_TEXT) {
      queueMicrotask(() => this.onmessage?.({ data: PONG_TEXT }));
      return;
    }
    this.device.receive(this, JSON.parse(data));
  }
  close(code = 1000, reason = ''): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    queueMicrotask(() => this.onclose?.({ code, reason }));
  }
  /** The device closes this socket. */
  drop(code: number, reason = ''): void {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }
  deliver(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

class FakeDevice {
  accepting = true;
  sockets: FakeSocket[] = [];
  sent: Sent[] = [];
  sessionState: 'connected' | 'different_account' | 'extension_signed_out' = 'connected';
  maxMessageBytes = 8_388_608;
  private waiters: Array<{ match: (s: Sent) => boolean; resolve: (s: Sent) => void }> = [];

  get current(): FakeSocket {
    const s = this.sockets.at(-1);
    if (!s) throw new Error('no socket');
    return s;
  }

  receive(socket: FakeSocket, raw: Record<string, unknown>): void {
    if (raw.type === 'hello') {
      const hello = HelloMsg.parse(raw);
      expect(hello.clientType).toBe('extension');
      const welcome = Welcome.parse({
        protocol_version: PROTOCOL_VERSION,
        session_id: 'sess_00000001',
        client_id: `c_${this.sockets.length.toString().padStart(8, '0')}`,
        device_id: 'dev_test_0001',
        device_name: 'Test Mac',
        app_version: '0.9.0',
        platform: 'darwin',
        ops: Object.keys(OPS).map((k) => {
          const [cap = '', op = ''] = k.split('.');
          return { cap, op, since: '1.0' };
        }),
        limits: {
          max_message_bytes: this.maxMessageBytes,
          max_frame_payload_bytes: 65_536,
          default_window_bytes: 262_144,
          max_streams_per_client: 8,
          max_resources_per_user: 32,
        },
        server_time_ms: Date.now(),
      });
      queueMicrotask(() => socket.deliver({ type: 'response', id: hello.id, result: welcome }));
      return;
    }
    const req = RequestMsg.parse(raw);
    const key = `${req.cap}.${req.op}` as keyof typeof OPS;
    const spec = OPS[key];
    if (!spec) throw new Error(`unknown op ${key}`);
    const params = spec.params.parse(req.params) as Record<string, unknown>;
    const sent = { op: key, params };
    this.sent.push(sent);
    for (const w of [...this.waiters]) {
      if (w.match(sent)) {
        this.waiters.splice(this.waiters.indexOf(w), 1);
        w.resolve(sent);
      }
    }
    let result: unknown;
    if (key === 'browser.register') {
      const signedIn = params.account_token !== null;
      const st = signedIn ? this.sessionState : 'extension_signed_out';
      result = {
        session: BrowserSession.parse({
          client_instance: params.client_instance,
          client_label: params.client_label,
          browser: params.browser,
          extension_version: params.extension_version,
          state: st,
          routable: st === 'connected',
          account_email: signedIn ? 'admin@admin.com' : null,
          connected_at_ms: Date.now(),
          last_call_at_ms: null,
          calls: 0,
          errors: 0,
          p50_ms: null,
          p95_ms: null,
          awaiting_confirmation: false,
        }),
      };
    } else {
      result = { accepted: true };
    }
    const checked = spec.result.parse(result);
    queueMicrotask(() => socket.deliver({ type: 'response', id: req.id, result: checked }));
  }

  invoke(call_id: string, tool: string, args: Record<string, unknown> = {}): void {
    const payload = EVENTS['browser.invoke'].parse({ call_id, tool, args, deadline_ms: Date.now() + 120_000 });
    this.current.deliver({ type: 'event', cap: 'browser', name: 'invoke', payload });
  }

  waitFor(match: (s: Sent) => boolean): Promise<Sent> {
    const hit = this.sent.find(match);
    if (hit) return Promise.resolve(hit);
    return new Promise((resolve) => this.waiters.push({ match, resolve }));
  }
}

let device: FakeDevice;
let health: Matrx2Found | null;
let pairs: number;
let pairToken: string;
let token: string | null;
let session: Map<string, unknown>;
let local: Map<string, unknown>;
const runTool = vi.fn<Matrx2Deps['runTool']>();

function deps(): Matrx2Deps {
  return {
    runTool,
    accessToken: async () => token,
    extensionVersion: () => '0.2.506',
    webSocket: (url, protocols) => {
      const s = new FakeSocket(url, protocols, device);
      device.sockets.push(s);
      return s;
    },
    find: async () => health,
    pair: async () => {
      pairs += 1;
      return { pair_token: pairToken, ws_path: '/v1/connect' };
    },
    sessionStore: { get: async (k) => session.get(k), set: async (k, v) => void session.set(k, v) },
    localStore: { get: async (k) => local.get(k), set: async (k, v) => void local.set(k, v) },
    brands: () => ['Chromium', 'Google Chrome', 'Not.A/Brand'],
  };
}

function found(browser_connection: 'on' | 'off' = 'on'): Matrx2Found {
  return {
    port: 22141,
    baseUrl: 'http://127.0.0.1:22141',
    health: {
      status: 'ok',
      service: 'matrx-desktop',
      version: '0.9.0',
      protocol_version: PROTOCOL_VERSION,
      ws_path: '/v1/connect',
      device_id: 'dev_test_0001',
      browser_connection,
    },
  };
}

async function until(check: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`timed out waiting for: ${label}`);
}

beforeEach(() => {
  __resetMatrx2ForTests();
  device = new FakeDevice();
  health = found();
  pairs = 0;
  pairToken = 'pair-token-aaaaaaaaaaaaaaaa';
  token = OWNER_TOKEN;
  session = new Map();
  local = new Map();
  runTool.mockReset();
  configureMatrx2(deps());
});

afterEach(() => {
  __resetMatrx2ForTests();
});

describe('Matrx 2 connection', () => {
  it('dials with the pairing token in the subprotocol list, says hello as an extension, then registers', async () => {
    await ensureMatrx2Connection();
    const reg = await device.waitFor((s) => s.op === 'browser.register');
    expect(device.current.url).toBe('ws://127.0.0.1:22141/v1/connect');
    expect(device.current.protocols).toEqual([SUBPROTOCOL, `${BEARER_PREFIX}${pairToken}`]);
    expect(reg.params).toMatchObject({
      client_label: 'Chrome',
      browser: 'chrome',
      extension_version: '0.2.506',
      account_token: OWNER_TOKEN,
    });
    expect(String(reg.params.client_instance)).toMatch(/^ext_[a-f0-9]{24}$/);
    await until(() => getMatrx2State().status === 'connected', 'connected');
    expect(getMatrx2State().session?.routable).toBe(true);
    expect(getMatrx2Client()).not.toBeNull();
  });

  it('keeps one instance id per profile across reconnects', async () => {
    await ensureMatrx2Connection();
    const first = await device.waitFor((s) => s.op === 'browser.register');
    device.current.drop(CloseCode.GOING_AWAY);
    await until(() => device.sent.filter((s) => s.op === 'browser.register').length === 2, 'second register');
    const second = device.sent.filter((s) => s.op === 'browser.register')[1];
    expect(second?.params.client_instance).toBe(first.params.client_instance);
  });

  it('a signed-out extension registers with no token and is listed, never driven', async () => {
    token = null;
    await ensureMatrx2Connection();
    const reg = await device.waitFor((s) => s.op === 'browser.register');
    expect(reg.params.account_token).toBeNull();
    await until(() => getMatrx2State().status === 'connected', 'connected');
    expect(getMatrx2State().session?.state).toBe('extension_signed_out');
    expect(getMatrx2Client()).toBeNull();
  });

  it('a new sign-in re-registers on the open socket with the new token', async () => {
    token = null;
    await ensureMatrx2Connection();
    await until(() => getMatrx2State().status === 'connected', 'connected');
    token = OWNER_TOKEN;
    await ensureMatrx2Connection();
    await until(() => getMatrx2State().session?.routable === true, 'routable');
    const regs = device.sent.filter((s) => s.op === 'browser.register');
    expect(regs.map((r) => r.params.account_token)).toEqual([null, OWNER_TOKEN]);
    expect(device.sockets).toHaveLength(1);
  });

  it('runs an invoke through the executor and answers with browser.result', async () => {
    runTool.mockResolvedValue({ ok: true, result: { tabs: 3 } });
    await ensureMatrx2Connection();
    await until(() => getMatrx2State().status === 'connected', 'connected');
    device.invoke('call_1', 'list_open_tabs', { window: 'current' });
    const res = await device.waitFor((s) => s.op === 'browser.result');
    expect(runTool).toHaveBeenCalledWith(
      { callId: 'call_1', toolName: 'list_open_tabs', args: { window: 'current' } },
      expect.objectContaining({ onAwaitingConfirmation: expect.any(Function) }),
    );
    expect(res.params).toEqual({ call_id: 'call_1', ok: true, result: { tabs: 3 }, error: null });
  });

  it('says awaiting_confirmation while the person is asked, then running, then the answer', async () => {
    let approve: (() => void) | null = null;
    runTool.mockImplementation(async (_call, hooks) => {
      hooks.onAwaitingConfirmation();
      await new Promise<void>((r) => {
        approve = r;
      });
      hooks.onRunning();
      return { ok: true, result: 'navigated' };
    });
    await ensureMatrx2Connection();
    await until(() => getMatrx2State().status === 'connected', 'connected');
    device.invoke('call_2', 'navigate', { url: 'https://example.com' });
    const waiting = await device.waitFor((s) => s.op === 'browser.progress');
    expect(waiting.params).toEqual({ call_id: 'call_2', phase: 'awaiting_confirmation' });
    expect(device.sent.some((s) => s.op === 'browser.result')).toBe(false);
    await until(() => approve !== null, 'confirmation asked');
    approve?.();
    const result = await device.waitFor((s) => s.op === 'browser.result');
    expect(device.sent.filter((s) => s.op === 'browser.progress').map((s) => s.params.phase)).toEqual([
      'awaiting_confirmation',
      'running',
    ]);
    expect(result.params).toMatchObject({ call_id: 'call_2', ok: true, result: 'navigated' });
  });

  it('a declined confirmation comes back as a refusal with code "denied"', async () => {
    runTool.mockResolvedValue({ ok: false, error: 'User denied this action' });
    await ensureMatrx2Connection();
    await until(() => getMatrx2State().status === 'connected', 'connected');
    device.invoke('call_3', 'navigate', { url: 'https://example.com' });
    const res = await device.waitFor((s) => s.op === 'browser.result');
    expect(res.params).toEqual({
      call_id: 'call_3',
      ok: false,
      result: null,
      error: { message: 'User denied this action', code: 'denied' },
    });
  });

  it('an unknown tool answers tool_not_found; an executor crash still answers', async () => {
    runTool.mockResolvedValueOnce({ ok: false, error: "webmcp: tool 'nope' not registered" });
    runTool.mockRejectedValueOnce(new Error('boom'));
    await ensureMatrx2Connection();
    await until(() => getMatrx2State().status === 'connected', 'connected');
    device.invoke('call_4', 'nope');
    device.invoke('call_5', 'read_page');
    await until(() => device.sent.filter((s) => s.op === 'browser.result').length === 2, 'two results');
    const [a, b] = device.sent.filter((s) => s.op === 'browser.result');
    expect(a?.params.error).toEqual({ message: "webmcp: tool 'nope' not registered", code: 'tool_not_found' });
    expect(b?.params).toMatchObject({ call_id: 'call_5', ok: false });
    expect(String((b?.params.error as { message: string }).message)).toContain('boom');
  });

  it('a result larger than Matrx 2 accepts is answered as payload_too_large, not dropped', async () => {
    device.maxMessageBytes = 100_000;
    runTool.mockResolvedValue({ ok: true, result: { png: 'x'.repeat(200_000) } });
    await ensureMatrx2Connection();
    await until(() => getMatrx2State().status === 'connected', 'connected');
    device.invoke('call_6', 'take_screenshot');
    const res = await device.waitFor((s) => s.op === 'browser.result');
    expect(res.params).toMatchObject({ call_id: 'call_6', ok: false, error: { code: 'payload_too_large' } });
  });

  it('Disconnect in Matrx 2 stops dialing until the person reconnects', async () => {
    await ensureMatrx2Connection();
    await until(() => getMatrx2State().status === 'connected', 'connected');
    device.current.drop(CloseCode.AUTH_FORBIDDEN, 'disconnected in Matrx 2');
    await until(() => getMatrx2State().status === 'disconnected', 'disconnected');
    await ensureMatrx2Connection();
    await ensureMatrx2Connection();
    expect(device.sockets).toHaveLength(1);
    expect(getMatrx2State().status).toBe('disconnected');
    await reconnectMatrx2();
    await until(() => getMatrx2State().status === 'connected', 'connected again');
    expect(device.sockets).toHaveLength(2);
  });

  it('Browser connection off: no dial; back on: connects by itself', async () => {
    health = found('off');
    await ensureMatrx2Connection();
    expect(getMatrx2State().status).toBe('off');
    expect(device.sockets).toHaveLength(0);
    health = found('on');
    await ensureMatrx2Connection();
    await until(() => getMatrx2State().status === 'connected', 'connected');
  });

  it('turning Browser connection off while connected stops, and resumes when it is on again', async () => {
    await ensureMatrx2Connection();
    await until(() => getMatrx2State().status === 'connected', 'connected');
    health = found('off');
    device.current.drop(CloseCode.AUTH_FORBIDDEN, 'Browser connection is off in Matrx 2');
    await until(() => getMatrx2State().status === 'off', 'off');
    health = found('on');
    await ensureMatrx2Connection();
    await until(() => getMatrx2State().status === 'connected', 'connected again');
  });

  it('a reset pairing code heals: the refused socket re-pairs and dials again', async () => {
    await ensureMatrx2Connection();
    await until(() => getMatrx2State().status === 'connected', 'connected');
    expect(pairs).toBe(1);
    pairToken = 'pair-token-bbbbbbbbbbbbbbbb';
    device.current.drop(CloseCode.AUTH_INVALID, 'pairing code reset');
    await until(() => device.sent.filter((s) => s.op === 'browser.register').length === 2, 're-registered');
    expect(pairs).toBe(2);
    expect(device.current.protocols).toContain(`${BEARER_PREFIX}pair-token-bbbbbbbbbbbbbbbb`);
  });

  it('Matrx 2 not running: nothing dials; it connects on the tick after it starts', async () => {
    health = null;
    await ensureMatrx2Connection();
    expect(getMatrx2State().status).toBe('not_found');
    expect(device.sockets).toHaveLength(0);
    health = found();
    await ensureMatrx2Connection();
    await until(() => getMatrx2State().status === 'connected', 'connected');
  });
});

describe('browserKind', () => {
  it('names the browser from Chromium brands', () => {
    expect(browserKind(['Chromium', 'Google Chrome'])).toEqual({ kind: 'chrome', name: 'Chrome' });
    expect(browserKind(['Chromium', 'Microsoft Edge'])).toEqual({ kind: 'edge', name: 'Edge' });
    expect(browserKind(['Chromium', 'Brave'])).toEqual({ kind: 'brave', name: 'Brave' });
    expect(browserKind(['Chromium'])).toEqual({ kind: 'chromium', name: 'Chromium' });
    expect(browserKind([])).toEqual({ kind: 'other', name: 'Browser' });
  });
});
