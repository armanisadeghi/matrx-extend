/**
 * Admin-only request-level flags.
 *
 * Maps directly to the optional fields on `AgentStartRequest` that aren't
 * exposed in the regular UI but admins occasionally need for debugging,
 * snapshot capture, or memory experimentation. Every flag here is
 * "unset / off" by default — values only get merged into the request when
 * the admin has explicitly toggled them on.
 *
 * Persistence: `chrome.storage.session` — survives a side-panel close +
 * reopen but is cleared when the browser restarts. Right scope for "I'm
 * debugging this morning" workflows; deliberately not chrome.storage.local
 * so a setting can't leak into tomorrow's normal use.
 *
 * Defense-in-depth: even though the UI gates this on `isAdmin`, the
 * dispatcher also strips these fields from the request body when the
 * user isn't an admin — so a stale store from a previous admin session
 * cannot bleed into a non-admin's request.
 */

import { chromeSessionStorage } from '@/lib/storage/zustand-adapter';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type MemoryScope = 'user' | 'project' | 'organization' | 'agent' | 'conversation';

/**
 * Each flag is `null` or `undefined` to mean "let server default apply" —
 * we only merge into the request body when the value is non-null.
 */
export interface AdminFlagsState {
  /** Verbose debug events in the SSE stream. */
  debug: boolean | null;
  /** Persist a conversation snapshot at the end of the run. */
  snapshot: boolean | null;
  /** Render in block mode (server returns structured blocks instead of text). */
  block_mode: boolean | null;
  /**
   * Track this run as a versioned re-execution of an existing turn (for diffing
   * model output across config tweaks). Defaults to off.
   */
  is_version: boolean | null;
  /**
   * Allow the server to create a new context bucket if one doesn't exist.
   * Default behavior is server-side; admins can force on/off here.
   */
  allow_context_create: boolean | null;
  /** Bypass model-response cache for this turn. JSON object — see CacheBypass schema on the server. */
  cache_bypass_json: string | null;
  /** Override agent loop iteration cap. */
  max_iterations: number | null;
  /** Override per-iteration retry cap. */
  max_retries_per_iteration: number | null;

  /** Memory: enable / disable the agent's memory layer for this run. */
  memory: boolean | null;
  /** Memory: override the memory model used. */
  memory_model: string | null;
  /** Memory: scope — 'user' / 'project' / 'organization' / 'agent' / 'conversation'. */
  memory_scope: MemoryScope | null;

  /** LLMParams override blob — JSON. Power-user. */
  config_overrides_json: string | null;

  // ─── mutators ───────────────────────────────────────────────────────────
  set: <K extends keyof AdminFlagsValues>(key: K, value: AdminFlagsValues[K]) => void;
  reset: () => void;
}

/** Just the value-bearing keys (no methods) — used in selectors + serialization. */
export type AdminFlagsValues = Omit<AdminFlagsState, 'set' | 'reset'>;

const DEFAULTS: AdminFlagsValues = {
  debug: null,
  snapshot: null,
  block_mode: null,
  is_version: null,
  allow_context_create: null,
  cache_bypass_json: null,
  max_iterations: null,
  max_retries_per_iteration: null,
  memory: null,
  memory_model: null,
  memory_scope: null,
  config_overrides_json: null,
};

export const useAdminFlagsStore = create<AdminFlagsState>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      set: (key, value) => set({ [key]: value } as Partial<AdminFlagsState>),
      reset: () => set({ ...DEFAULTS }),
    }),
    {
      name: 'matrx.admin-flags.v1',
      storage: createJSONStorage(() => chromeSessionStorage),
    },
  ),
);

/**
 * Project the store down to a request-body partial. Skips unset (null)
 * values so we never override a server default unless the admin asked for
 * it. Returns ONLY non-null fields so spreading into the request is safe.
 */
export function projectAdminFlagsToRequest(
  state: AdminFlagsValues,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (state.debug !== null) out.debug = state.debug;
  if (state.snapshot !== null) out.snapshot = state.snapshot;
  if (state.block_mode !== null) out.block_mode = state.block_mode;
  if (state.is_version !== null) out.is_version = state.is_version;
  if (state.allow_context_create !== null) out.allow_context_create = state.allow_context_create;
  if (state.max_iterations !== null) out.max_iterations = state.max_iterations;
  if (state.max_retries_per_iteration !== null) {
    out.max_retries_per_iteration = state.max_retries_per_iteration;
  }
  if (state.memory !== null) out.memory = state.memory;
  if (state.memory_model !== null) out.memory_model = state.memory_model;
  if (state.memory_scope !== null) out.memory_scope = state.memory_scope;
  if (state.cache_bypass_json !== null && state.cache_bypass_json.trim()) {
    try {
      out.cache_bypass = JSON.parse(state.cache_bypass_json);
    } catch {
      /* ignore — bad JSON is silently dropped, the UI shows a parse error */
    }
  }
  if (state.config_overrides_json !== null && state.config_overrides_json.trim()) {
    try {
      out.config_overrides = JSON.parse(state.config_overrides_json);
    } catch {
      /* ignore */
    }
  }
  return out;
}

/** Count of currently-active overrides — used by the UI to show "(N)". */
export function countActiveAdminFlags(state: AdminFlagsValues): number {
  let n = 0;
  for (const k of Object.keys(DEFAULTS) as (keyof AdminFlagsValues)[]) {
    if (state[k] !== null) {
      // For the JSON-string fields, count only when non-empty.
      if (k === 'cache_bypass_json' || k === 'config_overrides_json') {
        if (typeof state[k] === 'string' && (state[k] as string).trim()) n++;
      } else {
        n++;
      }
    }
  }
  return n;
}
