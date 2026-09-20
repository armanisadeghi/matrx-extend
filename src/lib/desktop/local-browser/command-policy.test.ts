import { lookup } from '@/lib/tools/registry';
import { describe, expect, it } from 'vitest';
import { resolveLocalCommandPolicy } from './command-policy';

describe('resolveLocalCommandPolicy', () => {
  it('uses the real registered navigate schema and exact owned-tab mapping', () => {
    const result = resolveLocalCommandPolicy(
      { operation: 'navigate', url: 'https://example.com/login' },
      91,
    );
    expect(result).toMatchObject({
      toolName: 'navigate',
      tier: 'action',
      args: { tab_id: '91', url: 'https://example.com/login', force: false },
    });
  });

  it('retains discover as credential_login action rather than inventing a read tier', () => {
    expect(resolveLocalCommandPolicy({ operation: 'inspect_login' }, 1)).toMatchObject({
      toolName: 'credential_login',
      tier: 'action',
      args: { action: 'discover' },
    });
  });

  it('inherits the registry tierFor result for authenticator', () => {
    const result = resolveLocalCommandPolicy(
      {
        operation: 'authenticator',
        credential_item_id: '00000000-0000-4000-8000-000000000001',
        code_selector: '#code',
        submit: { kind: 'none' },
      },
      1,
    );
    expect(result?.tier).toBe('privileged');
  });

  it.each(['attempt', 'discover'])('refuses forged authenticator action %s', (action) => {
    expect(resolveLocalCommandPolicy({
      operation: 'authenticator', action,
      credential_item_id: '00000000-0000-4000-8000-000000000001',
      code_selector: '#code', submit: { kind: 'none' },
    } as never, 1)).toBeNull();
  });

  it('refuses schema-invalid commands before policy', () => {
    expect(resolveLocalCommandPolicy({ operation: 'navigate', url: 3 } as never, 1)).toBeNull();
  });

  it('returns null when the registry does not expose the mapped handler', () => {
    const handler = lookup('navigate');
    expect(handler).toBeDefined();
    // The mapping itself remains closed: no arbitrary operation can select a handler.
    expect(resolveLocalCommandPolicy({ operation: 'unknown' } as never, 1)).toBeNull();
  });
});
