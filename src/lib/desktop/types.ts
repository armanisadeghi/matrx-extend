import { z } from 'zod';

/** Managed-service health from matrx-local GET /health (not liveness). */
export const DesktopEngineHealthSchema = z.enum(['ok', 'degraded', 'failed_services']);
export type DesktopEngineHealth = z.infer<typeof DesktopEngineHealthSchema>;

/**
 * matrx-local /health and native `health` RPC response.
 *
 * CONTRACT (matrx-local app/api/routes.py):
 *   - `status` is ALWAYS the literal "ok" while the engine process is alive
 *     (liveness for port discovery — never overload with degraded states).
 *   - `health` reports managed-service state: ok | degraded | failed_services.
 *   - `failed` / `degraded` name the affected services when present.
 */
export const DesktopHealthSchema = z.object({
  status: z.literal('ok'),
  version: z.string(),
  service: z.literal('matrx-local').optional(),
  user_id: z.string().nullable().optional(),
  health: DesktopEngineHealthSchema.optional(),
  failed: z.array(z.string()).optional(),
  degraded: z.array(z.string()).optional(),
});
export type DesktopHealth = z.infer<typeof DesktopHealthSchema>;

/**
 * matrx-local GET/POST /extension/pair response. Loopback-only on the
 * engine side — the engine hard-rejects tunnel-originated pair requests,
 * so this only ever succeeds against a same-machine engine.
 */
export const DesktopPairResponseSchema = z.object({
  pair_token: z.string().min(1),
  engine_version: z.string(),
  service: z.literal('matrx-local'),
});
export type DesktopPairResponse = z.infer<typeof DesktopPairResponseSchema>;

export const DesktopRpcRequestSchema = z.object({
  command: z.string().min(1),
  args: z.record(z.unknown()).optional(),
});
export type DesktopRpcRequest = z.infer<typeof DesktopRpcRequestSchema>;

export const DesktopRpcResponseSchema = z.object({
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: z.string().optional(),
});
export type DesktopRpcResponse = z.infer<typeof DesktopRpcResponseSchema>;

export type DesktopTransport = 'native' | 'http' | 'none';

/** Resolved engine health — defaults to ok when the native RPC omits detail fields. */
export function engineHealthState(health: DesktopHealth | null | undefined): DesktopEngineHealth {
  return health?.health ?? 'ok';
}

export function isDesktopReachable(transport: DesktopTransport): boolean {
  return transport !== 'none';
}

/** User-facing connection label for Settings / account menu. */
export function formatDesktopConnectionLabel(
  transport: DesktopTransport,
  health: DesktopHealth | null,
): string {
  if (transport === 'none') return 'Not connected';
  const state = engineHealthState(health);
  const via = transport === 'native' ? 'native' : 'http';
  if (state === 'ok') return `Connected (${via})`;
  if (state === 'degraded') return `Connected · degraded (${via})`;
  return `Connected · services failed (${via})`;
}

/** Tailwind text color class for desktop bridge status rows. */
export function desktopStatusTextClass(
  transport: DesktopTransport,
  health: DesktopHealth | null,
): string {
  if (transport === 'none') return 'text-muted-foreground';
  const state = engineHealthState(health);
  if (state === 'failed_services') return 'text-amber-600 dark:text-amber-400';
  if (state === 'degraded') return 'text-yellow-600 dark:text-yellow-400';
  return transport === 'native'
    ? 'text-emerald-600 dark:text-emerald-400'
    : 'text-sky-600 dark:text-sky-400';
}

/** Avatar / menu presence dot color. */
export function desktopStatusDotClass(
  transport: DesktopTransport,
  health: DesktopHealth | null,
): string {
  if (transport === 'none') return 'bg-muted-foreground/40';
  const state = engineHealthState(health);
  if (state === 'failed_services') return 'bg-amber-500';
  if (state === 'degraded') return 'bg-yellow-500';
  return transport === 'native' ? 'bg-emerald-500' : 'bg-sky-500';
}

/** Stable key for detecting health snapshot changes between probe ticks. */
export function desktopHealthSnapshotKey(health: DesktopHealth | null): string {
  if (!health) return '';
  return JSON.stringify({
    health: health.health ?? 'ok',
    failed: health.failed ?? [],
    degraded: health.degraded ?? [],
    version: health.version,
  });
}
