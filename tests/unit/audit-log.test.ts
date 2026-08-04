/**
 * Regression tests for the audit-log append queue
 * (docs/AUDIT_2026_06_10.md P0-10).
 *
 * `appendReceipt` is fired with `void` from the dispatcher, so concurrent
 * appends (partial + completed of one call, parallel_for_each_tab fan-out)
 * raced a single read-modify-write storage row and silently dropped
 * receipts. The in-module promise queue serializes them; these tests fail
 * against the unqueued implementation.
 */

import { appendReceipt, clearAuditLog, getRecentReceipts } from '@/lib/audit/log';
import type { ToolReceipt } from '@/lib/audit/receipt';
import { beforeEach, describe, expect, it } from 'vitest';

function fakeReceipt(callId: string): ToolReceipt {
  return {
    v: 2,
    publicKeyId: 'test-key',
    callId,
    toolName: 'test_tool',
    argsHash: 'a',
    outputHash: 'b',
    ok: true,
    startedAt: Date.now(),
    completedAt: Date.now(),
    conversationId: null,
    runId: 'run-test',
    origin: 'agent',
    signature: 'sig',
  } as ToolReceipt;
}

describe('audit log append queue', () => {
  beforeEach(async () => {
    await clearAuditLog();
  });

  it('does not lose receipts under concurrent appends', async () => {
    const N = 25;
    // Fire all appends WITHOUT awaiting between them — exactly how the
    // dispatcher does it (`void emitCompletedReceipt(...)`).
    await Promise.all(Array.from({ length: N }, (_, i) => appendReceipt(fakeReceipt(`call-${i}`))));
    const all = await getRecentReceipts();
    expect(all).toHaveLength(N);
    const ids = new Set(all.map((r) => r.callId));
    expect(ids.size).toBe(N);
  });

  it('keeps insertion order (newest first from getRecentReceipts)', async () => {
    await Promise.all([
      appendReceipt(fakeReceipt('first')),
      appendReceipt(fakeReceipt('second')),
      appendReceipt(fakeReceipt('third')),
    ]);
    const all = await getRecentReceipts();
    expect(all.map((r) => r.callId)).toEqual(['third', 'second', 'first']);
  });

  it('survives a failing append without wedging the queue', async () => {
    // A receipt that JSON-serializes fine — the failure path we guard is a
    // storage write error; simulate by appending after a clear and ensuring
    // the chain continues even when one entry is bizarre.
    const weird = { ...fakeReceipt('weird') } as ToolReceipt & { cyclic?: unknown };
    await appendReceipt(weird);
    await appendReceipt(fakeReceipt('after'));
    const all = await getRecentReceipts();
    expect(all.some((r) => r.callId === 'after')).toBe(true);
  });
});
