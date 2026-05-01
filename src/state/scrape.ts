import type { CaptureError } from '@/lib/scrape/capture-error';
import type { SoupResult } from '@/lib/scrape/pipeline';
import { create } from 'zustand';

interface ScrapeState {
  current: SoupResult | null;
  loading: boolean;
  error: CaptureError | null;
  alreadyCapturedAt: string | null;
  setCurrent: (s: SoupResult | null) => void;
  setLoading: (b: boolean) => void;
  setError: (s: CaptureError | null) => void;
  setAlreadyCaptured: (s: string | null) => void;
}

export const useScrapeStore = create<ScrapeState>((set) => ({
  current: null,
  loading: false,
  error: null,
  alreadyCapturedAt: null,
  setCurrent: (current) => set({ current, error: null }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error, loading: false }),
  setAlreadyCaptured: (alreadyCapturedAt) => set({ alreadyCapturedAt }),
}));
