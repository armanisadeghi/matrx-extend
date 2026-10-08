/**
 * Read-aloud for one assistant message: the extension's Cartesia speaker
 * (`useCartesiaSpeaker`) behind the shared `ReadAloudButton` (@ai-matrx/media).
 * A press while speaking stops; an error shows the speaker's sentence for 4 s.
 */

import { useCartesiaSpeaker } from '@/lib/tts/useCartesiaSpeaker';
import { ReadAloudButton, type ReadAloudStatus } from '@ai-matrx/media/react';
import { useCallback, useState } from 'react';

export function SpeakerButton({ text, className }: { text: string; className?: string }) {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const onError = useCallback((message: string) => {
    setErrorMessage(message);
    setTimeout(() => setErrorMessage(null), 4000);
  }, []);
  const { isLoading, isPlaying, isPaused, speak, stop } = useCartesiaSpeaker({
    processMarkdown: true,
    onError,
  });
  const status: ReadAloudStatus = errorMessage
    ? 'error'
    : isLoading
      ? 'loading'
      : isPlaying || isPaused
        ? 'playing'
        : 'idle';
  const onPress = useCallback(() => {
    setErrorMessage(null);
    if (isPlaying || isPaused) void stop();
    else if (text.trim()) void speak(text);
  }, [isPlaying, isPaused, text, speak, stop]);
  return (
    <ReadAloudButton
      status={status}
      error={errorMessage}
      onPress={onPress}
      disabled={!text.trim()}
      variant="transparent"
      {...(className !== undefined && { className })}
    />
  );
}
