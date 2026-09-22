export type LocalCommand =
  | { operation: 'navigate'; url: string }
  | { operation: 'inspect_login' }
  | { operation: 'vault_login'; [key: string]: unknown }
  | { operation: 'authenticator'; [key: string]: unknown };

/** The one closed adapter from wire operations to registered handler input. */
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
      const {
        operation: _operation,
        verification_spec_json: _spec,
        verification_digest: _digest,
        ...args
      } = command;
      if ('action' in args) return null;
      return { toolName: 'credential_login', args: { ...args, action: 'attempt' } };
    }
    case 'authenticator': {
      const {
        operation: _operation,
        verification_spec_json: _spec,
        verification_digest: _digest,
        ...args
      } = command;
      if ('action' in args) return null;
      return { toolName: 'credential_login', args: { ...args, action: 'authenticator' } };
    }
  }
}
