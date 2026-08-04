import { DEFAULT_AGENDA_AGENT_ID } from '@/lib/agenda/constants';
import { chromeLocalStorage } from '@/lib/storage/zustand-adapter';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * UI-only preferences that don't affect cross-context wiring.
 *
 * Backend env / URL override are NOT here — they live in chrome.storage.local
 * under their own keys (see src/config/backend.ts) so every MV3 context
 * (sidepanel, SW, offscreen) reads the same source of truth.
 */
export type PermissionMode = 'ask' | 'act';
export type ChatSpeed = 'fast' | 'thinking';
export type ScrapeAutoMode = 'capture' | 'scroll-capture';
export type AgentScope = 'mine' | 'shared' | 'system';

interface SettingsState {
  theme: 'light' | 'dark' | 'system';

  /**
   * Send captured HTML through the server-side AI cleanup pass before saving.
   * NOT WIRED YET — captures use local DOM scraping; the `/scraper/quick-scrape`
   * `ai_clean` endpoint has no client caller. UI labeled "coming soon".
   */
  scrapeDeepClean: boolean;

  // ─── Chat defaults ──────────────────────────────────────────────────────
  /**
   * Auto-selected when the chat tab loads with no agent chosen yet. The
   * single source of truth for "which agent should open by default" across
   * Chat, Pilot, Agenda fallbacks, and parallel_for_each_tab fan-out.
   * Initial value is the Matrx Browser Agent so fresh installs and guests
   * land on a working agent immediately; users override it via
   * Settings → Default agent. NEVER hardcode the UUID in callers — read
   * this and fall back to DEFAULT_AGENDA_AGENT_ID only when the setting
   * itself is somehow cleared.
   */
  defaultAgentId: string | null;
  /** Fallback for the per-agent ask/act mode when an agent has no override. */
  defaultPermissionMode: PermissionMode;
  /** Composer speed default. NOT WIRED YET — placeholder UI only. */
  defaultChatSpeed: ChatSpeed;
  /**
   * Which agent-scope buckets the chat dropdown shows. Multi-select; defaults
   * to ['mine'] only — users opt into seeing shared / system agents. Persisted
   * across reloads.
   */
  agentScopes: AgentScope[];
  /**
   * On the user's first submit on a fresh page, scroll top→bottom (catching
   * lazy-loaded content), capture, then restore the user's scroll position —
   * BEFORE the message is sent. Costs 1–4s of perceived latency on the first
   * submit per page; subsequent submits reuse the deep capture. Off by default.
   */
  autoFullScrollOnFirstSubmit: boolean;
  /**
   * Override the agent's default model. UUID from `ai_model.id`. Sent as
   * `config_overrides.model` on every chat request when set. Null = use the
   * agent's configured model. Persists across reloads — the user's pick
   * sticks until they explicitly clear or re-pick.
   *
   * Both surfaces write here:
   *   - Customize popover (curated 8-entry preset list, user-facing)
   *   - Debug tab admin picker (full ai_model search, admin-only)
   */
  modelOverrideId: string | null;

  // ─── Privacy ───────────────────────────────────────────────────────────
  /**
   * Share page identity & email content with the agent. Gates the
   * `auth_state` (visible username on the current site) and
   * `email_inbox`/`email_thread` (Gmail subjects + body excerpts) context
   * keys — both are PII shipped to the server on every send when present
   * (audit P1-10). Default ON: they're a large part of what makes the agent
   * useful on those pages; this toggle makes the trade visible + reversible.
   */
  sharePageIdentity: boolean;

  // ─── Scrape auto-capture ───────────────────────────────────────────────
  /** Auto-run a scrape on every page load (background). Gates useAutoScrape. */
  scrapeAutoOnLoad: boolean;
  /**
   * Background auto-capture style: `capture` = fast visible-DOM grab,
   * `scroll-capture` = scroll top→bottom first to load lazy content, then
   * capture (slower). Consumed in use-auto-scrape.ts `runCapture`.
   */
  scrapeAutoMode: ScrapeAutoMode;

  setTheme: (t: SettingsState['theme']) => void;
  setScrapeDeepClean: (b: boolean) => void;
  setDefaultAgentId: (id: string | null) => void;
  setDefaultPermissionMode: (m: PermissionMode) => void;
  setDefaultChatSpeed: (s: ChatSpeed) => void;
  setAgentScopes: (scopes: AgentScope[]) => void;
  toggleAgentScope: (scope: AgentScope) => void;
  setAutoFullScrollOnFirstSubmit: (b: boolean) => void;
  setModelOverrideId: (id: string | null) => void;
  setSharePageIdentity: (b: boolean) => void;
  setScrapeAutoOnLoad: (b: boolean) => void;
  setScrapeAutoMode: (m: ScrapeAutoMode) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      theme: 'system',
      scrapeDeepClean: false,
      defaultAgentId: DEFAULT_AGENDA_AGENT_ID,
      defaultPermissionMode: 'ask',
      defaultChatSpeed: 'fast',
      agentScopes: ['mine'],
      autoFullScrollOnFirstSubmit: false,
      modelOverrideId: null,
      sharePageIdentity: true,
      scrapeAutoOnLoad: true,
      scrapeAutoMode: 'capture',
      setTheme: (theme) => set({ theme }),
      setScrapeDeepClean: (scrapeDeepClean) => set({ scrapeDeepClean }),
      setDefaultAgentId: (defaultAgentId) => set({ defaultAgentId }),
      setDefaultPermissionMode: (defaultPermissionMode) => set({ defaultPermissionMode }),
      setDefaultChatSpeed: (defaultChatSpeed) => set({ defaultChatSpeed }),
      setAgentScopes: (agentScopes) => {
        // Always keep at least one scope selected — empty = nothing visible
        // and the user gets stuck. Snap back to ['mine'] in that case.
        set({ agentScopes: agentScopes.length === 0 ? ['mine'] : agentScopes });
      },
      toggleAgentScope: (scope) =>
        set((s) => {
          const next = s.agentScopes.includes(scope)
            ? s.agentScopes.filter((x) => x !== scope)
            : [...s.agentScopes, scope];
          return { agentScopes: next.length === 0 ? ['mine'] : next };
        }),
      setAutoFullScrollOnFirstSubmit: (autoFullScrollOnFirstSubmit) =>
        set({ autoFullScrollOnFirstSubmit }),
      setModelOverrideId: (modelOverrideId) => set({ modelOverrideId }),
      setSharePageIdentity: (sharePageIdentity) => set({ sharePageIdentity }),
      setScrapeAutoOnLoad: (scrapeAutoOnLoad) => set({ scrapeAutoOnLoad }),
      setScrapeAutoMode: (scrapeAutoMode) => set({ scrapeAutoMode }),
    }),
    {
      name: 'matrx.settings.v1',
      storage: createJSONStorage(() => chromeLocalStorage),
      // Bump when the schema changes in a way that needs rewriting old
      // persisted state.
      //   v1 → v2 (2026-05-19): defaultAgentId default flipped from null
      //     to DEFAULT_AGENDA_AGENT_ID so chat / agenda / parallel all
      //     have a working agent without each caller re-implementing a
      //     fallback. Users who installed before v2 have null persisted;
      //     migrate replaces it.
      version: 2,
      migrate: (persisted, fromVersion) => {
        const state = (persisted ?? {}) as Partial<SettingsState>;
        if (
          fromVersion < 2 &&
          (state.defaultAgentId === null || state.defaultAgentId === undefined)
        ) {
          state.defaultAgentId = DEFAULT_AGENDA_AGENT_ID;
        }
        return state as SettingsState;
      },
    },
  ),
);
