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
