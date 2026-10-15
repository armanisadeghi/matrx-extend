/**
 * ONE PLACE NAMES THE LISTS CHANNELS.
 *
 * supabase-js dedupes channels by topic, so two features that both picked
 * `"lists"` would silently share one channel and lose each other's bindings.
 * `@ai-matrx/data/realtime` closes that off with declared namespaces — a second,
 * DIFFERENT declaration of the same name throws — which only works if the
 * declaration lives in one module both consumers import. Both lists surfaces
 * (`ListsHubView` and `useListsSubscriber`) watch the same table, so this is
 * that module.
 *
 * These are Postgres Changes channels, so the declared topic is only a
 * client-side connection key: the package mints a unique instance topic per
 * connection and the server pushes on the declared filter regardless. That is
 * also what makes a React 19 remount safe here without the hand-rolled
 * `crypto.randomUUID()` suffix this repo used to append itself.
 */

import { defineChannelNamespace } from '@ai-matrx/data/realtime';

/** Every `chat.agent_task` row the signed-in user can see (RLS gates delivery). */
export const listsAllTasksChannel = defineChannelNamespace({
  namespace: 'extend-lists-tasks-all',
  parts: [],
  description: 'chat.agent_task rows across every conversation (extension lists hub)',
});

/** `chat.agent_task` rows for ONE conversation. */
export const listsConversationTasksChannel = defineChannelNamespace({
  namespace: 'extend-lists-tasks-conversation',
  parts: ['conversationId'],
  description: 'chat.agent_task rows for one conversation (extension lists)',
});

/** Fully-qualified table name — the write ledger keys on it. */
export const AGENT_TASK_TABLE = 'chat.agent_task';

/**
 * The content fingerprint the ledger compares an incoming row against. It must
 * cover every column a local write can change, or our own echo reads as a
 * divergent remote write and the surface refetches for nothing.
 */
export function agentTaskFingerprint(row: Record<string, unknown>): string {
  return [row.title, row.status, row.note, row.position].map((v) => String(v ?? '')).join('\u0000');
}
