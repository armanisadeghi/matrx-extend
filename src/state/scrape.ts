import type { CaptureError } from '@/lib/scrape/capture-error';
import type { DiagnoseMode, DiagnoseResult } from '@/lib/scrape/diagnose-bundle';
import type { SoupResult } from '@/lib/scrape/pipeline';
import { create } from 'zustand';

interface ScrapeState {
  current: SoupResult | null;
  loading: boolean;
  error: CaptureError | null;
  alreadyCapturedAt: string | null;
  /**
   * True after any local edit (article body, lists, etc.). Cleared by
   * `setCurrent` (re-capture replaces everything) or `markSaved` (the
   * persisted row now matches the in-memory state). Used to:
   *   - Show an "edited" badge near the title.
   *   - Warn the user if they hit Re-capture with unsaved edits.
   */
  edited: boolean;
  /**
   * Diagnose-picker state. `picking` flips while the in-page overlay is
   * active; `lastResult` holds the most recent successful pick so the side
   * panel can render the DiagnoseCard until the user dismisses it.
   * `draftNote` persists the textarea content so re-opening the panel keeps
   * the user's thought-in-progress.
   */
  diagnose: {
    mode: DiagnoseMode;
    picking: boolean;
    lastResult: DiagnoseResult | null;
    draftNote: string;
  };
  setCurrent: (s: SoupResult | null) => void;
  setLoading: (b: boolean) => void;
  setError: (s: CaptureError | null) => void;
  setAlreadyCaptured: (s: string | null) => void;
  setDiagnoseMode: (mode: DiagnoseMode) => void;
  setDiagnosePicking: (picking: boolean) => void;
  setDiagnoseResult: (result: DiagnoseResult | null) => void;
  setDiagnoseDraftNote: (note: string) => void;
  clearDiagnose: () => void;

  // Edits — every mutator flips `edited` to true. Applied to in-memory
  // `current` only; persistence happens through the existing `save()` flow.
  editArticleMarkdown: (markdown: string) => void;
  editArticleTitle: (title: string) => void;
  removeImage: (src: string) => void;
  addImage: (image: { src: string; alt?: string | null }) => void;
  removeVideo: (src: string) => void;
  addVideo: (video: { src: string; poster?: string | null }) => void;
  removeLink: (key: string) => void;
  addLink: (link: { href: string; text?: string }) => void;
  markSaved: () => void;
}

const linkKey = (href: string, text: string) => `${href}|${text}`;

export const useScrapeStore = create<ScrapeState>((set) => ({
  current: null,
  loading: false,
  error: null,
  alreadyCapturedAt: null,
  edited: false,
  diagnose: {
    mode: 'missing',
    picking: false,
    lastResult: null,
    draftNote: '',
  },
  setCurrent: (current) => set({ current, error: null, edited: false }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error, loading: false }),
  setAlreadyCaptured: (alreadyCapturedAt) => set({ alreadyCapturedAt }),
  markSaved: () => set({ edited: false }),

  setDiagnoseMode: (mode) =>
    set((s) => ({ diagnose: { ...s.diagnose, mode } })),
  setDiagnosePicking: (picking) =>
    set((s) => ({ diagnose: { ...s.diagnose, picking } })),
  setDiagnoseResult: (lastResult) =>
    set((s) => ({
      diagnose: { ...s.diagnose, lastResult, picking: false },
    })),
  setDiagnoseDraftNote: (draftNote) =>
    set((s) => ({ diagnose: { ...s.diagnose, draftNote } })),
  clearDiagnose: () =>
    set((s) => ({
      diagnose: { ...s.diagnose, lastResult: null, draftNote: '', picking: false },
    })),

  editArticleMarkdown: (markdown) =>
    set((s) => {
      if (!s.current) return s;
      const wc = markdown.split(/\s+/).filter(Boolean).length || null;
      return {
        edited: true,
        current: {
          ...s.current,
          article: {
            ...s.current.article,
            content_markdown: markdown,
            word_count: wc,
            reading_time_minutes: wc ? Math.max(1, Math.round(wc / 220)) : null,
          },
        },
      };
    }),

  editArticleTitle: (title) =>
    set((s) => {
      if (!s.current) return s;
      return {
        edited: true,
        current: { ...s.current, article: { ...s.current.article, title } },
      };
    }),

  removeImage: (src) =>
    set((s) => {
      if (!s.current) return s;
      return {
        edited: true,
        current: { ...s.current, images: s.current.images.filter((i) => i.src !== src) },
      };
    }),

  addImage: ({ src, alt }) =>
    set((s) => {
      if (!s.current) return s;
      const exists = s.current.images.some((i) => i.src === src);
      if (exists) return s;
      return {
        edited: true,
        current: {
          ...s.current,
          images: [...s.current.images, { src, alt: alt ?? null, width: null, height: null }],
        },
      };
    }),

  removeVideo: (src) =>
    set((s) => {
      if (!s.current) return s;
      return {
        edited: true,
        current: { ...s.current, videos: s.current.videos.filter((v) => v.src !== src) },
      };
    }),

  addVideo: ({ src, poster }) =>
    set((s) => {
      if (!s.current) return s;
      const exists = s.current.videos.some((v) => v.src === src);
      if (exists) return s;
      return {
        edited: true,
        current: {
          ...s.current,
          videos: [...s.current.videos, { src, poster: poster ?? null, duration: null }],
        },
      };
    }),

  removeLink: (key) =>
    set((s) => {
      if (!s.current) return s;
      return {
        edited: true,
        current: {
          ...s.current,
          links: s.current.links.filter((l) => linkKey(l.href, l.text) !== key),
        },
      };
    }),

  addLink: ({ href, text }) =>
    set((s) => {
      if (!s.current) return s;
      const t = text ?? '';
      const exists = s.current.links.some((l) => l.href === href && l.text === t);
      if (exists) return s;
      return {
        edited: true,
        current: { ...s.current, links: [...s.current.links, { href, text: t, rel: null }] },
      };
    }),
}));

export const scrapeLinkKey = linkKey;
