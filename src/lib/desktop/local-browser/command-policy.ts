import { lookup } from '@/lib/tools/registry';
import { resolveToolTier } from '@/lib/tools/tier-policy';
import type { ToolTier } from '@/lib/tools/types';

export type LocalCommand =
  | { operation: 'navigate'; url: string }
  | { operation: 'inspect_login' }
  | { operation: 'vault_login'; [key: string]: unknown }
  | { operation: 'authenticator'; [key: string]: unknown };

export type PolicyResolution = { toolName: string; args: unknown; tier: ToolTier };

/**
 * The one closed adapter from the wire operation to registered-handler input.
 * Execution and approval both consume it so a wire `operation` never reaches
 * strict credential handler schemas.
 */
export function mapLocalCommandToHandler(
  command: LocalCommand,
  ownedTabId: number,
): { toolName: string; args: unknown } | null {
  switch (command.operation) {
    case 'navigate':
      return {
        toolName: 'navigate',
        args: { tab_id: String(ownedTabId), url: command.url, force: false },
      };
    case 'inspect_login':
      return { toolName: 'credential_login', args: { action: 'discover' } };
    case 'vault_login': {
      const { operation: _operation, ...args } = command;
      if ('action' in args) return null;
      return { toolName: 'credential_login', args: { ...args, action: 'attempt' } };
    }
    case 'authenticator': {
      const { operation: _operation, ...args } = command;
      if ('action' in args) return null;
      return { toolName: 'credential_login', args: { ...args, action: 'authenticator' } };
    }
  }
}

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
