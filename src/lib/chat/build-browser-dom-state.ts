/**
 * Build the `client.state["browser-dom"]` payload the server-side
 * `browser-dom` capability + `load_browser_tools` discovery handler needs
 * to route which tools to register for this turn.
 *
 * Distinct from `buildChatContext`:
 *   - `buildChatContext` returns ~50 keys of MODEL-FACING facts about the
 *     active page (markdown, images, SEO, structured data). Big, rich.
 *   - `build-browser-dom-state` returns ~12 keys of ORCHESTRATION metadata
 *     (current_url, is_admin, desktop_bridge, granted-perm list). Small,
 *     structured.
 *
 * Both ride on the same request — context as `context`, state as
 * `client.state["browser-dom"]`. They are read by different code paths
 * server-side.
 *
 * Source of truth for the schema: aidream's capability registration in the
 * Python `matrx-ai` runtime. Keep this TypeScript shape in sync with the
 * server's expected payload model. See
 * docs/MATRX_EXTEND_MIGRATION_GUIDE.md for the post-redesign source-of-truth
 * flow.
 */

import { getAccessToken } from '@/lib/auth/flow';
import { ALL_OPTIONAL, hasOptionalPermissions } from '@/lib/permissions/optional';
import { useAuthStore } from '@/state/auth';
import { useChatStore } from '@/state/chat';
import { useDesktopStore } from '@/state/desktop';

export interface BrowserDomState {
  current_url: string | null;
  current_tab_id: number | null;
  current_window_id: number | null;
  page_title: string | null;
  page_lang: string | null;
  tab_status: 'loading' | 'complete' | null;
  surface: 'assistant' | 'pilot';
  is_admin: boolean;
  /**
   * True when the caller is unauthenticated and the request is going up
   * with X-Fingerprint-ID. The server's auth middleware also derives this
   * from ctx.auth_type='fingerprint', so this field is redundant for
   * routing — it's here so the discovery handler can branch without
   * re-reading the AppContext.
   */
  is_guest: boolean;
  permission_mode: 'ask' | 'act';
  desktop_bridge: 'native' | 'http' | 'none';
  onbox_ai_available: boolean;
  optional_permissions_granted: string[];
  open_tab_count: number | null;
  extension_version: string;
  extension_id: string;
  loaded_categories: string[];
  /**
   * The compute-target kind currently bound to this chat session, if any.
   * Lets the server-side discovery handler / analytics see which surface's
   * picker drove the binding. Mirrors the `sandbox` top-level request
   * field but in a discoverable, kind-only shape (no token / URL).
   */
  bound_compute_target_kind: 'ec2' | 'hosted' | 'local-pc' | null;
  /** Row id of the bound target — `sandbox_instances.id` or `app_instances.id`. */
  bound_compute_target_id: string | null;
}

export interface BuildBrowserDomStateOpts {
  /** Which surface initiated the request — drives default category visibility on the server. */
  surface: 'assistant' | 'pilot';
  /** Agent id, for per-agent permissionMode lookup. */
  agentId?: string;
  /** Categories the agent has discovered earlier in this conversation. */
  loadedCategories?: string[];
  /**
   * Caller-resolved active tab. When provided, the builder skips its own
   * `chrome.tabs.query` so this state and the `context` body reference
   * the SAME Tab. The chat path always passes this — only legacy
   * callers should rely on the internal fallback query. See
   * docs/REQUEST_PAYLOAD_CONTRACT.md §1.
   */
  activeTab?: chrome.tabs.Tab | null;
  /**
   * Caller-resolved page language (`document.documentElement.lang`).
   * When provided, the builder skips its own `executeScript` round
   * trip — the chat path pulls this from `context.page_brief.lang`
   * after building the context, so the two payloads agree without
   * double-fetching.
   */
  pageLang?: string | null;
}

async function detectOnboxAi(): Promise<boolean> {
  try {
    // Lightweight check — just look for any of the known global hooks.
    // The full availability probe is the agent's `ai_check_availability`
    // tool; we just need a yes/no signal here for routing.
    const g = globalThis as unknown as Record<string, unknown>;
    if (typeof g.LanguageModel !== 'undefined') return true;
    if (typeof g.ai === 'object' && g.ai !== null) return true;
    return false;
  } catch {
    return false;
  }
}

async function queryActiveTab(): Promise<{
  id: number | null;
  windowId: number | null;
  url: string | null;
  title: string | null;
  status: 'loading' | 'complete' | null;
}> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return {
      id: tab?.id ?? null,
      windowId: tab?.windowId ?? null,
      url: tab?.url ?? null,
      title: tab?.title ?? null,
      status: (tab?.status as 'loading' | 'complete' | undefined) ?? null,
    };
  } catch {
    return { id: null, windowId: null, url: null, title: null, status: null };
  }
}

async function listGrantedOptional(): Promise<string[]> {
  const granted: string[] = [];
  for (const p of ALL_OPTIONAL) {
    if (await hasOptionalPermissions([p])) granted.push(p);
  }
  return granted;
}

async function pageLangFor(tabId: number | null): Promise<string | null> {
  if (tabId == null) return null;
  try {
    const [first] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => document.documentElement.lang || null,
    });
    return (first?.result as string | null) ?? null;
  } catch {
    return null;
  }
}

async function countOpenTabs(): Promise<number | null> {
  try {
    const tabs = await chrome.tabs.query({});
    return tabs.length;
  } catch {
    return null;
  }
}

export async function buildBrowserDomState(
  opts: BuildBrowserDomStateOpts,
): Promise<BrowserDomState> {
  const auth = useAuthStore.getState();
  const desktop = useDesktopStore.getState();
  // Use the caller-resolved tab when present; only fall back to our own
  // query for legacy callers that passed nothing at all. An EXPLICIT null
  // means resolveActiveTab() found no tab — re-querying here (while
  // buildChatContext independently re-queried too) is the cross-tab race
  // the single-resolve convention prevents (audit P2-13).
  const tab = opts.activeTab
    ? {
        id: opts.activeTab.id ?? null,
        windowId: opts.activeTab.windowId ?? null,
        url: opts.activeTab.url ?? null,
        title: opts.activeTab.title ?? null,
        status: (opts.activeTab.status as 'loading' | 'complete' | undefined) ?? null,
      }
    : opts.activeTab === null
      ? { id: null, windowId: null, url: null, title: null, status: null }
      : await queryActiveTab();
  // Same story for page_lang — when context was already built, the chat
  // hook hands us `page_brief.lang` and we skip the extra executeScript.
  const langPromise =
    opts.pageLang !== undefined ? Promise.resolve(opts.pageLang) : pageLangFor(tab.id);
  const [granted, lang, openTabCount, onboxAi, accessToken] = await Promise.all([
    listGrantedOptional(),
    langPromise,
    countOpenTabs(),
    detectOnboxAi(),
    getAccessToken(),
  ]);
  const permissionMode = useChatStore.getState().getPermissionMode(opts.agentId ?? null);
  const boundTarget = useChatStore.getState().boundComputeTarget;
  return {
    current_url: tab.url,
    current_tab_id: tab.id,
    current_window_id: tab.windowId,
    page_title: tab.title,
    page_lang: lang,
    tab_status: tab.status,
    surface: opts.surface,
    is_admin: auth.isAdmin,
    is_guest: !accessToken,
    permission_mode: permissionMode,
    desktop_bridge: desktop.transport,
    onbox_ai_available: onboxAi,
    optional_permissions_granted: granted,
    open_tab_count: openTabCount,
    extension_version: chrome.runtime.getManifest().version,
    extension_id: chrome.runtime.id,
    loaded_categories: opts.loadedCategories ?? [],
    bound_compute_target_kind: boundTarget?.kind ?? null,
    bound_compute_target_id: boundTarget?.id ?? null,
  };
}
