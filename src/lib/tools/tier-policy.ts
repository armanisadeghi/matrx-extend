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

/**
 * The organization's choice for privileged and ask-user tools a DESKTOP app calls (Matrx 2 and
 * Matrx Local's general channel — `initiator: 'desktop'`). Knob
 * `extension.desktop_callers.privileged_tools` (`./desktop-caller-policy.ts`):
 * - `ask` (default, and whenever the knob is absent or unreadable): the person is asked first,
 *   then the tool runs — in every mode;
 * - `follow_act_without_asking`: runs without asking when the person has "Act without asking" on,
 *   and asks when it is off.
 */
export type DesktopPrivilegedPolicy = 'ask' | 'follow_act_without_asking';
export const DEFAULT_DESKTOP_PRIVILEGED_POLICY: DesktopPrivilegedPolicy = 'ask';

/** What an outside caller's (page / frontend / desktop) call of this effective tier does. */
export type ExternalCallDecision = 'run' | 'ask' | 'refuse';

/**
 * THE rule for a call that does not come from the person's own agent (`handleWebmcpCall`).
 * - read: runs.
 * - action: runs when "Act without asking" applies to this caller, otherwise asks.
 * - privileged / ask-user: a desktop app's call asks the person first (or, when the organization
 *   chose `follow_act_without_asking` and the person's Act mode is on, runs); a web page's or the
 *   web app's call is refused.
 */
export function externalCallDecision(
  tier: ToolTier,
  mode: 'ask' | 'act' | undefined,
  initiator: 'agent' | 'page' | 'frontend' | 'desktop' | 'extension',
  desktopPolicy: DesktopPrivilegedPolicy = DEFAULT_DESKTOP_PRIVILEGED_POLICY,
): ExternalCallDecision {
  if (tier === 'read') return 'run';
  if (tier === 'action') return mayActWithoutAsking(mode, initiator) ? 'run' : 'ask';
  if (initiator !== 'desktop') return 'refuse';
  return desktopPolicy === 'follow_act_without_asking' && mode === 'act' ? 'run' : 'ask';
}
