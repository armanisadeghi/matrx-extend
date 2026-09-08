import { DEFAULT_CHAT_MANDATE_REF } from '@/lib/mandates';

export const SETTINGS_PERSIST_VERSION = 5;
export const LEGACY_DEFAULT_CHAT_MANDATE_REF = 'mandate:chat.default_new_chat';

type MigratableSettings = {
  defaultAgentId?: string | null | undefined;
  /**
   * RETIRED in v5. The Mine/Shared/System scope pills were this repo's own
   * hand-rolled picker; @ai-matrx/agents/catalog owns tabs and filters now,
   * per consumer id. Named here only so the migration can DELETE it — a
   * retired key left in chrome.storage is dead data that outlives its reader.
   */
  agentScopes?: string[] | undefined;
};

/**
 * canonical-agent-picker-exempt: this file DELETES the retired `agentScopes`
 * key from persisted settings, so it must name it. It builds no agent list.
 *
 * v3 → v4: move users who never chose an agent onto the browser-specific
 * Mandate. Explicit user selections are never rewritten.
 * v4 → v5: drop the retired `agentScopes` key.
 */
export function migrateDefaultBrowserAgent<T extends MigratableSettings>(
  persisted: T,
  fromVersion: number,
): T {
  if (fromVersion >= SETTINGS_PERSIST_VERSION) return persisted;

  const { agentScopes: _retired, ...rest } = persisted;
  const next = rest as T;

  const hasUnmodifiedDefault =
    next.defaultAgentId === null ||
    next.defaultAgentId === undefined ||
    next.defaultAgentId === LEGACY_DEFAULT_CHAT_MANDATE_REF;

  if (!hasUnmodifiedDefault) return next;

  return { ...next, defaultAgentId: DEFAULT_CHAT_MANDATE_REF };
}
