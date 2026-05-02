import type { CaptureError } from '@/lib/scrape/capture-error';
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
  setCurrent: (s: SoupResult | null) => void;
  setLoading: (b: boolean) => void;
  setError: (s: CaptureError | null) => void;
  setAlreadyCaptured: (s: string | null) => void;

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
  setCurrent: (current) => set({ current, error: null, edited: false }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error, loading: false }),
  setAlreadyCaptured: (alreadyCapturedAt) => set({ alreadyCapturedAt }),
  markSaved: () => set({ edited: false }),

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
