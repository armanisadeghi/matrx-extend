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
    await import('@/entrypoints/background');

    expect(background.main).not.toBeNull();
    expect(() => background.main?.()).not.toThrow();
    expect(bootstrap).toHaveBeenCalledOnce();
    // Worker errors must remain observable, including the import failures that
    // were previously hidden by a blanket DOM-global rejection suppressor.
    for (const reason of [
      new ReferenceError('window is not defined'),
      new ReferenceError('document is not defined'),
      new Error('Network capture failed'),
    ]) {
      const event = new Event('unhandledrejection', { cancelable: true });
      Object.defineProperty(event, 'reason', { value: reason });
      expect(self.dispatchEvent(event)).toBe(true);
      expect(event.defaultPrevented).toBe(false);
    }
  });
});
