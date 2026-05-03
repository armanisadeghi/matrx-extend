/**
 * Pre-first-token indicator. A two-layer orb that scales like a slow breath
 * (~3.2s in / out, eased) — soft halo + solid core. Inherits color from the
 * `text-*` class on the wrapper.
 *
 * Uses SMIL so the animation lives on the element and survives even if the
 * tab is throttled (CSS animations on hidden tabs pause; SMIL doesn't here
 * because we render in the active side panel).
 */

import { cn } from '@/lib/utils';

export interface BreathingOrbProps {
  className?: string;
  /** Pixel size of the SVG. Defaults to 28. */
  size?: number;
  /** Optional helper text shown to the right (e.g. "Thinking…"). */
  label?: string;
}

const KEY_SPLINES = '0.42 0 0.58 1; 0.42 0 0.58 1';

export function BreathingOrb({ className, size = 28, label }: BreathingOrbProps) {
  return (
    <output
      className={cn('inline-flex items-center gap-2 text-primary', className)}
      aria-label={label ?? 'Working'}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 40 40"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <title>Working</title>
        <defs>
          <radialGradient id="breathing-orb-halo" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.35" />
            <stop offset="70%" stopColor="currentColor" stopOpacity="0.05" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </radialGradient>
        </defs>
        {/* Soft halo */}
        <circle cx="20" cy="20" r="14" fill="url(#breathing-orb-halo)">
          <animate
            attributeName="r"
            values="12;18;12"
            dur="3.2s"
            calcMode="spline"
            keySplines={KEY_SPLINES}
            repeatCount="indefinite"
          />
          <animate
            attributeName="opacity"
            values="0.6;1;0.6"
            dur="3.2s"
            calcMode="spline"
            keySplines={KEY_SPLINES}
            repeatCount="indefinite"
          />
        </circle>
        {/* Solid core — slightly out of phase for organic feel */}
        <circle cx="20" cy="20" r="6" fill="currentColor">
          <animate
            attributeName="r"
            values="5;8;5"
            dur="3.2s"
            calcMode="spline"
            keySplines={KEY_SPLINES}
            repeatCount="indefinite"
            begin="0.15s"
          />
          <animate
            attributeName="opacity"
            values="0.7;1;0.7"
            dur="3.2s"
            calcMode="spline"
            keySplines={KEY_SPLINES}
            repeatCount="indefinite"
            begin="0.15s"
          />
        </circle>
      </svg>
      {label && <ShimmerText>{label}</ShimmerText>}
    </output>
  );
}

/**
 * Inline gradient-shimmer text. Reused by ThinkingBlock for the "Reasoning…"
 * label. Keeps one definition of the effect.
 */
export function ShimmerText({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'animate-text-shimmer bg-clip-text text-transparent',
        '[background-size:200%_100%]',
        'bg-[linear-gradient(90deg,var(--muted-foreground)_0%,var(--foreground)_50%,var(--muted-foreground)_100%)]',
        className,
      )}
    >
      {children}
    </span>
  );
}
