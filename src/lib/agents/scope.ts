/**
 * Agent-scope classification for the chat-tab dropdown filter.
 *
 * Three buckets, derived from the `agx_get_list_full` RPC fields the
 * agent already carries:
 *
 *   mine    — `is_owner === true` (the current user owns this agent).
 *   shared  — someone else granted access to the user (`shared_by_email`
 *             is set, or `is_owner === false` with a non-null `user_id`
 *             that isn't ours).
 *   system  — built-in / org-default agents that aren't tied to a human
 *             owner. `is_owner === false` and `shared_by_email === null`.
 *
 * These are heuristics over RLS-filtered data — every row the user gets
 * back from the RPC is something they already have access to. The
 * classifier just routes the row into the right pill.
 */

import type { AgxAgent } from '@/lib/supabase/queries';

export type AgentScope = 'mine' | 'shared' | 'system';

export const ALL_SCOPES: AgentScope[] = ['mine', 'shared', 'system'];

export const SCOPE_LABEL: Record<AgentScope, string> = {
  mine: 'Mine',
  shared: 'Shared',
  system: 'System',
};

export const SCOPE_DESCRIPTION: Record<AgentScope, string> = {
  mine: 'Agents you own.',
  shared: 'Agents others granted access to.',
  system: 'Built-in / organization-default agents.',
};

export function scopeOf(agent: AgxAgent): AgentScope {
  if (agent.is_owner === true) return 'mine';
  if (agent.shared_by_email != null && agent.shared_by_email.length > 0) return 'shared';
  // Fallback: explicit access_level signals shared.
  if (typeof agent.access_level === 'string' && /shared/i.test(agent.access_level)) {
    return 'shared';
  }
  return 'system';
}

export function filterAgentsByScope(
  agents: AgxAgent[],
  enabled: Set<AgentScope> | AgentScope[],
): AgxAgent[] {
  const set = enabled instanceof Set ? enabled : new Set(enabled);
  if (set.size === 0) return [];
  if (set.size === ALL_SCOPES.length) return agents;
  return agents.filter((a) => set.has(scopeOf(a)));
}

export function countByScope(agents: AgxAgent[]): Record<AgentScope, number> {
  const counts: Record<AgentScope, number> = { mine: 0, shared: 0, system: 0 };
  for (const a of agents) counts[scopeOf(a)]++;
  return counts;
}
