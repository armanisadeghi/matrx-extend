/**
 * The person's platform settings — the SAME ladder the web app reads
 * (`platform.knob_snapshot`: organization → user, nearest wins).
 *
 * One read per organization+person, cached briefly, shared by every setting
 * the extension follows (read-aloud voice, default chat model, …). A failed
 * read answers `undefined` and says so — a setting never blocks a run.
 */

import { ensureRequestOrganizationId } from '@/hooks/use-request-organization';
import { getSupabase } from '@/lib/supabase/client';
import { useAuthStore } from '@/state/auth';

const CACHE_MS = 60_000;
let cached: { key: string; resolved: Record<string, unknown>; at: number } | null = null;
let inFlight: { key: string; promise: Promise<Record<string, unknown> | null> } | null = null;

async function snapshot(): Promise<Record<string, unknown> | null> {
  const userId = useAuthStore.getState().user?.id ?? null;
  const organizationId = await ensureRequestOrganizationId();
  if (!organizationId) return null;
  const key = `${organizationId}:${userId ?? ''}`;
  if (cached && cached.key === key && Date.now() - cached.at < CACHE_MS) return cached.resolved;
  if (inFlight?.key === key) return inFlight.promise;

  const promise = (async () => {
    const { data, error } = await getSupabase()
      .schema('platform')
      .rpc('knob_snapshot', {
        p_organization_id: organizationId,
        p_user_id: userId ?? undefined,
        p_scopes: undefined,
      });
    if (error) {
      console.error(
        `[matrx-settings] platform settings could not be read (${error.message}) — each setting falls back to its default.`,
      );
      return null;
    }
    const resolved = (data as { resolved?: Record<string, unknown> } | null)?.resolved ?? {};
    cached = { key, resolved, at: Date.now() };
    return resolved;
  })().finally(() => {
    if (inFlight?.promise === promise) inFlight = null;
  });
  inFlight = { key, promise };
  return promise;
}

/** One platform setting's resolved value, or `undefined` when it cannot be read. */
export async function resolvePlatformKnob(fullKey: string): Promise<unknown> {
  const resolved = await snapshot();
  return resolved ? resolved[fullKey] : undefined;
}

/** A string setting; "" / missing / unreadable → null. */
export async function resolvePlatformKnobString(fullKey: string): Promise<string | null> {
  const value = await resolvePlatformKnob(fullKey);
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}
