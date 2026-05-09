/**
 * Frictionless permission prompt store.
 *
 * Philosophy (Arman, May 2026): the optional-permission toggles in
 * Settings → Advanced are there to keep the Chrome Web Store reviewer
 * happy. Real users installed this extension because they WANT it to do
 * the things that need those permissions. Failing silently — or even
 * failing loudly with "go enable a setting" — is the worst possible UX.
 *
 * The rule: any time a feature needs an optional host permission and
 * doesn't have it, prompt the user with four choices. Never silently
 * reject. Never check whether the user already said no in the past
 * (the "denied" verdict is per-call, never cached). The user can
 * always opt out of being prompted again by picking "Allow Always" or
 * "Allow full Autonomous Access".
 *
 * Verdicts:
 *   - 'deny'        — this one call only. Operation aborts. Prompt next time.
 *   - 'allow'       — grant Chrome perm for this call. Prompt next time.
 *                     (Chrome's grant is sticky once accepted, so future
 *                     calls will silently use the live grant — but we
 *                     still surface the prompt because the user said
 *                     "this once" and may revoke it elsewhere.)
 *   - 'always'      — grant + cache "always allow this perm". Future
 *                     calls for this perm skip the prompt entirely.
 *   - 'autonomous'  — grant + cache "allow EVERY optional permission".
 *                     Future calls for ANY optional perm skip the prompt.
 *                     This is the "never bother me again, ever" button.
 *
 * NOTE: This is separate from the per-tool permission gate (Ask vs Act
 * mode) that the chat hook manages. That governs WHICH agent tools
 * confirm before running. This module governs WHETHER an underlying
 * Chrome capability is available at all.
 */

import { chromeLocalStorage } from '@/lib/storage/zustand-adapter';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type PermissionVerdict = 'deny' | 'allow' | 'always' | 'autonomous';

/** Permissions we know how to gate. Mirrors lib/permissions/optional.ts. */
export type GatedPermission = {
  kind: 'api';
  name: 'cookies' | 'pageCapture' | 'clipboardRead' | 'tabCapture' | 'debugger';
};

export interface PermissionPromptRequest {
  /** Stable id so concurrent callers can dedupe / await. */
  id: string;
  /** What we want. */
  permission: GatedPermission;
  /** Short feature name shown as the modal title (e.g. "Read this page"). */
  feature: string;
  /** One- or two-sentence reason for the prompt body. */
  reason: string;
  /** Resolver passed in from the requester; we call it with the verdict. */
  resolve: (v: PermissionVerdict) => void;
}

interface PermissionPromptsState {
  /** Currently displayed prompt, if any. Newer requests queue behind it. */
  active: PermissionPromptRequest | null;
  /** FIFO queue of pending prompts. */
  queue: PermissionPromptRequest[];
  /**
   * Per-permission "always allow" cache. Keyed by `keyOf(permission)`.
   * Persisted across sessions. NOT modified for 'deny' or single-shot
   * 'allow' verdicts.
   */
  alwaysAllow: Record<string, boolean>;
  /**
   * Global autonomous flag — when true, every optional permission is
   * implicitly always-allowed. The user-visible "I never want to be
   * bothered about advanced settings again" toggle.
   */
  autonomous: boolean;

  /** Enqueue a new prompt. The first call shows it; subsequent calls queue. */
  enqueue: (req: PermissionPromptRequest) => void;
  /** Resolve the active prompt + advance the queue. */
  resolveActive: (verdict: PermissionVerdict) => void;
  /** Imperative cache write — used by helpers that need to set state outside the prompt flow. */
  setAlwaysAllow: (key: string, value: boolean) => void;
  setAutonomous: (value: boolean) => void;
}

export const usePermissionPromptsStore = create<PermissionPromptsState>()(
  persist(
    (set, get) => ({
      active: null,
      queue: [],
      alwaysAllow: {},
      autonomous: false,

      enqueue: (req) =>
        set((s) => {
          if (!s.active) return { active: req, queue: s.queue };
          return { active: s.active, queue: [...s.queue, req] };
        }),

      resolveActive: (verdict) => {
        const { active, queue } = get();
        if (!active) return;
        try {
          active.resolve(verdict);
        } catch {
          /* never let a bad consumer resolver crash the queue */
        }
        const next = queue[0] ?? null;
        const rest = queue.slice(1);
        set({ active: next, queue: rest });
      },

      setAlwaysAllow: (key, value) =>
        set((s) => ({
          alwaysAllow: { ...s.alwaysAllow, [key]: value },
        })),

      setAutonomous: (value) => set({ autonomous: value }),
    }),
    {
      name: 'matrx.permission-prompts',
      storage: createJSONStorage(() => chromeLocalStorage),
      // Pending prompts are ephemeral; only persist user preferences.
      partialize: (s) => ({
        alwaysAllow: s.alwaysAllow,
        autonomous: s.autonomous,
      }),
    },
  ),
);

/** Stable cache key for a permission. */
export function keyOf(permission: GatedPermission): string {
  return `api:${permission.name}`;
}
