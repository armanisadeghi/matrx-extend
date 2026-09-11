/**
 * User-facing notice store — the extension's ONE way to tell the user that
 * something the platform did on their behalf failed, succeeded loudly, or
 * needs their attention.
 *
 * Why this exists: the extension had no notice primitive at all, so every
 * Supabase refusal (RLS 42501, a missing relation, a write RLS silently
 * filtered to zero rows) ended in `console.warn` + `return null` — invisible
 * to a non-technical user, who saw a button snap back to its resting state
 * and believed the save had worked. A screen is absent or honest; it is never
 * dead or quietly lying (law 4, "nothing fails silently").
 *
 * Contract:
 *   - `pushNotice()` is callable from ANY extension context. When it runs
 *     outside the side panel (service worker, offscreen, content script) it
 *     relays the notice to the side panel over `CHANNELS.DB_FAILURE_NOTICE`
 *     so the user still sees it.
 *   - Every notice carries a human sentence AND a remedy sentence. A notice
 *     without a remedy is a defect, not a style choice.
 *   - In-memory only, capped. Notices are announcements, not records — the
 *     durable record goes to `ops.system_error` through the platform's
 *     `log_client_error` RPC (see `src/lib/supabase/db-failure.ts`).
 */

import { newId } from '@/lib/id';
import { CHANNELS } from '@/lib/messaging/schemas';
import { create } from 'zustand';

export type NoticeTone = 'error' | 'warning' | 'info';

export interface Notice {
  id: string;
  ts: number;
  tone: NoticeTone;
  /** Short headline — what failed, in the user's words. */
  title: string;
  /** One or two full sentences: what happened AND what to do about it. */
  message: string;
  /** Admin-only technical tail (error code, table). Never shown to normal users. */
  detail?: string | undefined;
}

export interface NoticeInput {
  tone: NoticeTone;
  title: string;
  message: string;
  detail?: string | undefined;
}

const MAX_NOTICES = 8;

interface NoticeState {
  notices: Notice[];
  add: (n: Notice) => void;
  dismiss: (id: string) => void;
  clear: () => void;
}

export const useNoticeStore = create<NoticeState>((set) => ({
  notices: [],
  add: (n) =>
    set((s) => {
      // Collapse an identical repeat (a retry loop must not stack 40 cards).
      const without = s.notices.filter((x) => !(x.title === n.title && x.message === n.message));
      return { notices: [...without, n].slice(-MAX_NOTICES) };
    }),
  dismiss: (id) => set((s) => ({ notices: s.notices.filter((n) => n.id !== id) })),
  clear: () => set({ notices: [] }),
}));

function isSidepanel(): boolean {
  try {
    return (
      typeof window !== 'undefined' &&
      typeof location !== 'undefined' &&
      location.pathname.includes('sidepanel')
    );
  } catch {
    return false;
  }
}

/** Build a Notice from an input (exported so the relay listener can reuse it). */
export function makeNotice(input: NoticeInput): Notice {
  return {
    id: newId(),
    ts: Date.now(),
    tone: input.tone,
    title: input.title,
    message: input.message,
    ...(input.detail !== undefined && { detail: input.detail }),
  };
}

/**
 * Show a notice to the user. Safe from any context: outside the side panel the
 * notice is relayed to it, because that is the only surface the user looks at.
 */
export function pushNotice(input: NoticeInput): Notice {
  const notice = makeNotice(input);
  if (isSidepanel()) {
    useNoticeStore.getState().add(notice);
    return notice;
  }
  useNoticeStore.getState().add(notice); // local mirror (debug surfaces read it)
  try {
    // Raw envelope, NOT `broadcast()`: broadcast also fans out to this
    // context's own `on()` listeners, which would re-add the local mirror.
    void chrome.runtime
      ?.sendMessage({ __matrx: true, kind: CHANNELS.DB_FAILURE_NOTICE, payload: notice })
      ?.catch(() => undefined);
  } catch {
    /* no receiver yet — the local mirror still holds it */
  }
  return notice;
}
