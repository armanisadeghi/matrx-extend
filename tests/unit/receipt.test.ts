/**
 * Unit tests for cryptographic run receipts (CLAUDE.md roadmap item #8).
 *
 * Covers:
 *   - v2 receipts with each `origin` tag round-trip through verify.
 *   - v1-shape receipts (no `origin`) created by an older build still
 *     verify against today's verifier — chain-of-custody for receipts
 *     already in the audit log must not break.
 *   - Tampering with the `origin` field of a v2 receipt invalidates the
 *     signature.
 */

/**
 * Note: the chrome.storage.local mock used by these tests is installed
 * once at suite startup in tests/setup.ts. Sharing the same store
 * (and therefore the same device key) across the file mirrors the SW's
 * caching behaviour in production.
 */

import { canonicalJson } from '@/lib/audit/device-key';
import {
  PENDING_OUTPUT,
  RECEIPT_SCHEMA_VERSION,
  type ReceiptOrigin,
  type ToolReceipt,
  buildReceipt,
  verifyReceipt,
} from '@/lib/audit/receipt';
import { describe, expect, it } from 'vitest';

const baseInput = (overrides: Partial<Parameters<typeof buildReceipt>[0]> = {}) => ({
  callId: 'call-1',
  toolName: 'take_screenshot',
  args: { tab_id: 42 },
  output: { ok: true },
  ok: true,
  startedAt: 1_700_000_000_000,
  completedAt: 1_700_000_000_500,
  conversationId: 'conv-abc',
  runId: 'run-xyz',
  ...overrides,
});

describe('ToolReceipt schema v2', () => {
  it('emits v=2 with origin defaulting to agent when not provided', async () => {
    const r = await buildReceipt(baseInput());
    expect(r.v).toBe(RECEIPT_SCHEMA_VERSION);
    expect(r.v).toBe(2);
    expect(r.origin).toBe('agent');
  });

  it.each<ReceiptOrigin>(['agent', 'pilot', 'parallel', 'webmcp'])(
    'round-trips origin=%s through verifyReceipt',
    async (origin) => {
      const r = await buildReceipt(baseInput({ origin }));
      expect(r.origin).toBe(origin);
      const v = await verifyReceipt(r);
      expect(v.valid).toBe(true);
    },
  );

  it('emits a partial receipt with outputHash=pending and ok=null', async () => {
    const r = await buildReceipt(
      baseInput({ output: PENDING_OUTPUT, ok: null, completedAt: null, origin: 'webmcp' }),
    );
    expect(r.outputHash).toBe('pending');
    expect(r.ok).toBe(null);
    expect(r.origin).toBe('webmcp');
    const v = await verifyReceipt(r);
    expect(v.valid).toBe(true);
  });

  it('detects tampering with the origin tag', async () => {
    const r = await buildReceipt(baseInput({ origin: 'agent' }));
    const tampered: ToolReceipt = { ...r, origin: 'webmcp' };
    const v = await verifyReceipt(tampered);
    expect(v.valid).toBe(false);
    expect(v.reason).toContain('signature');
  });
});

describe('ToolReceipt schema v1 backward compatibility', () => {
  it('verifies a v1-shape receipt (no origin field) produced before this build', async () => {
    // Reproduce what an older build wrote: build a real v2 receipt, then
    // strip the origin field AND re-sign with the legacy body shape so
    // the signature matches the v1 canonical bytes. We sign manually
    // here using the SAME device key the verifier will look up — that's
    // the closest faithful simulation of a prior-build receipt.
    const fresh = await buildReceipt(baseInput({ origin: 'agent' }));

    // Strip origin to produce the v1 body. Re-sign over canonical-JSON
    // of the v1 body using the device key we already initialized.
    const { signature: _drop, origin: _orig, ...rest } = fresh;
    void _drop;
    void _orig;
    const v1Body = { ...rest, v: 1 as const };
    const canonical = canonicalJson(v1Body as unknown as Record<string, unknown>);

    // Pull the private key the same way receipt.ts does.
    const { getOrCreateDeviceKey } = await import('@/lib/audit/device-key');
    const key = await getOrCreateDeviceKey();
    const sig = await crypto.subtle.sign(
      { name: 'Ed25519' },
      key.privateKey,
      new TextEncoder().encode(canonical),
    );
    const sigBytes = new Uint8Array(sig);
    let bin = '';
    for (let i = 0; i < sigBytes.byteLength; i++) bin += String.fromCharCode(sigBytes[i] as number);
    const sigB64Url = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    const v1Receipt: ToolReceipt = {
      ...v1Body,
      signature: sigB64Url,
    };

    expect(v1Receipt.v).toBe(1);
    expect((v1Receipt as { origin?: unknown }).origin).toBeUndefined();

    const v = await verifyReceipt(v1Receipt);
    expect(v.valid).toBe(true);
  });

  it('rejects a receipt with an unsupported schema version', async () => {
    const fresh = await buildReceipt(baseInput());
    const bogus = { ...fresh, v: 99 as unknown as ToolReceipt['v'] };
    const v = await verifyReceipt(bogus);
    expect(v.valid).toBe(false);
    expect(v.reason).toContain('unsupported schema version');
  });
});
