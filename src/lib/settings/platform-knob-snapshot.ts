/**
 * The ONE read of the platform settings (organization → user, nearest wins) through `@ai-matrx/data/knobs`, cached briefly per
 * organization+person and shared by every caller in this execution context.
 *
 * Context-free on purpose: the side panel names its identity from its own stores
 * (`./platform-knobs.ts`); the service worker names it from the stored sign-in and the ONE
 * organization resolver (`resolvePlatformKnobInWorker`). No React, no UI store here.
 * A failed read answers `null` and says so — a setting never blocks a run.
 */

import { getCurrentUser } from '@/lib/auth/flow';
import { appConfig, recordKnobRead } from '@/lib/config';
import { getActiveOrganizationId } from '@/lib/org/active-org';
import { getSupabase } from '@/lib/supabase/client';
import { createKnobReader, type KnobReader } from '@ai-matrx/data/knobs';

let cached: { key: string; resolved: Record<string, unknown>; at: number } | null = null;
let inFlight: { key: string; promise: Promise<Record<string, unknown> | null> } | null = null;
const landed = new Set<() => void>();

/** THE door for the read: `@ai-matrx/data/knobs` (defaults + this person's delta, etag-cached). */
let reader: KnobReader | null = null;
function knobReader(): KnobReader {
  reader ??= createKnobReader(getSupabase());
  return reader;
}

/** Called whenever a fresh snapshot lands (the side panel's settings register re-renders on it). */
export function onKnobSnapshotLanded(listener: () => void): () => void {
  landed.add(listener);
  return () => landed.delete(listener);
}

/** The cached resolved value for this context, or `undefined` when none has landed. */
export function peekKnobSnapshot(fullKey: string): unknown {
  const value = cached?.resolved[fullKey];
  if (value !== undefined) recordKnobRead(fullKey, 'db');
  return value;
}

export async function knobSnapshotFor(
  organizationId: string | null,
  userId: string | null,
): Promise<Record<string, unknown> | null> {
  if (!organizationId) return null;
  const key = `${organizationId}:${userId ?? ''}`;
  if (
    cached &&
    cached.key === key &&
    Date.now() - cached.at < appConfig<number>('platform_knobs_cache_ms')
  )
    return cached.resolved;
  if (inFlight?.key === key) return inFlight.promise;

  const promise = (async () => {
    let resolved: Record<string, unknown>;
    try {
      ({ resolved } = await knobReader().snapshot({ organizationId, userId }));
    } catch (error) {
      console.error(
        `[matrx-settings] platform settings could not be read (${error instanceof Error ? error.message : String(error)}) — each setting falls back to its default.`,
      );
      return null;
    }
    cached = { key, resolved, at: Date.now() };
    for (const l of landed) l();
    return resolved;
  })().finally(() => {
    if (inFlight?.promise === promise) inFlight = null;
  });
  inFlight = { key, promise };
  return promise;
}

/**
 * One platform setting's resolved value, read from the service worker (no side-panel stores):
 * the stored sign-in names the person, the ONE organization resolver names the organization.
 * `undefined` when signed out, unreadable, or unset — the caller applies its default.
 */
export async function resolvePlatformKnobInWorker(fullKey: string): Promise<unknown> {
  try {
    const user = await getCurrentUser();
    if (!user?.id) return undefined;
    const resolved = await knobSnapshotFor(await getActiveOrganizationId(), user.id);
    const value = resolved ? resolved[fullKey] : undefined;
    if (value !== undefined) recordKnobRead(fullKey, 'db');
    return value;
  } catch (err) {
    console.error(
      `[matrx-settings] platform setting ${fullKey} could not be read (${(err as Error)?.message ?? String(err)}) — its default applies.`,
    );
    return undefined;
  }
}
