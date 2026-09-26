/**
 * The read-aloud voice — the SAME setting the web app uses.
 *
 * The extension reads replies aloud through Cartesia, the same engine as
 * read-aloud on aimatrx.com, so it follows the person's "Read-aloud voice"
 * (platform setting `media.listening.voice`, read through the shared ladder in
 * `@/lib/settings/platform-knobs`). Chosen on the web at Settings → Voice &
 * Audio → Voices.
 *
 * No personal choice (or the retired pre-2026 default) means the web's default
 * reply voice (Daniel), exactly as `resolveVoiceId` on the web.
 */

import { resolvePlatformKnobString } from '@/lib/settings/platform-knobs';

const READ_ALOUD_VOICE_KEY = 'media.listening.voice';
/** Web default for assistant replies (lib/cartesia/config.ts ASSISTANT_VOICE_ID). */
export const ASSISTANT_VOICE_ID = '47c38ca4-5f35-497b-b1a3-415245fb35e1';
/** Retired default the web treats as "unset" (LEGACY_DEFAULT_VOICE_ID). */
const LEGACY_DEFAULT_VOICE_ID = '156fb8d2-335b-4950-9cb3-a2d33befec77';

export async function resolveReadAloudVoice(): Promise<string> {
  const chosen = await resolvePlatformKnobString(READ_ALOUD_VOICE_KEY);
  return chosen && chosen !== LEGACY_DEFAULT_VOICE_ID ? chosen : ASSISTANT_VOICE_ID;
}
