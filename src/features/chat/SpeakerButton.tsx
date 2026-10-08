/**
 * Read-aloud for one assistant message: THE one speech engine (`useReadAloud`, @ai-matrx/media)
 * behind the shared `ReadAloudButton`, in the compact message-footer size. Inside the package
 * chat a slot caller may pass its own `variant` (chat's footer group).
 */

import { ReadAloudButton, useReadAloud } from '@ai-matrx/media/react';
import type { ComponentProps } from 'react';

type Variant = ComponentProps<typeof ReadAloudButton>['variant'];

export function SpeakerButton({
  text,
  className,
  variant,
}: {
  text: string;
  className?: string;
  variant?: Variant;
}) {
  const { status, error, onPress } = useReadAloud(text);
  return (
    <ReadAloudButton
      status={status}
      error={error}
      onPress={onPress}
      disabled={!text.trim()}
      {...(variant !== undefined ? { variant } : { size: 'compact' as const })}
      {...(className !== undefined && { className })}
    />
  );
}
