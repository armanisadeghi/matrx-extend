/**
 * "Act without asking" — the ONE platform setting `chat.act_without_asking` (Arman, 2026-10-22).
 *
 * The extension's Ask / Act chips (chat header, Pilot header, Settings › Default mode) read and
 * write the SAME knob the web, desktop and Matrx Local chats use, at the person's own rung in the
 * active organization. The platform default is Act: nothing waits for the person except a question
 * the agent itself asks. Ask is opt-in and gates exactly what was gated before.
 *
 * An unanswered or unreadable setting is Act (the platform default) — a setting never makes a run wait.
 */

import { ensureRequestOrganizationId } from '@/hooks/use-request-organization';
import { platformDb } from '@/lib/supabase/schemas';
import { useAuthStore } from '@/state/auth';
import { writeFeatureKnob } from '@ai-matrx/data/knobs';
import { useSyncExternalStore } from 'react';
import { invalidateKnobSnapshot, resolvePlatformKnobInWorker } from './platform-knob-snapshot';
import { peekPlatformKnob, subscribePlatformKnobs, warmPlatformKnobs } from './platform-knobs';

export const ACT_WITHOUT_ASKING_KNOB = 'chat.act_without_asking';
export type ActMode = 'ask' | 'act';

/** A write this context made that the next snapshot has not confirmed yet. */
let pending: ActMode | null = null;
const listeners = new Set<() => void>();
const notify = () => {
  for (const l of listeners) l();
};
subscribePlatformKnobs(() => {
  pending = null;
  notify();
});

function asMode(value: unknown): ActMode | undefined {
  if (value === true) return 'act';
  if (value === false) return 'ask';
  return undefined;
}

/** The active mode, synchronously (side panel). Unanswered → Act, and the snapshot is warmed. */
export function readActMode(): ActMode {
  if (pending) return pending;
  const mode = asMode(peekPlatformKnob(ACT_WITHOUT_ASKING_KNOB));
  if (mode === undefined) void warmPlatformKnobs();
  return mode ?? 'act';
}

/** The active mode from the service worker (no side-panel stores). Unreadable → Act. */
export async function readActModeInWorker(): Promise<ActMode> {
  return asMode(await resolvePlatformKnobInWorker(ACT_WITHOUT_ASKING_KNOB)) ?? 'act';
}

export function subscribeActMode(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** React: the active mode, re-rendering when it changes. */
export function useActMode(): ActMode {
  return useSyncExternalStore(subscribeActMode, readActMode, () => 'act' as ActMode);
}

/** Write the person's own choice (their rung in the active organization) through the one door. */
export async function writeActMode(mode: ActMode): Promise<{ ok: boolean; detail?: string }> {
  pending = mode;
  notify();
  const refuse = (detail: string) => {
    console.error(`[act-without-asking] the choice was not saved: ${detail}`);
    pending = null;
    notify();
    return { ok: false, detail };
  };
  try {
    const userId = useAuthStore.getState().user?.id ?? null;
    if (!userId) return refuse('not signed in');
    const organizationId = await ensureRequestOrganizationId();
    if (!organizationId) return refuse('no organization');
    const result = await writeFeatureKnob(platformDb(), {
      feature: 'chat',
      key: 'act_without_asking',
      target: { scopeKind: 'user', scopeId: userId, organizationId },
      value: mode === 'act',
      note: 'Person changed the Act without asking setting in the extension.',
    });
    if (!result.ok) return refuse(result.message);
    invalidateKnobSnapshot();
    void warmPlatformKnobs();
    return { ok: true };
  } catch (error) {
    return refuse(error instanceof Error ? error.message : 'unexpected write failure');
  }
}

/**
 * One-time carry-over (Arman, 2026-10-22: "where a person explicitly chose Ask, keep it"): the old
 * per-agent chips stored explicit choices locally (chat + Pilot). Any explicit 'ask' becomes the
 * person's Ask on the one setting; the local copies are never read again. The old Settings default
 * was 'ask' for everyone untouched, so it cannot say who chose — it is not carried.
 */
export async function carryOverExplicitAsk(): Promise<boolean> {
  const DONE_KEY = 'matrx.act-without-asking.carried-over.v1';
  const STORES = ['matrx.chat.v1', 'matrx.pilot-chat.v1'];
  const got = await chrome.storage.local.get([DONE_KEY, ...STORES]);
  if (got[DONE_KEY]) return false;
  const choseAsk = STORES.some((key) => {
    try {
      const raw = got[key];
      const blob = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const perAgent = (blob?.state?.permissionMode ?? {}) as Record<string, unknown>;
      return Object.values(perAgent).some((m) => m === 'ask');
    } catch {
      return false;
    }
  });
  if (choseAsk) {
    const saved = await writeActMode('ask');
    if (!saved.ok) return false;
  }
  await chrome.storage.local.set({ [DONE_KEY]: true });
  return choseAsk;
}
