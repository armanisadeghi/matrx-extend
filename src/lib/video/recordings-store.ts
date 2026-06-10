/**
 * In-memory + chrome.storage.local-backed list of completed video recordings.
 *
 * Stores metadata only (file_id, url, duration, mime, captured tab title).
 * The actual bytes live in cld_files; this store is just so the Tools tab
 * Recorder pane can show the user "what did I just capture" with quick-play
 * links across sidepanel reloads.
 */

import { log } from '@/lib/debug/log';
import { create } from 'zustand';

const STORAGE_KEY = 'matrx.recordings.v1';
const MAX_ENTRIES = 50;

export interface RecordingEntry {
  /** Locally generated id — corresponds to the offscreen session id. */
  id: string;
  /** ISO timestamp the recording finished. */
  capturedAt: string;
  /** Tab title at the time of capture, when available. */
  tabTitle: string | null;
  /** Tab url at the time of capture, when available. */
  tabUrl: string | null;
  /** cld_files file id (canonical reference for the agent + UI). */
  fileId: string;
  /** Resolved CDN / signed URL when the upload step returned one. May be null. */
  fileUrl: string | null;
  durationMs: number;
  sizeBytes: number;
  mimeType: string;
  audio: boolean;
  /** 'tab' | 'display' — which capture path produced this. */
  source: 'tab' | 'display';
}

interface RecordingsState {
  entries: RecordingEntry[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  add: (entry: RecordingEntry) => Promise<void>;
  remove: (id: string) => Promise<void>;
  clear: () => Promise<void>;
}

async function persist(entries: RecordingEntry[]): Promise<void> {
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: entries.slice(0, MAX_ENTRIES) });
  } catch (err) {
    log.warn('sys', 'recordings-store: persist failed', err);
  }
}

export const useRecordingsStore = create<RecordingsState>((set, get) => ({
  entries: [],
  hydrated: false,
  hydrate: async () => {
    if (get().hydrated) return;
    try {
      const got = await chrome.storage.local.get(STORAGE_KEY);
      const arr = (got[STORAGE_KEY] as RecordingEntry[] | undefined) ?? [];
      set({ entries: Array.isArray(arr) ? arr : [], hydrated: true });
    } catch (err) {
      log.warn('sys', 'recordings-store: hydrate failed', err);
      set({ entries: [], hydrated: true });
    }
  },
  add: async (entry) => {
    const next = [entry, ...get().entries].slice(0, MAX_ENTRIES);
    set({ entries: next });
    await persist(next);
  },
  remove: async (id) => {
    const next = get().entries.filter((e) => e.id !== id);
    set({ entries: next });
    await persist(next);
  },
  clear: async () => {
    set({ entries: [] });
    await persist([]);
  },
}));
