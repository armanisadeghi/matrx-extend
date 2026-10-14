import type { AnyToolHandler, ToolTier } from '@/lib/tools/types';

/** Resolve the registered handler policy after its argument schema has parsed. */
export function resolveToolTier(handler: AnyToolHandler, parsedArgs: unknown): ToolTier {
  return handler.tierFor ? handler.tierFor(parsedArgs) : handler.tier;
}

/**
 * THE ONE answer to "may this run act without asking?" for a delegated tool call.
 *
 * "Act without asking" is the person's choice (per agent, latched at send time). When it is on,
 * NOTHING waits for the person — read, action and privileged tools all run. The only thing that
 * ever waits is the agent itself asking the person a question (the `ask-user` tier / the `user`
 * tool), which is the agent's own request and never an approval gate.
 *
 * Callers that are not the person's own agent (an arbitrary web page driving WebMCP) are not
 * "a run" and keep their approval: pass `initiator: 'page'`.
 */
export function mayActWithoutAsking(
  mode: 'ask' | 'act' | undefined,
  initiator: 'agent' | 'page' | 'frontend' | 'desktop' | 'extension' = 'agent',
): boolean {
  return mode === 'act' && initiator !== 'page';
}

/** Does a call of this effective tier wait for the person's approval? */
export function needsApproval(
  tier: ToolTier,
  mode: 'ask' | 'act' | undefined,
  initiator: 'agent' | 'page' | 'frontend' | 'desktop' | 'extension' = 'agent',
): boolean {
  if (tier === 'ask-user') return false; // the handler itself asks; not an approval gate
  if (mayActWithoutAsking(mode, initiator)) return false;
  return tier === 'privileged' || tier === 'action';
}
