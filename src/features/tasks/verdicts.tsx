/**
 * The verdict catalog — single source of truth for the user-facing verdict
 * actions (label, description, icon) shared by the per-row Resolve menu and the
 * bulk action bar. Adding a verdict here surfaces it in both places at once.
 *
 * Includes the 2026-06-18 honest terminal verdicts: `ignored` ("not interested")
 * and `content_mismatch` ("page isn't what it claimed — redirect / wrong content,
 * not a 404"). 'retry' is gated by `includeRetry` (only meaningful after an attempt).
 */

import type { UserVerdict } from '@/lib/api/routes/research';
import { CheckCircle, EyeOff, FileQuestion, Lock, RotateCcw, Skull } from 'lucide-react';

export interface VerdictOption {
  verdict: UserVerdict;
  label: string;
  description: string;
  icon: typeof CheckCircle;
  /** Only shown when the source has at least one prior attempt. */
  retryOnly?: boolean;
}

export const VERDICT_OPTIONS: VerdictOption[] = [
  {
    verdict: 'accept_as_is',
    label: 'This is the whole page',
    description: 'Sparse content is correct — accept and move on.',
    icon: CheckCircle,
  },
  {
    verdict: 'content_mismatch',
    label: 'Wrong content — not what it should be',
    description: "Page loaded but isn't what it claimed (redirect / changed page). Not a 404.",
    icon: FileQuestion,
  },
  {
    verdict: 'gated',
    label: 'Page is gated',
    description: 'Login / paywall / captcha. Stop trying.',
    icon: Lock,
  },
  {
    verdict: 'dead_link',
    label: 'Page is dead / 404',
    description: "URL is gone. Don't surface this again.",
    icon: Skull,
  },
  {
    verdict: 'ignored',
    label: "Ignore — don't want it",
    description: 'Not interested. Not dead or gated — just stop surfacing it.',
    icon: EyeOff,
  },
  {
    verdict: 'retry',
    label: 'Retry from scratch',
    description: 'Throw away the last result and requeue.',
    icon: RotateCcw,
    retryOnly: true,
  },
];

/** Short label for the verdict, e.g. for the batch-confirm summary. */
export const VERDICT_SHORT: Record<UserVerdict, string> = {
  accept_as_is: 'Mark complete',
  content_mismatch: 'Wrong content',
  gated: 'Gated',
  dead_link: 'Dead link',
  ignored: 'Ignore',
  retry: 'Retry',
};
