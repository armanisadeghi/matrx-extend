import { DEFAULT_CHAT_MANDATE_REF } from '@/lib/mandates';
import { SETTINGS_PERSIST_VERSION, migrateDefaultBrowserAgent } from '@/lib/settings/migrate';
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
   * Auto-selected when the chat tab loads with no target chosen yet. Chat,
   * Pilot, Agenda, SEO recommendations, and parallel fan-out read it. Fresh
   * installs use the default-chat Mandate; users may explicitly pick an Agent
   * through Settings → Default agent.
   *
   * NEVER hardcode an agent UUID at a call site — read this setting instead.
   *
   * A concrete id here is an explicit user run target. The fresh-install
   * `mandate:*` reference is UI state only; aidream resolves its Holder
   * through the system/org/user Binding ladder at run time.
   */
  defaultAgentId: string | null;
  /** Fallback for the per-agent ask/act mode when an agent has no override. */
  defaultPermissionMode: PermissionMode;
  /** Composer speed default. NOT WIRED YET — placeholder UI only. */
  defaultChatSpeed: ChatSpeed;
  /**
   * Which agent-scope buckets the chat dropdown shows. Multi-select; defaults
   * to ['system'] so the browser Mandate's system-owned agent is visible.
   * Users may opt into their own or shared agents. Persisted across reloads.
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
  /**
   * Offer to save a login to the Vault when the user submits a password form
   * in a normal tab (src/lib/credentials/capture-detector.ts). The prompt is
   * always explicit — nothing is saved without a click. Signed-in users only:
   * the Vault rejects the guest identity, so the SW drops candidates when no
   * real user token exists. Default ON: this is the everyday password-manager
   * path; the toggle (and per-site "Never") make it reversible.
   */
  captureLoginsEnabled: boolean;

  // ─── Scrape auto-capture ───────────────────────────────────────────────
  /**
   * Auto-run a scrape on every page load (background). Gates useAutoScrape.
   * Off by default: a fresh install must not collect page content until the
   * user chooses a capture or explicitly enables background capture.
   */
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
  setCaptureLoginsEnabled: (b: boolean) => void;
  setScrapeAutoOnLoad: (b: boolean) => void;
  setScrapeAutoMode: (m: ScrapeAutoMode) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      theme: 'system',
      scrapeDeepClean: false,
      defaultAgentId: DEFAULT_CHAT_MANDATE_REF,
      defaultPermissionMode: 'ask',
      defaultChatSpeed: 'fast',
      agentScopes: ['system'],
      autoFullScrollOnFirstSubmit: false,
      modelOverrideId: null,
      sharePageIdentity: true,
      captureLoginsEnabled: true,
      scrapeAutoOnLoad: false,
      scrapeAutoMode: 'capture',
      setTheme: (theme) => set({ theme }),
      setScrapeDeepClean: (scrapeDeepClean) => set({ scrapeDeepClean }),
      setDefaultAgentId: (defaultAgentId) => set({ defaultAgentId }),
      setDefaultPermissionMode: (defaultPermissionMode) => set({ defaultPermissionMode }),
      setDefaultChatSpeed: (defaultChatSpeed) => set({ defaultChatSpeed }),
      setAgentScopes: (agentScopes) => {
        // Always keep at least one scope selected — empty = nothing visible
        // and the user gets stuck. Keep the default browser agent visible.
        set({ agentScopes: agentScopes.length === 0 ? ['system'] : agentScopes });
      },
      toggleAgentScope: (scope) =>
        set((s) => {
          const next = s.agentScopes.includes(scope)
            ? s.agentScopes.filter((x) => x !== scope)
            : [...s.agentScopes, scope];
          return { agentScopes: next.length === 0 ? ['system'] : next };
        }),
      setAutoFullScrollOnFirstSubmit: (autoFullScrollOnFirstSubmit) =>
        set({ autoFullScrollOnFirstSubmit }),
      setModelOverrideId: (modelOverrideId) => set({ modelOverrideId }),
      setSharePageIdentity: (sharePageIdentity) => set({ sharePageIdentity }),
      setCaptureLoginsEnabled: (captureLoginsEnabled) => set({ captureLoginsEnabled }),
      setScrapeAutoOnLoad: (scrapeAutoOnLoad) => set({ scrapeAutoOnLoad }),
      setScrapeAutoMode: (scrapeAutoMode) => set({ scrapeAutoMode }),
    }),
    {
      name: 'matrx.settings.v1',
      storage: createJSONStorage(() => chromeLocalStorage),
      // Bump when the schema changes in a way that needs rewriting old
      // persisted state.
      //   v2 → v3 (2026-08-17): fresh installs use the server-resolved
      //     `chat.default_new_chat` Mandate instead of a bundled agent UUID.
      //     Existing users keep an explicit saved agent selection.
      //   v3 → v4 (2026-08-20): untouched installs move to the browser-only
      //     `extend.browser_chat` Mandate and show the System agent scope.
      version: SETTINGS_PERSIST_VERSION,
      migrate: (persisted, fromVersion) => {
        const state = (persisted ?? {}) as Partial<SettingsState>;
        return migrateDefaultBrowserAgent(state, fromVersion) as SettingsState;
      },
    },
  ),
);
