import { lookup } from '@/lib/tools/registry';
import { resolveToolTier } from '@/lib/tools/tier-policy';
import type { ToolTier } from '@/lib/tools/types';

export type LocalCommand =
  | { operation: 'navigate'; url: string }
  | { operation: 'inspect_login' }
  | { operation: 'vault_login'; [key: string]: unknown }
  | { operation: 'authenticator'; [key: string]: unknown };

export type PolicyResolution = { toolName: string; args: unknown; tier: ToolTier };

/** Parse the closed local operation through the registered handler before policy. */
export function resolveLocalCommandPolicy(
  command: LocalCommand,
  ownedTabId: number,
): PolicyResolution | null {
  const mapped = (() => {
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
        return { toolName: 'credential_login', args: { action: 'attempt', ...args } };
      }
      case 'authenticator': {
        const { operation: _operation, ...args } = command;
        return { toolName: 'credential_login', args: { action: 'authenticator', ...args } };
      }
    }
  })();
  if (!mapped) return null;
  const handler = lookup(mapped.toolName);
  if (!handler) return null;
  const parsed = handler.argsSchema.safeParse(mapped.args);
  return parsed.success
    ? { ...mapped, args: parsed.data, tier: resolveToolTier(handler, parsed.data) }
    : null;
}
