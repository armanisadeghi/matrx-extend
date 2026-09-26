/**
 * The read-aloud voice — the SAME setting the web app uses.
 *
 * The extension reads replies aloud through Cartesia, the same engine as
 * read-aloud on aimatrx.com, so it follows the person's "Read-aloud voice"
 * (platform knob `media.listening.voice`, resolved organization → user by
 * `platform.knob_snapshot` — the one read the web app's settings use too).
 * Chosen on the web at Settings → Voice & Audio → Voices.
 *
 * "" (no personal choice) or the retired pre-2026 default means the web's
 * default reply voice (Daniel), exactly as `resolveVoiceId` on the web.
 */

import { ensureRequestOrganizationId } from '@/hooks/use-request-organization';
import { getSupabase } from '@/lib/supabase/client';
import { useAuthStore } from '@/state/auth';

const READ_ALOUD_VOICE_KEY = 'media.listening.voice';
/** Web default for assistant replies (lib/cartesia/config.ts ASSISTANT_VOICE_ID). */
export const ASSISTANT_VOICE_ID = '47c38ca4-5f35-497b-b1a3-415245fb35e1';
/** Retired default the web treats as "unset" (LEGACY_DEFAULT_VOICE_ID). */
const LEGACY_DEFAULT_VOICE_ID = '156fb8d2-335b-4950-9cb3-a2d33befec77';

const CACHE_MS = 60_000;
let cached: { key: string; voice: string; at: number } | null = null;

export async function resolveReadAloudVoice(): Promise<string> {
  const userId = useAuthStore.getState().user?.id ?? null;
  const organizationId = await ensureRequestOrganizationId();
  if (!organizationId) return ASSISTANT_VOICE_ID;

  const cacheKey = `${organizationId}:${userId ?? ''}`;
  if (cached && cached.key === cacheKey && Date.now() - cached.at < CACHE_MS) {
    return cached.voice;
  }

  const { data, error } = await getSupabase()
    .schema('platform')
    .rpc('knob_snapshot', {
      p_organization_id: organizationId,
      p_user_id: userId ?? undefined,
      p_scopes: undefined,
    });
  if (error) {
    console.error(
      `[matrx-audio] ${READ_ALOUD_VOICE_KEY} could not be read (${error.message}) — the default reply voice speaks.`,
    );
    return ASSISTANT_VOICE_ID;
  }
  const resolved = (data as { resolved?: Record<string, unknown> } | null)?.resolved ?? {};
  const raw = resolved[READ_ALOUD_VOICE_KEY];
  const chosen = typeof raw === 'string' ? raw.trim() : '';
  const voice = chosen && chosen !== LEGACY_DEFAULT_VOICE_ID ? chosen : ASSISTANT_VOICE_ID;
  cached = { key: cacheKey, voice, at: Date.now() };
  return voice;
}
