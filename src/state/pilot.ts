/**
 * Pilot session state — CLAUDE.md roadmap item #9.
 *
 * The Pilot tab is matrx-extend's second agent surface. Where the
 * Assistant Chat tab is read-mostly and follows the user's active tab,
 * the Pilot tab is meant to drive its own sandboxed Chrome tab group:
 * the agent gets the full read+action+ask surface, and every action it
 * takes is constrained to tabs inside that group.
 *
 * Lifecycle:
 *   1. User clicks "Start Pilot" in the Pilot tab. We create a new
 *      Chrome tab group seeded with the active tab (or a fresh blank
 *      tab when none is suitable). The group's id + windowId are
 *      latched into the session record.
 *   2. The user chats with the Pilot agent. Tool calls flow through
 *      the same SW dispatcher the Assistant uses, but the dispatcher
 *      reads `usePilotStore.getState()` and rejects any action whose
 *      target tab isn't part of the active session's group.
 *   3. User clicks "End Session". We close every tab in the group;
 *      Chrome auto-removes the (now empty) group.
 *
 * Persistence:
 *   chrome.storage.local key `matrxPilotSession` — survives sidepanel
 *   close. On boot, the Pilot tab can reattach to a still-existing
 *   group; if the group has been removed externally, the lifecycle
 *   listeners in the SW reset the record.
 *
 * Why a separate store and not part of useChatStore: Pilot has its
 * own conversation_id, agent selection, message stream, and
 * group-scoped invariants. Folding it into the chat store would
 * couple two surfaces that the user's task description explicitly
 * wants kept parallel.
 */

import { log } from '@/lib/debug/log';
import { chromeLocalStorage } from '@/lib/storage/zustand-adapter';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export interface PilotSession {
  active: boolean;
  /** chrome.tabGroups.TabGroup.id — null when inactive. */
  groupId: number | null;
  /** Window the group lives in. Used to keep new pilot tabs in the same window. */
  windowId: number | null;
  /** Server-assigned conversation id for the current pilot turn (latched on first message). */
  conversationId: string | null;
  /** Agent powering the pilot session. */
  agentId: string | null;
  /** Unix ms when startSession resolved. null when inactive. */
  startedAt: number | null;
}

interface StartOpts {
  agentId: string;
  /**
   * Tab id to seed the new group with. When omitted, the active tab in
   * the current window is used. The group needs at least one tab to
   * exist; a blank `chrome://newtab` is opened as a last resort.
   */
  seedTabId?: number;
}

interface PilotStore {
  session: PilotSession;
  /**
   * Create a fresh tab group, seed it with the chosen tab, and persist
   * the session. Refuses if a session is already active (call
   * `endSession` first). Returns silently — surface errors via log.
   */
  startSession: (opts: StartOpts) => Promise<void>;
  /**
   * Close every tab in the active group (Chrome auto-removes the group
   * once empty) and reset state. No-op when there is no active session.
   */
  endSession: () => Promise<void>;
  /** Latch the server-assigned conversation id from STREAM_OPENED. */
  setConversationId: (id: string | null) => void;
  /** Update the agent powering the session (without restarting it). */
  setAgentId: (agentId: string | null) => void;
  /** Used by the dispatcher to gate action-tier tools to the group. */
  isTabInSession: (tabId: number) => Promise<boolean>;
  /**
   * Verify the persisted groupId still corresponds to a real group.
   * Used on boot — if Chrome was closed since the session was started,
   * the group is gone and we need to reset.
   */
  isGroupValid: () => Promise<boolean>;
  /**
   * Force-reset the session locally without touching tabs. Called by
   * the SW lifecycle listeners when Chrome notifies us that the group
   * was removed externally (last tab closed by the user, etc.).
   */
  resetLocal: () => void;
}

const inactiveSession = (): PilotSession => ({
  active: false,
  groupId: null,
  windowId: null,
  conversationId: null,
  agentId: null,
  startedAt: null,
});

async function resolveSeedTab(seedTabId: number | undefined): Promise<chrome.tabs.Tab | null> {
  if (seedTabId != null) {
    try {
      return await chrome.tabs.get(seedTabId);
    } catch {
      // fall through to active-tab lookup
    }
  }
  try {
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (active) return active;
  } catch {
    /* ignore */
  }
  // No active tab? Create a blank one so the group has something to anchor to.
  try {
    return await chrome.tabs.create({ active: true });
  } catch {
    return null;
  }
}

export const usePilotStore = create<PilotStore>()(
  persist(
    (set, get) => ({
      session: inactiveSession(),

      startSession: async (opts) => {
        if (get().session.active) {
          log.warn('pilot', 'startSession ignored — a session is already active');
          return;
        }
        if (!chrome.tabGroups || !chrome.tabs?.group) {
          log.warn('pilot', 'tabGroups API unavailable — pilot session cannot start');
          return;
        }
        const seed = await resolveSeedTab(opts.seedTabId);
        if (!seed?.id) {
          log.warn('pilot', 'startSession could not resolve a seed tab');
          return;
        }
        let groupId: number;
        try {
          groupId = await chrome.tabs.group({ tabIds: [seed.id] });
        } catch (err) {
          log.error('pilot', 'chrome.tabs.group failed', err);
          return;
        }
        // Cosmetic: paint the group blue with the title "Pilot" so the
        // user sees at a glance which tabs the agent owns. Failures here
        // are non-fatal — the session is still valid without coloring.
        try {
          await chrome.tabGroups.update(groupId, {
            color: 'blue',
            title: 'Pilot',
          });
        } catch (err) {
          log.warn('pilot', 'tabGroups.update failed', err);
        }
        const windowId = seed.windowId ?? null;
        set({
          session: {
            active: true,
            groupId,
            windowId,
            conversationId: null,
            agentId: opts.agentId,
            startedAt: Date.now(),
          },
        });
        log.info('pilot', `session started — group=${groupId} window=${windowId}`);
      },

      endSession: async () => {
        const { session } = get();
        if (!session.active || session.groupId == null) {
          set({ session: inactiveSession() });
          return;
        }
        try {
          const tabs = await chrome.tabs.query({ groupId: session.groupId });
          const ids = tabs.map((t) => t.id).filter((id): id is number => id != null);
          if (ids.length > 0) {
            await chrome.tabs.remove(ids);
          }
        } catch (err) {
          log.warn('pilot', 'endSession failed to close tabs', err);
        }
        set({ session: inactiveSession() });
        log.info('pilot', 'session ended');
      },

      setConversationId: (id) =>
        set((s) =>
          s.session.conversationId === id ? s : { session: { ...s.session, conversationId: id } },
        ),

      setAgentId: (agentId) => set((s) => ({ session: { ...s.session, agentId } })),

      isTabInSession: async (tabId) => {
        const { session } = get();
        if (!session.active || session.groupId == null) return false;
        try {
          const tab = await chrome.tabs.get(tabId);
          return tab.groupId === session.groupId;
        } catch {
          return false;
        }
      },

      isGroupValid: async () => {
        const { session } = get();
        if (!session.active || session.groupId == null) return false;
        if (!chrome.tabGroups) return false;
        try {
          const group = await chrome.tabGroups.get(session.groupId);
          return group != null;
        } catch {
          return false;
        }
      },

      resetLocal: () => set({ session: inactiveSession() }),
    }),
    {
      name: 'matrxPilotSession',
      storage: createJSONStorage(() => chromeLocalStorage),
      // Persist the whole session — when the sidepanel is reopened we want
      // the Pilot view to show the still-active session if Chrome wasn't
      // restarted in the meantime.
      partialize: (s) => ({ session: s.session }),
      // Versioned + validated rehydration (audit P2-10): a malformed
      // persisted session would otherwise flow straight into the SW's
      // sandbox gate.
      version: 1,
      migrate: (persisted) => {
        const p = (persisted ?? {}) as { session?: Record<string, unknown> };
        const sess = p.session;
        if (
          !sess ||
          typeof sess.active !== 'boolean' ||
          (sess.groupId !== null && typeof sess.groupId !== 'number')
        ) {
          return { session: inactiveSession() };
        }
        return p;
      },
    },
  ),
);

/**
 * Synchronous accessor for non-React callers (the SW dispatcher).
 * Exists so dispatch.ts doesn't need to import the React hook just to
 * read the latched group id.
 *
 * ⚠️ Staleness caveat (audit P1-12): each MV3 context has its own store
 * instance, hydrated once at module init. The SW's copy does NOT see a
 * sidepanel start/end until the cross-context re-sync below fires. Gates
 * should prefer {@link getPilotSessionSnapshotAsync}.
 */
export function getPilotSessionSnapshot(): PilotSession {
  return usePilotStore.getState().session;
}

/**
 * Hydration-safe accessor for SW gates (audit P1-12). Two failure modes the
 * sync accessor had:
 *   1. Async-rehydration race: in the first ms after an SW wake the store
 *      still holds the default inactive session — the Pilot sandbox gate
 *      silently skipped.
 *   2. Cross-context staleness: start/end clicks happen in the SIDEPANEL's
 *      store instance; the SW copy only re-read storage on restart, so the
 *      sandbox could be unenforced (or false-violating) for the whole
 *      session. The storage.onChanged re-sync below closes the steady-state
 *      gap; this accessor closes the wake-race gap.
 */
export async function getPilotSessionSnapshotAsync(): Promise<PilotSession> {
  try {
    if (!usePilotStore.persist.hasHydrated()) {
      await usePilotStore.persist.rehydrate();
    }
  } catch {
    /* fall back to whatever is in memory */
  }
  return usePilotStore.getState().session;
}

// Cross-context re-sync: when ANOTHER context (the sidepanel's start/end
// buttons) writes the persisted session, re-hydrate this context's store so
// SW gates see it without waiting for an SW restart. Guarded so importing
// this module under plain tsx (catalog scripts) doesn't touch chrome.*.
try {
  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.matrxPilotSession) return;
      void usePilotStore.persist.rehydrate();
    });
  }
} catch {
  /* non-extension context */
}
