/**
 * Tracks which tool categories the agent has loaded so far in the current
 * conversation, plus the live tool list as of the last RESOURCE_CHANGED
 * kind=active_tools event.
 *
 * Why per-conversation: tool mutations are server-side per-request today,
 * so each new turn restarts with `[load_chrome_tools]`. The hint
 * `loaded_categories` survives turn boundaries on the client and is sent
 * back so the server can detect re-discovery patterns (or, once cross-
 * request persistence ships, short-circuit them).
 *
 * The store is keyed by conversation_id; null = pre-conversation (the very
 * first user message before the server has assigned an id).
 */

import { create } from 'zustand';

interface ActiveToolsState {
  /** conversation_id → set of categories the agent has discovered. */
  loadedByConversation: Record<string, string[]>;
  /** Live list of active tools, last-seen from RESOURCE_CHANGED. */
  liveTools: string[];

  /** Record that the agent invoked a category list-tool / discovery call. */
  recordCategoryLoaded: (conversationId: string | null, category: string) => void;
  /** Update the live list from a RESOURCE_CHANGED event. */
  setLiveTools: (tools: string[]) => void;
  /** Forget what we've loaded — call on conversation reset. */
  resetForConversation: (conversationId: string | null) => void;
  /** Read the loaded set for a conversation (null-safe). */
  getLoaded: (conversationId: string | null) => string[];
}

const KEY = (id: string | null): string => id ?? '__pending__';

export const useActiveToolsStore = create<ActiveToolsState>((set, get) => ({
  loadedByConversation: {},
  liveTools: [],

  recordCategoryLoaded: (conversationId, category) =>
    set((s) => {
      const k = KEY(conversationId);
      const cur = s.loadedByConversation[k] ?? [];
      if (cur.includes(category)) return s;
      return {
        loadedByConversation: { ...s.loadedByConversation, [k]: [...cur, category] },
      };
    }),

  setLiveTools: (liveTools) => set({ liveTools }),

  resetForConversation: (conversationId) =>
    set((s) => {
      const k = KEY(conversationId);
      if (!(k in s.loadedByConversation)) return s;
      const next = { ...s.loadedByConversation };
      delete next[k];
      return { loadedByConversation: next };
    }),

  getLoaded: (conversationId) => get().loadedByConversation[KEY(conversationId)] ?? [],
}));
