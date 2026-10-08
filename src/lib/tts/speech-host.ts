/**
 * The extension's ports into THE one speech engine (`@ai-matrx/media/speech`): the Cartesia token
 * from the platform's audio route, the person's read-aloud voice (the same platform setting the
 * website uses) + this install's language, and provider-failure reports to the server. Called once
 * from the side panel entry; every read-aloud plays through the package queue.
 */

import { matrxTransport } from '@/lib/api/matrx-transport';
import { AUDIO_API_ROUTES } from '@/lib/audio/constants';
import { getAccessToken } from '@/lib/auth/flow';
import { resolvePlatformKnobString } from '@/lib/settings/platform-knobs';
import { useVoicePrefsStore } from '@/state/voice-prefs';
import { reportProviderSessionFailure } from '@ai-matrx/agents/matrx';
import { configureSpeech } from '@ai-matrx/media/speech';

async function fetchCartesiaToken(): Promise<string> {
  const accessToken = await getAccessToken();
  if (!accessToken) throw new Error('Sign in to hear replies read aloud.');
  const res = await fetch(AUDIO_API_ROUTES.CARTESIA_TOKEN, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; details?: string };
    const detail = body.error || body.details;
    throw new Error(
      detail
        ? `Speech sign-in failed (${res.status}): ${detail}`
        : `Speech sign-in failed (HTTP ${res.status}). Try signing out and back in.`,
    );
  }
  const data = (await res.json()) as { token: string };
  return data.token;
}

export function installSpeechHost(): void {
  configureSpeech({
    getCartesiaToken: fetchCartesiaToken,
    resolveVoiceSettings: async () => {
      const { language, speed } = useVoicePrefsStore.getState();
      return {
        voice: await resolvePlatformKnobString('media.listening.voice'),
        language,
        speed,
      };
    },
    reportProviderFailure: (failure) => reportProviderSessionFailure(matrxTransport, failure),
  });
}
