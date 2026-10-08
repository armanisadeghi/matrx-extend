/** The shared read-aloud language picker (@ai-matrx/media) bound to this device's voice prefs. */

import { useVoicePrefsStore } from '@/state/voice-prefs';
import { ReadAloudLanguagePicker } from '@ai-matrx/media/react';

export function VoiceLanguagePicker() {
  const language = useVoicePrefsStore((s) => s.language);
  const setLanguage = useVoicePrefsStore((s) => s.setLanguage);
  return <ReadAloudLanguagePicker value={language} onChange={setLanguage} />;
}
