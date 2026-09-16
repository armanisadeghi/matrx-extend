import { describe, expect, it, vi } from 'vitest';

describe('native messaging during extension reload', () => {
  it('still fans out locally when the runtime context has already been invalidated', async () => {
    vi.resetModules();
    const received: number[] = [];
    vi.stubGlobal('chrome', {
      runtime: {
        onMessage: {
          addListener: vi.fn(),
          removeListener: vi.fn(),
        },
        sendMessage: vi.fn(() => {
          throw new Error('Extension context invalidated.');
        }),
      },
    });

    const { broadcast, on } = await import('@/lib/messaging/native');
    on<{ value: number }, void>('lifecycle:test', (payload) => {
      received.push(payload.value);
    });

    expect(() => broadcast('lifecycle:test', { value: 7 })).not.toThrow();
    expect(() => broadcast('lifecycle:test', { value: 11 })).not.toThrow();
    expect(received).toEqual([7, 11]);
  });
});
