import { afterEach, describe, expect, it, vi } from 'vitest';
import { brokeredFetch } from '@/lib/broker/transport';

const cred = {
  credential_mode: 'proxied',
  audience: 'anthropic',
  endpoint: 'https://gw.test',
  token: 't',
} as never;

describe('broker relay initiation', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('sends x-matrx-initiation on the proxied call', async () => {
    const f = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', f);
    await brokeredFetch(cred, { body: {}, initiation: 'user' });
    expect(f.mock.calls[0]![1].headers['x-matrx-initiation']).toBe('user');
    await brokeredFetch(cred, { body: {}, initiation: 'auto' });
    expect(f.mock.calls[1]![1].headers['x-matrx-initiation']).toBe('auto');
  });
});
