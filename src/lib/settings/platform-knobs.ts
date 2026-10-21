/**
 * The person's platform settings — the SAME ladder the web app reads
 * (`platform.knob_snapshot`: organization → user, nearest wins).
 *
 * One read per organization+person, cached briefly, shared by every setting
 * the extension follows (read-aloud voice, default chat model, …). A failed
 * read answers `undefined` and says so — a setting never blocks a run.
 */

import { ensureRequestOrganizationId } from '@/hooks/use-request-organization';
import { recordKnobRead } from '@/lib/config';
import { useAuthStore } from '@/state/auth';
import { knobSnapshotFor, onKnobSnapshotLanded, peekKnobSnapshot } from './platform-knob-snapshot';

const listeners = new Set<() => void>();
let version = 0;

onKnobSnapshotLanded(() => {
  version += 1;
  for (const l of listeners) l();
});

/** Subscribe to "a snapshot landed" (the package chat's settings register re-renders on it). */
export function subscribePlatformKnobs(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function platformKnobsVersion(): number {
  return version;
}

/** The cached value for this session, or `undefined` when no snapshot has landed (or none has this key). */
export function peekPlatformKnob(fullKey: string): unknown {
  return peekKnobSnapshot(fullKey);
}

/** Ask for the snapshot (once, shared); resolves when it landed or failed. Never throws. */
export function warmPlatformKnobs(): Promise<void> {
  return snapshot().then(
    () => undefined,
    () => undefined,
  );
}

async function snapshot(): Promise<Record<string, unknown> | null> {
  const userId = useAuthStore.getState().user?.id ?? null;
  return knobSnapshotFor(await ensureRequestOrganizationId(), userId);
}

/** One platform setting's resolved value, or `undefined` when it cannot be read. */
export async function resolvePlatformKnob(fullKey: string): Promise<unknown> {
  const resolved = await snapshot();
  const value = resolved ? resolved[fullKey] : undefined;
  if (value !== undefined) recordKnobRead(fullKey, 'db');
  return value;
}

/** A string setting; "" / missing / unreadable → null. */
export async function resolvePlatformKnobString(fullKey: string): Promise<string | null> {
  const value = await resolvePlatformKnob(fullKey);
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}
