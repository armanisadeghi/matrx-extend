/**
 * Voice / TTS preferences (TASK-002).
 *
 * Mirrors the `userPreferences.voice` Redux slice in matrx-frontend so the
 * Cartesia speaker hook reads the same shape across both products.
 *
 * Persisted to chrome.storage.local for now. Cross-install sync would happen
 * server-side (linked to the user's account), not via chrome.storage.sync —
 * sync has tight quotas and prefs belong with the user, not the install.
 */

import { chromeLocalStorage } from '@/lib/storage/zustand-adapter';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

const DEFAULT_VOICE_ID = '156fb8d2-335b-4950-9cb3-a2d33befec77';

interface VoicePrefsState {
  voice: string;
  language: string;
  speed: number;
  setVoice: (id: string) => void;
  setLanguage: (lang: string) => void;
  setSpeed: (speed: number) => void;
}

export const useVoicePrefsStore = create<VoicePrefsState>()(
  persist(
    (set) => ({
      voice: DEFAULT_VOICE_ID,
      language: 'en',
      speed: 0,
      setVoice: (voice) => set({ voice }),
      setLanguage: (language) => set({ language }),
      setSpeed: (speed) => set({ speed }),
    }),
    {
      name: 'matrx.voicePrefs.v1',
      storage: createJSONStorage(() => chromeLocalStorage),
    },
  ),
);
