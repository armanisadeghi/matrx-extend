/**
 * Cryptographic run receipts (CLAUDE.md roadmap item #8).
 *
 * Every tool invocation produces a signed receipt:
 *   - Partial receipt at start (outputHash='pending', ok=null) so even
 *     crashed calls leave a chain-of-custody trail.
 *   - Full receipt at completion (outputHash + ok set).
 *
 * The signature covers a canonical-JSON serialization of the receipt
 * body (everything except the `signature` field itself). Verification
 * walks the public-key history so receipts continue to verify after
 * the user re-keys.
 *
 * Schema is versioned via `v`:
 *   - v=1: original shape (no `origin` field).
 *   - v=2: adds `origin` (agent | pilot | parallel | webmcp) so the
 *          audit log can distinguish call provenance for compliance
 *          and filtering. Verification accepts BOTH v1 and v2 — old
 *          receipts in existing logs continue to verify.
 *
 * JWS export uses the compact serialization defined by RFC 7515:
 *   `BASE64URL(protected) . BASE64URL(payload) . BASE64URL(signature)`
 * with `alg=EdDSA`. An auditor can verify the receipt independently
 * with any standard JWS library + the exported public-key JWK.
 */

import { canonicalJson, getOrCreateDeviceKey, getPublicKeyById } from '@/lib/audit/device-key';

/**
 * Current schema version emitted by this build. The verifier accepts
 * any version listed in `SUPPORTED_SCHEMA_VERSIONS` so older receipts
 * continue to verify after a schema bump.
 */
export const RECEIPT_SCHEMA_VERSION = 2 as const;

/**
 * Schema versions whose receipts the verifier still accepts. We must
 * never drop entries here without first migrating any persisted
 * receipts that match — doing so would invalidate signatures we've
 * already promised would verify forever.
 */
export const SUPPORTED_SCHEMA_VERSIONS = [1, 2] as const;
export type SupportedSchemaVersion = (typeof SUPPORTED_SCHEMA_VERSIONS)[number];

/**
 * Origin tag — where the tool call came from. Stored only on v2+
 * receipts; absent on v1.
 *   - `agent`    → standard streaming dispatcher (Assistant Chat).
 *   - `pilot`    → call inside an active Pilot session (group sandbox).
 *   - `parallel` → sub-run spawned by `parallel_for_each_tab`.
 *   - `webmcp`   → page → SW invocation via `navigator.modelContext.callTool`.
 */
export type ReceiptOrigin = 'agent' | 'pilot' | 'parallel' | 'webmcp';

export interface ToolReceipt {
  /** Schema version. v1 = original shape; v2 = adds optional `origin`. */
  v: SupportedSchemaVersion;
  /** First 16 hex chars of sha-256 over the public-key JWK. */
  publicKeyId: string;
  /** Tool-call ID assigned by the server. Stable across started/completed. */
  callId: string;
  toolName: string;
  /** sha-256 hex of canonical-JSON(args). */
  argsHash: string;
  /** sha-256 hex of canonical-JSON(output) — or 'pending' until completion. */
  outputHash: string;
  /** True on success, false on error, null while pending. */
  ok: boolean | null;
  /** Unix ms when the dispatcher received the call. */
  startedAt: number;
  /** Unix ms when the handler resolved. Null while pending. */
  completedAt: number | null;
  /** Conversation the call belongs to, or null when not bound (e.g. webmcp). */
  conversationId: string | null;
  /** Stream / run identifier — groups all calls within one agent turn. */
  runId: string;
  /**
   * Origin of the call. Optional on the type so we can also represent
   * historical v1 receipts; in practice every v2 receipt this build
   * produces sets it explicitly. Absent on v1; the verifier doesn't
   * require it.
   */
  origin?: ReceiptOrigin;
  /** base64url(ed25519 signature over canonical-JSON of the body). */
  signature: string;
}

/** Body the signature covers — everything except the signature itself. */
export type ReceiptBody = Omit<ToolReceipt, 'signature'>;

/* ------------------------------------------------------------------ */
/* base64url helpers                                                  */
/* ------------------------------------------------------------------ */

function bytesToBase64Url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i] as number);
  // btoa → base64 → strip padding, +/ → -_
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(s: string): Uint8Array {
  // Restore padding + standard b64.
  const padded = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  const bin = atob(padded + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function uint8ToArrayBuffer(u: Uint8Array): ArrayBuffer {
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
}

/* ------------------------------------------------------------------ */
/* sha-256                                                             */
/* ------------------------------------------------------------------ */

/**
 * Hash any JSON-serializable value as the canonical-JSON sha-256 hex
 * digest. Stable across implementations as long as both sides use the
 * same `canonicalJson`.
 */
export async function hashCanonicalJson(value: unknown): Promise<string> {
  const canonical = canonicalJson(value);
  const buf = new TextEncoder().encode(canonical);
  const hashBuf = await crypto.subtle.digest('SHA-256', buf);
  const bytes = new Uint8Array(hashBuf);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) hex += bytes[i]!.toString(16).padStart(2, '0');
  return hex;
}

/* ------------------------------------------------------------------ */
/* build / sign                                                       */
/* ------------------------------------------------------------------ */

export interface BuildReceiptInput {
  callId: string;
  toolName: string;
  args: unknown;
  output: unknown | typeof PENDING_OUTPUT;
  ok: boolean | null;
  startedAt: number;
  completedAt: number | null;
  conversationId: string | null;
  runId: string;
  /**
   * Origin tag for the call. Defaults to `'agent'` (the standard
   * streaming dispatcher) for backward-compat with call sites that
   * pre-date schema v2.
   */
  origin?: ReceiptOrigin;
}

export const PENDING_OUTPUT = Symbol('matrx.audit.pending');

/**
 * Build a signed receipt. Hashes the args + output, asks the device
 * key to sign the canonical-JSON of the body, and returns the full
 * `ToolReceipt`.
 *
 * If `output === PENDING_OUTPUT` the receipt's `outputHash` is the
 * literal string 'pending' and `ok` should be null. Used for the
 * partial receipt emitted at tool-start.
 */
export async function buildReceipt(input: BuildReceiptInput): Promise<ToolReceipt> {
  const key = await getOrCreateDeviceKey();
  const argsHash = await hashCanonicalJson(input.args ?? null);
  const outputHash =
    input.output === PENDING_OUTPUT ? 'pending' : await hashCanonicalJson(input.output ?? null);

  const body: ReceiptBody = {
    v: RECEIPT_SCHEMA_VERSION,
    publicKeyId: key.publicKeyId,
    callId: input.callId,
    toolName: input.toolName,
    argsHash,
    outputHash,
    ok: input.ok,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    conversationId: input.conversationId,
    runId: input.runId,
    origin: input.origin ?? 'agent',
  };

  const canonical = canonicalJson(body as unknown as Record<string, unknown>);
  const sigBuf = await crypto.subtle.sign(
    { name: 'Ed25519' },
    key.privateKey,
    uint8ToArrayBuffer(new TextEncoder().encode(canonical)),
  );
  return {
    ...body,
    signature: bytesToBase64Url(sigBuf),
  };
}

/* ------------------------------------------------------------------ */
/* verify                                                             */
/* ------------------------------------------------------------------ */

export interface VerifyResult {
  valid: boolean;
  reason?: string;
}

/**
 * Verify a receipt's signature using the public key history. Walks the
 * stored history to find the matching `publicKeyId`. Returns
 * `{ valid: false, reason }` for any failure mode (key not on file,
 * tampered body, malformed signature) so the UI can render a meaningful
 * message.
 *
 * Backward compatibility: accepts every version listed in
 * `SUPPORTED_SCHEMA_VERSIONS`. The body that gets re-canonicalized for
 * verification is `{ ...receipt, signature stripped }` — meaning if a
 * receipt's body originally lacked the `origin` field (v1), it stays
 * absent during verification and the original signature still matches.
 * Conversely, v2 receipts include `origin` in the canonical body so
 * tampering with that tag invalidates the signature.
 */
export async function verifyReceipt(receipt: ToolReceipt): Promise<VerifyResult> {
  if (!(SUPPORTED_SCHEMA_VERSIONS as readonly number[]).includes(receipt.v as number)) {
    return { valid: false, reason: `unsupported schema version v=${String(receipt.v)}` };
  }
  const jwk = await getPublicKeyById(receipt.publicKeyId);
  if (!jwk) {
    return {
      valid: false,
      reason: `public key '${receipt.publicKeyId}' is not on file (cleared or signed on a different install)`,
    };
  }
  let pub: CryptoKey;
  try {
    pub = await crypto.subtle.importKey('jwk', jwk, { name: 'Ed25519' }, true, ['verify']);
  } catch (err) {
    return { valid: false, reason: `public key import failed: ${(err as Error).message}` };
  }
  const { signature, ...body } = receipt;
  const canonical = canonicalJson(body as unknown as Record<string, unknown>);
  let sigBytes: Uint8Array;
  try {
    sigBytes = base64UrlToBytes(signature);
  } catch (err) {
    return { valid: false, reason: `signature is not valid base64url: ${(err as Error).message}` };
  }
  let ok: boolean;
  try {
    ok = await crypto.subtle.verify(
      { name: 'Ed25519' },
      pub,
      uint8ToArrayBuffer(sigBytes),
      uint8ToArrayBuffer(new TextEncoder().encode(canonical)),
    );
  } catch (err) {
    return { valid: false, reason: `verify call threw: ${(err as Error).message}` };
  }
  if (!ok) {
    return {
      valid: false,
      reason: 'signature does not match body — receipt may have been tampered with',
    };
  }
  return { valid: true };
}

/* ------------------------------------------------------------------ */
/* JWS export                                                         */
/* ------------------------------------------------------------------ */

/**
 * Export the receipt as a JWS compact-serialization string:
 *   BASE64URL(header) . BASE64URL(payload) . BASE64URL(signature)
 *
 * Header:  { alg: 'EdDSA', typ: 'JWT', kid: <publicKeyId> }
 * Payload: the receipt body (everything except `signature`)
 *
 * Note that the JWS signature here is a fresh sign over
 * `header.payload` per RFC 7515 — distinct from the receipt's own
 * `signature` field, which signs the canonical-JSON body. The two are
 * complementary: the in-receipt signature binds args / output hashes
 * tightly; the JWS lets a standard library verify without needing our
 * canonical-JSON routine.
 */
export async function exportReceiptJws(receipt: ToolReceipt): Promise<string> {
  const key = await getOrCreateDeviceKey();
  const header = {
    alg: 'EdDSA',
    typ: 'JWT',
    kid: receipt.publicKeyId,
  };
  // We cannot use canonicalJson for JWS — the spec says the sender
  // chooses the encoding and the bytes-on-the-wire are what the
  // signature covers. JSON.stringify is fine here.
  const headerB64 = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(header)));
  const { signature: _drop, ...body } = receipt;
  void _drop;
  const payloadB64 = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(body)));
  const signingInput = `${headerB64}.${payloadB64}`;
  const sigBuf = await crypto.subtle.sign(
    { name: 'Ed25519' },
    key.privateKey,
    uint8ToArrayBuffer(new TextEncoder().encode(signingInput)),
  );
  return `${signingInput}.${bytesToBase64Url(sigBuf)}`;
}
