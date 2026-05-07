/**
 * SpeakerButton — TTS playback control for an agent message bubble.
 *
 * Reads the message text via the Cartesia speaker hook, stripping markdown
 * first. Idle state is intentionally subtle (matches CopyMenu icon-button
 * styling); while speaking the icon swaps to a Pause / VolumeX so the user
 * can stop playback immediately.
 *
 * Errors are surfaced through the speaker hook's `onError` callback. There
 * is no toast wrapper in the extension yet (per TASK-002 notes), so failures
 * route to console + an inline aria-label change so the button doesn't
 * silently swallow the click.
 *
 * Each instance owns its own websocket / WebPlayer pair via the hook. The
 * hook auto-tears-down on unmount, so a long agent thread with many bubbles
 * does not keep N websockets open — only the bubbles whose users have
 * actually pressed Play allocate one.
 */

import { Loader2, Pause, Volume2, VolumeX } from 'lucide-react';
import { useCallback, useState } from 'react';
import { cn } from '@/lib/utils';
import { useCartesiaSpeaker } from '@/lib/tts/useCartesiaSpeaker';

interface SpeakerButtonProps {
  /** Raw markdown the agent emitted; stripped to plain text before sending. */
  text: string;
  /** ARIA-friendly label override; defaults to "Read message aloud". */
  title?: string;
  className?: string;
}

export function SpeakerButton({
  text,
  title = 'Read message aloud',
  className,
}: SpeakerButtonProps) {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const onError = useCallback((message: string) => {
    setErrorMessage(message);
    // Clear so a subsequent successful play resets the title.
    setTimeout(() => setErrorMessage(null), 4000);
  }, []);

  const { isLoading, isPlaying, isPaused, speak, stop } = useCartesiaSpeaker({
    processMarkdown: true,
    onError,
  });

  const handleClick = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      if (isPlaying || isPaused) {
        await stop();
        return;
      }
      if (!text.trim()) return;
      await speak(text);
    },
    [text, isPlaying, isPaused, speak, stop],
  );

  const Icon = errorMessage
    ? VolumeX
    : isLoading
      ? Loader2
      : isPlaying
        ? Pause
        : isPaused
          ? VolumeX
          : Volume2;

  const buttonTitle = errorMessage
    ? errorMessage
    : isPlaying
      ? 'Stop speaking'
      : isPaused
        ? 'Stop speaking'
        : title;

  return (
    <button
      type="button"
      onClick={handleClick}
      title={buttonTitle}
      aria-label={buttonTitle}
      disabled={isLoading || !text.trim()}
      className={cn(
        'inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50',
        (isPlaying || isPaused) && 'text-foreground',
        errorMessage && 'text-red-500 hover:text-red-500',
        className,
      )}
    >
      <Icon className={cn('size-3.5', isLoading && 'animate-spin')} />
    </button>
  );
}
