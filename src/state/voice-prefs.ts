/**
 * Voice / TTS preferences (TASK-002): language and speed.
 *
 * The VOICE is not stored here: read-aloud follows the person's platform
 * "Read-aloud voice" (see src/lib/tts/read-aloud-voice.ts), the same setting
 * aimatrx.com uses.
 *
 * Persisted to chrome.storage.local for now. Cross-install sync would happen
 * server-side (linked to the user's account), not via chrome.storage.sync —
 * sync has tight quotas and prefs belong with the user, not the install.
 */

import { chromeLocalStorage } from '@/lib/storage/zustand-adapter';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

interface VoicePrefsState {
  language: string;
  speed: number;
  setLanguage: (lang: string) => void;
  setSpeed: (speed: number) => void;
}

export const useVoicePrefsStore = create<VoicePrefsState>()(
  persist(
    (set) => ({
      language: 'en',
      speed: 0,
      setLanguage: (language) => set({ language }),
      setSpeed: (speed) => set({ speed }),
    }),
    {
      name: 'matrx.voicePrefs.v1',
      storage: createJSONStorage(() => chromeLocalStorage),
    },
  ),
);
