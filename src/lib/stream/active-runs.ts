/**
 * Live-stream registry in chrome.storage.session (docs/AUDIT_2026_06_10.md
 * P1-15).
 *
 * `closeStaleOffscreenOnBoot` runs on EVERY service-worker boot — including
 * the routine ~30s idle reap/rewake cycle — and used to unconditionally
 * close the offscreen document. The offscreen doc is exactly where the
 * long-lived SSE stream (and mic capture) lives, so a quiet stretch of a
 * real run (a slow tool call between server events) could get its stream
 * killed by its own extension waking up.
 *
 * The SW marks a run active when it forwards STREAM_RUN to the offscreen and
 * inactive when the terminal `done` chunk (or an explicit kill) comes back.
 * `storage.session` survives SW restarts and clears with the browser session
 * — exactly the lifetime of the offscreen document's work.
 *
 * Entries are stamped so a row orphaned by a crash (done never delivered)
 * can't suppress the stale-close forever — callers pass a max age.
 */

import { log } from '@/lib/debug/log';

const KEY = 'matrx.stream.activeRuns';

function sessionStore(): chrome.storage.StorageArea | null {
  try {
    return chrome?.storage?.session ?? null;
  } catch {
    return null;
  }
}

async function read(store: chrome.storage.StorageArea): Promise<Record<string, number>> {
  const r = await store.get([KEY]);
  const raw = r[KEY];
  return raw && typeof raw === 'object' ? (raw as Record<string, number>) : {};
}

export async function markStreamActive(runId: string): Promise<void> {
  const store = sessionStore();
  if (!store) return;
  try {
    const all = await read(store);
    all[runId] = Date.now();
    await store.set({ [KEY]: all });
  } catch (err) {
    log.warn('stream', `markStreamActive failed for ${runId}`, (err as Error)?.message);
  }
}

export async function markStreamInactive(runId: string): Promise<void> {
  const store = sessionStore();
  if (!store) return;
  try {
    const all = await read(store);
    if (!(runId in all)) return;
    delete all[runId];
    await store.set({ [KEY]: all });
  } catch {
    /* best-effort */
  }
}

/**
 * True when any run was marked active within `maxAgeMs`. Rows older than the
 * window are treated as crash debris (and lazily pruned) so they can't pin
 * a genuinely stale offscreen document alive forever.
 */
export async function hasRecentActiveStream(maxAgeMs: number): Promise<boolean> {
  const store = sessionStore();
  if (!store) return false;
  try {
    const all = await read(store);
    const now = Date.now();
    let live = false;
    let pruned = false;
    for (const [runId, startedAt] of Object.entries(all)) {
      if (now - startedAt <= maxAgeMs) {
        live = true;
      } else {
        delete all[runId];
        pruned = true;
      }
    }
    if (pruned) await store.set({ [KEY]: all });
    return live;
  } catch {
    return false;
  }
}
