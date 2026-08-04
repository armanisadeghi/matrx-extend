// src/lib/scheduler-client/surfaces.ts
//
// Surface identifiers — the strings that go in sch_task.surfaces[].
// Must match the DB CHECK constraint sch_task_surfaces_chk defined in
// migrations/2026_05_10_sch_v0.sql + sch_server_surface.sql.
//
// Mirror of matrx-frontend/lib/scheduler-client/surfaces.ts (canonical TS home).

/**
 * Surface identifiers — the strings that go in sch_task.surfaces[].
 * Must match the DB CHECK constraint sch_task_surfaces_chk in
 * migrations/2026_05_10_sch_v0.sql + sch_server_surface.sql.
 */
export const SCHEDULER_SURFACES = [
  'any',
  'server',
  'web',
  'desktop',
  'chrome-extension-chat',
  'mobile',
  'sandbox',
] as const;

export type SchedulerSurface = (typeof SCHEDULER_SURFACES)[number];

/**
 * Component identifier for the cross-component envelope's
 * fromInstance.component / toInstance.component fields. Mostly maps
 * 1:1 with SchedulerSurface, but 'any' isn't a valid component (it's a
 * routing wildcard for task targeting, not an identity for a running
 * host).
 */
export type SchedulerComponent = Exclude<SchedulerSurface, 'any'>;

/** Type-guard for arbitrary strings → SchedulerSurface. */
export function isSchedulerSurface(value: string): value is SchedulerSurface {
  return (SCHEDULER_SURFACES as readonly string[]).includes(value);
}
