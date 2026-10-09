import { useSettingsStore } from '@/state/settings';
/**
 * Which chat the side panel shows: the person's saved Settings choice (default: the extension's own
 * chat), or the `?chat=package` developer override.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { isPackageChatMode } from './chat-target';

afterEach(() => {
  useSettingsStore.getState().setChatSurface('default');
  window.history.replaceState({}, '', '/');
});

describe('isPackageChatMode', () => {
  it('is off for a person who never chose the new chat', () => {
    expect(useSettingsStore.getState().chatSurface).toBe('default');
    expect(isPackageChatMode()).toBe(false);
  });

  it('follows the saved Settings choice', () => {
    useSettingsStore.getState().setChatSurface('package');
    expect(isPackageChatMode()).toBe(true);
  });

  it('still honours the ?chat=package override', () => {
    window.history.replaceState({}, '', '/?chat=package');
    expect(isPackageChatMode()).toBe(true);
  });
});
