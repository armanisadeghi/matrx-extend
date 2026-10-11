/**
 * Finding Matrx 2 (the new AI Matrx desktop app) on this computer, and pairing with it.
 *
 * Matrx 2 answers `GET /v1/health` with `service: "matrx-desktop"` on the first free port of
 * 22140-22159 (the installed app) or 22240-22259 (a development copy). It deliberately never
 * answers Matrx Local's `/health`, because Matrx Local's shell takes the first port answering
 * `/health` as its own engine. The two apps can therefore run side by side, and this module never
 * touches the Matrx Local discovery in `../discovery.ts`.
 *
 * Pairing is one loopback call: `POST /v1/pair` from this extension's own origin returns the
 * pairing token, which rides the WebSocket subprotocol as `bearer.<token>`. Matrx 2 refuses any
 * other origin, and refuses everyone while the person has Browser connection turned off.
 *
 * The cost of a miss matters (most people do not run Matrx 2 yet): the port that answered last is
 * re-probed on every tick (one request), and the full sweep backs off to once every two minutes.
 * A person pressing Re-discover clears the backoff (`resetMatrx2DiscoveryBackoff`).
 */

import { log } from '@/lib/debug/log';
import { BrowserPairResult, DesktopHealth } from '@ai-matrx/desktop-protocol';

export type Matrx2Health = DesktopHealth;

/** The installed app's range first, then a development copy's. */
export const MATRX2_PORT_RANGES = [
  { first: 22140, last: 22159 },
  { first: 22240, last: 22259 },
] as const;

const PROBE_TIMEOUT_MS = 300;
const PAIR_TIMEOUT_MS = 3_000;
const SWEEP_BACKOFF_MS = [30_000, 60_000, 120_000] as const;
const STORAGE_KEY_LAST_PORT = 'matrx2.lastPort';

export interface Matrx2Found {
  port: number;
  baseUrl: string;
  health: Matrx2Health;
}

let consecutiveEmptySweeps = 0;
let nextSweepAllowedAt = 0;
let inFlight: Promise<Matrx2Found | null> | null = null;

/** For a person's Re-discover only; a background poll never calls this. */
export function resetMatrx2DiscoveryBackoff(): void {
  consecutiveEmptySweeps = 0;
  nextSweepAllowedAt = 0;
}

/** Is Matrx 2 answering on this port? Resolves with its health, or null. */
export async function probeMatrx2Port(port: number, timeoutMs = PROBE_TIMEOUT_MS): Promise<Matrx2Health | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/v1/health`, { method: 'GET', signal: ctrl.signal });
    if (!res.ok) return null;
    const parsed = DesktopHealth.safeParse(await res.json().catch(() => null));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Find Matrx 2 on this computer, or null (not running, or still backed off after a miss). */
export function findMatrx2(): Promise<Matrx2Found | null> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const last = await readLastPort();
      if (last !== null) {
        const health = await probeMatrx2Port(last);
        if (health) return accept(last, health);
      }
      if (Date.now() < nextSweepAllowedAt) return null;
      for (const range of MATRX2_PORT_RANGES) {
        const ports: number[] = [];
        for (let p = range.first; p <= range.last; p += 1) if (p !== last) ports.push(p);
        const hit = await Promise.any(
          ports.map(async (port) => {
            const health = await probeMatrx2Port(port);
            if (!health) throw new Error('no Matrx 2');
            return { port, health };
          }),
        ).catch(() => null);
        if (hit) return accept(hit.port, hit.health);
      }
      backOff();
      return null;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

async function accept(port: number, health: Matrx2Health): Promise<Matrx2Found> {
  consecutiveEmptySweeps = 0;
  nextSweepAllowedAt = 0;
  try {
    await chrome.storage.local.set({ [STORAGE_KEY_LAST_PORT]: port });
  } catch {
    // swallow-ok: the last-port hint only saves a sweep next time
  }
  return { port, baseUrl: `http://127.0.0.1:${port}`, health };
}

function backOff(): void {
  const wait = SWEEP_BACKOFF_MS[Math.min(consecutiveEmptySweeps, SWEEP_BACKOFF_MS.length - 1)] ?? 120_000;
  consecutiveEmptySweeps += 1;
  nextSweepAllowedAt = Date.now() + wait;
}

async function readLastPort(): Promise<number | null> {
  try {
    const r = await chrome.storage.local.get([STORAGE_KEY_LAST_PORT]);
    const v = r[STORAGE_KEY_LAST_PORT];
    return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 65535 ? v : null;
  } catch {
    return null;
  }
}

/** Why pairing failed, in words a person can act on. */
export type Matrx2PairErrorCode = 'browser_connection_off' | 'forbidden' | 'unreachable' | 'bad_answer';

export class Matrx2PairError extends Error {
  readonly code: Matrx2PairErrorCode;
  constructor(message: string, code: Matrx2PairErrorCode) {
    super(message);
    this.name = 'Matrx2PairError';
    this.code = code;
  }
}

/**
 * Ask Matrx 2 for the pairing token. Called before every (re)connect, so a token the person reset
 * in Matrx 2 (Computer › Browsers) heals on the next attempt without any step in the browser.
 */
export async function pairWithMatrx2(baseUrl: string, clientInstance: string): Promise<BrowserPairResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PAIR_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/v1/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_instance: clientInstance }),
      signal: ctrl.signal,
    });
  } catch (err) {
    throw new Matrx2PairError(`Matrx 2 did not answer: ${(err as Error).message}`, 'unreachable');
  } finally {
    clearTimeout(timer);
  }
  const body = (await res.json().catch(() => null)) as { error?: string; message?: string } | null;
  if (!res.ok) {
    const code = body?.error === 'browser_connection_off' ? 'browser_connection_off' : 'forbidden';
    const message = body?.message ?? `Matrx 2 refused pairing (${res.status})`;
    log.warn('desktop', `Matrx 2 pairing refused: ${message}`);
    throw new Matrx2PairError(message, code);
  }
  const parsed = BrowserPairResult.safeParse(body);
  if (!parsed.success) throw new Matrx2PairError('Matrx 2 answered pairing with something unexpected', 'bad_answer');
  return parsed.data;
}
