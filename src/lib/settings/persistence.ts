import { chromeLocalStorage } from '@/lib/storage/zustand-adapter';
import { useSyncExternalStore } from 'react';
import type { StateStorage } from 'zustand/middleware';

export const SETTINGS_STORAGE_KEY = 'matrx.settings.v1';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';
let saveState: SaveState = 'idle';
let latestValue: string | null = null;
let revision = 0;
let pending = Promise.resolve();
const listeners = new Set<() => void>();

function publish(next: SaveState) {
  saveState = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot() {
  return saveState;
}

export function useSettingsSaveState(): SaveState {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

function write(name: string, value: string): Promise<void> {
  latestValue = value;
  const ownRevision = ++revision;
  publish('saving');
  const result = pending.then(() => chromeLocalStorage.setItem(name, value));
  // Zustand persist does not observe the async result of a synchronous setter.
  // Consume rejection here and keep the latest failed snapshot available for retry.
  pending = result.then(
    () => {
      if (ownRevision === revision) publish('saved');
    },
    () => {
      if (ownRevision === revision) publish('error');
    },
  );
  return pending;
}

export const settingsStorage: StateStorage = {
  getItem: (name) => chromeLocalStorage.getItem(name),
  setItem: write,
  removeItem: (name) => chromeLocalStorage.removeItem(name),
};

export function retrySettingsSave(): Promise<void> {
  if (latestValue === null) return Promise.resolve();
  return write(SETTINGS_STORAGE_KEY, latestValue);
}
