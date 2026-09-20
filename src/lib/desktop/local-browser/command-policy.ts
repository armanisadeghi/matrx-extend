import { lookup } from '@/lib/tools/registry';
import { resolveToolTier } from '@/lib/tools/tier-policy';
import type { ToolTier } from '@/lib/tools/types';
import { type LocalCommand, mapLocalCommandToHandler } from './command-mapping';

export { mapLocalCommandToHandler, type LocalCommand } from './command-mapping';

export type PolicyResolution = { toolName: string; args: unknown; tier: ToolTier };

/** Parse the closed local operation through the registered handler before policy. */
export function resolveLocalCommandPolicy(
  command: LocalCommand,
  ownedTabId: number,
): PolicyResolution | null {
  const mapped = mapLocalCommandToHandler(command, ownedTabId);
  if (!mapped) return null;
  const handler = lookup(mapped.toolName);
  if (!handler) return null;
  const parsed = handler.argsSchema.safeParse(mapped.args);
  return parsed.success
    ? { ...mapped, args: parsed.data, tier: resolveToolTier(handler, parsed.data) }
    : null;
}
