import type { StateStorage } from 'zustand/middleware';

/**
 * Zustand persist storage adapter backed by chrome.storage.local.
 * Used by `persist(...)` middleware for stores that should survive reloads.
 *
 * Usage:
 *   import { persist, createJSONStorage } from 'zustand/middleware';
 *   import { chromeLocalStorage } from '@/lib/storage/zustand-adapter';
 *   create(persist(stateFn, { name: 'matrx.store.foo', storage: createJSONStorage(() => chromeLocalStorage) }))
 */
export const chromeLocalStorage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    const result = await chrome.storage.local.get([name]);
    const v = result[name];
    return typeof v === 'string' ? v : null;
  },
  setItem: async (name: string, value: string): Promise<void> => {
    await chrome.storage.local.set({ [name]: value });
  },
  removeItem: async (name: string): Promise<void> => {
    await chrome.storage.local.remove([name]);
  },
};

/**
 * Session-scoped variant — backed by chrome.storage.session (in-memory, cleared
 * on browser restart). Use for state that should survive a side-panel
 * close+reopen during the same browser session but NOT outlive the browser
 * itself. The right home for admin debug flags, ephemeral overrides, etc.
 */
export const chromeSessionStorage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    if (!chrome.storage.session) return null;
    const result = await chrome.storage.session.get([name]);
    const v = result[name];
    return typeof v === 'string' ? v : null;
  },
  setItem: async (name: string, value: string): Promise<void> => {
    if (!chrome.storage.session) return;
    await chrome.storage.session.set({ [name]: value });
  },
  removeItem: async (name: string): Promise<void> => {
    if (!chrome.storage.session) return;
    await chrome.storage.session.remove([name]);
  },
};
