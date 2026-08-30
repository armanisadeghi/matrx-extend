import { DEFAULT_CHAT_MANDATE_REF } from '@/lib/mandates';

export const SETTINGS_PERSIST_VERSION = 4;
export const LEGACY_DEFAULT_CHAT_MANDATE_REF = 'mandate:chat.default_new_chat';

type MigratableSettings = {
  defaultAgentId?: string | null | undefined;
  agentScopes?: string[] | undefined;
};

/**
 * Move users who never chose an agent onto the browser-specific Mandate and
 * make its system-owned resolved agent visible in the selector.
 * Explicit user selections are never rewritten.
 */
export function migrateDefaultBrowserAgent<T extends MigratableSettings>(
  persisted: T,
  fromVersion: number,
): T {
  if (fromVersion >= SETTINGS_PERSIST_VERSION) return persisted;

  const hasUnmodifiedDefault =
    persisted.defaultAgentId === null ||
    persisted.defaultAgentId === undefined ||
    persisted.defaultAgentId === LEGACY_DEFAULT_CHAT_MANDATE_REF;

  if (!hasUnmodifiedDefault) return persisted;

  return {
    ...persisted,
    defaultAgentId: DEFAULT_CHAT_MANDATE_REF,
    agentScopes: ['system'],
  };
}
