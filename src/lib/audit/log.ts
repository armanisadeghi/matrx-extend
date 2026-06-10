/**
 * Audit log for cryptographic run receipts (CLAUDE.md roadmap item #8).
 *
 * Storage: chrome.storage.local under `matrx.audit.log`. FIFO ring with
 * a hard cap of MAX_RECEIPTS entries — older receipts are dropped on
 * append. The cap is documented in the Settings UI so users with
 * compliance needs know when to export.
 *
 * Append model:
 *   - Tool start  → append a partial receipt (outputHash='pending', ok=null)
 *   - Tool finish → append a full receipt (outputHash + ok set)
 * Both rows coexist; the full receipt is what compliance cares about,
 * but the partial provides a marker that "we tried" even when the
 * handler crashed before completion.
 *
 * The log is intentionally an append-only sequence rather than a
 * keyed map. Lookup-by-callId returns the LATEST matching entry so
 * `getReceiptByCallId` naturally surfaces the completion when one
 * exists, and the partial when it doesn't.
 */

import type { ToolReceipt } from '@/lib/audit/receipt';
import { getOne, setOne } from '@/lib/storage/chrome-local';

const STORAGE_KEY = 'matrx.audit.log';

/** Hard cap on retained receipts. FIFO eviction. */
export const MAX_RECEIPTS = 1000;

/**
 * In-module write queue. The append is a read-modify-write on a single
 * storage array, and the dispatcher fires receipts with `void` — partial +
 * completed receipts of one call, and receipts from up to 8 concurrent
 * `parallel_for_each_tab` sub-runs, all race the same row. Two appends that
 * both read the same snapshot lose one receipt (classic lost-update) —
 * exactly where the audit trail matters most. Chaining every append on this
 * promise serializes the section without blocking callers (they `void` us).
 * The catch keeps one failed append from wedging the chain forever.
 */
let appendQueue: Promise<void> = Promise.resolve();

/**
 * Append a receipt to the log. Best-effort — if storage write fails,
 * we swallow and log to console so a write hiccup never blocks tool
 * execution. Appends are serialized (see `appendQueue`).
 */
export function appendReceipt(receipt: ToolReceipt): Promise<void> {
  appendQueue = appendQueue.then(async () => {
    try {
      const existing = (await getOne<ToolReceipt[]>(STORAGE_KEY)) ?? [];
      existing.push(receipt);
      if (existing.length > MAX_RECEIPTS) {
        // Drop oldest entries to fit. `splice` mutates in place; we then
        // overwrite the storage row with the trimmed list.
        existing.splice(0, existing.length - MAX_RECEIPTS);
      }
      await setOne(STORAGE_KEY, existing);
    } catch (err) {
      // Audit log is best-effort — but an UNDETECTABLE gap is the worst
      // failure mode for a chain-of-custody feature (audit P2-21): an
      // auditor can't distinguish "call never happened" from "signing
      // failed". Count failures durably so the Settings audit card can
      // surface non-zero coverage gaps.
      console.warn('[matrx-extend][audit] appendReceipt failed', err);
      void recordAuditFailure();
    }
  });
  return appendQueue;
}

const FAILURE_COUNT_KEY = 'matrx.audit.failedCount';

/** Durable count of receipts that failed to sign or persist. */
export async function recordAuditFailure(): Promise<void> {
  try {
    const n = (await getOne<number>(FAILURE_COUNT_KEY)) ?? 0;
    await setOne(FAILURE_COUNT_KEY, n + 1);
  } catch {
    /* counting the failure failed too — console already has the original */
  }
}

export async function getAuditFailureCount(): Promise<number> {
  return (await getOne<number>(FAILURE_COUNT_KEY)) ?? 0;
}

/**
 * Most recent N receipts, newest first. Default returns the entire log.
 */
export async function getRecentReceipts(limit = MAX_RECEIPTS): Promise<ToolReceipt[]> {
  const list = (await getOne<ToolReceipt[]>(STORAGE_KEY)) ?? [];
  // Newest first — slice from the end.
  const start = Math.max(0, list.length - limit);
  return list.slice(start).reverse();
}

/**
 * Look up the LATEST receipt for a given call. Prefers the completed
 * receipt over the partial when both exist (since the full one is
 * always appended after the partial).
 */
export async function getReceiptByCallId(callId: string): Promise<ToolReceipt | null> {
  const list = (await getOne<ToolReceipt[]>(STORAGE_KEY)) ?? [];
  for (let i = list.length - 1; i >= 0; i--) {
    const r = list[i];
    if (r && r.callId === callId) return r;
  }
  return null;
}

/**
 * Wipe the audit log. Caller is responsible for any user confirmation —
 * this is a destructive operation. Public-key history is NOT cleared
 * (so old receipts you exported elsewhere still verify).
 */
export async function clearAuditLog(): Promise<void> {
  await setOne(STORAGE_KEY, []);
}

/**
 * Total number of receipts currently retained. Cheap — single storage
 * read. Useful for the Settings card "X of MAX_RECEIPTS receipts".
 */
export async function getReceiptCount(): Promise<number> {
  const list = (await getOne<ToolReceipt[]>(STORAGE_KEY)) ?? [];
  return list.length;
}
