/**
 * Cross-component envelope (v2) — local mirror.
 *
 * Mirrors `matrx-frontend/lib/types/bridge-envelope.ts` CrossComponentEnvelope
 * byte-for-byte. The canonical home for the wire format lives in
 * matrx-frontend; this is the matrx-extend-side copy because the extension
 * is a separate build and cannot import across repo boundaries.
 *
 * v2 extends the existing `BridgeEnvelope` (in
 * `src/lib/frontend-bridge/broadcast.ts`) with:
 *   - `kind` discriminator: "rpc" | "wake" | "presence"
 *   - `fromInstance` / `toInstance` instance refs for disambiguation
 *
 * Back-compat: v1 publishers don't set these fields. Defaults keep them
 * working unchanged. The existing rpc-only flow in
 * `frontend-bridge/broadcast.ts` is NOT modified in Phase 1 — that
 * happens in Phase 2 along with the broader broadcast routing changes.
 *
 * `kind:"task"` is intentionally absent. Cross-component tasks live in
 * the `sch_task` table (matrx-scheduler), not in bus envelopes. Wake
 * envelopes carry `payload: {taskId: string}` pointing at the durable
 * row.
 */

import { z } from 'zod';

/**
 * Identifies a specific running instance of a component. `component` is
 * the surface identifier (`extension`, `local`, `frontend`, `server`).
 * `instanceId` is a per-process UUID minted at startup (see
 * `src/lib/cross-component/instance-id.ts`).
 */
export const InstanceRefSchema = z.object({
  component: z.string(),
  instanceId: z.string(),
});

export type InstanceRef = z.infer<typeof InstanceRefSchema>;

/**
 * The v2 cross-component envelope. Carried over Supabase Broadcast on
 * the per-user buses.
 *
 * Defaults applied when v1 publishers send minimal payloads:
 *  - `kind` → `"rpc"`
 *  - `payload` → `null`
 *  - `fromInstance` → `{component: "unknown", instanceId: "unknown"}`
 *  - `toInstance` → undefined (treated as broadcast to any instance)
 */
export const CrossComponentEnvelopeSchema = z.object({
  kind: z.enum(['rpc', 'wake', 'presence']).default('rpc'),
  direction: z.string().min(1),
  action: z.string(),
  requestId: z.string(),
  payload: z.unknown().optional().default(null),
  timestamp: z.number(),
  fromInstance: InstanceRefSchema.default({ component: 'unknown', instanceId: 'unknown' }),
  toInstance: InstanceRefSchema.partial({ instanceId: true }).optional(),
});

export type CrossComponentEnvelope = z.infer<typeof CrossComponentEnvelopeSchema>;

/**
 * Parse a raw broadcast payload into a fully-typed v2 envelope. v1
 * payloads parse cleanly thanks to the defaults above. Throws (Zod
 * error) on missing required fields.
 */
export function parseEnvelope(raw: unknown): CrossComponentEnvelope {
  return CrossComponentEnvelopeSchema.parse(raw);
}
