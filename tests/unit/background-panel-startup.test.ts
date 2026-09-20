import { describe, expect, it, vi } from 'vitest';

const background = vi.hoisted(() => ({ main: null as (() => void) | null }));
const bootstrap = vi.hoisted(() => vi.fn());

vi.mock('wxt/utils/define-background', () => ({
  defineBackground: (definition: { main: () => void }) => {
    background.main = definition.main;
    return definition;
  },
}));
vi.mock('@/lib/background/bootstrap', () => ({ bootstrapBackground: bootstrap }));

describe('background panel startup', () => {
  it('still bootstraps listeners when Chromium sidePanel is absent', async () => {
    globalThis.chrome = { runtime: { id: 'test-extension' } } as typeof chrome;
    const addEventListener = vi.spyOn(self, 'addEventListener');
    await import('@/entrypoints/background');

    expect(background.main).not.toBeNull();
    expect(() => background.main?.()).not.toThrow();
    expect(bootstrap).toHaveBeenCalledOnce();
    expect(addEventListener).toHaveBeenCalledWith('unhandledrejection', expect.any(Function));
    addEventListener.mockRestore();
  });
});
