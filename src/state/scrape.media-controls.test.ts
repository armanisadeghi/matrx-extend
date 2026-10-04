import type { SoupResult } from '@/lib/scrape/pipeline';
import { afterEach, describe, expect, it } from 'vitest';
import { useScrapeStore } from './scrape';

// A reader reviewing a captured page removes unrelated decorative assets and
// video links before deciding whether the capture is useful.
const capture = (): SoupResult => ({
  url: 'https://fieldnotes.example/garden/seed-starting',
  capturedAt: 1_791_000_000_000,
  metadata: {
    title: 'Starting seeds indoors',
    description: null,
    canonical: null,
    lang: 'en',
    og: {},
    twitter: {},
    schemaTypes: [],
    published_time: null,
    modified_time: null,
  },
  article: {
    title: 'Starting seeds indoors',
    byline: null,
    content_html_safe: '<p>Use a light.</p>',
    content_markdown: 'Use a light.',
    excerpt: null,
    extractor: 'readability',
    word_count: 3,
    reading_time_minutes: 1,
  },
  images: [
    {
      src: 'https://fieldnotes.example/media/seed-tray.jpg',
      alt: 'Seed tray',
      width: 1200,
      height: 800,
    },
    {
      src: 'https://fieldnotes.example/media/site-mark.svg',
      alt: 'Fieldnotes',
      width: 32,
      height: 32,
    },
    { src: 'https://fieldnotes.example/media/soil-chart.png', alt: null, width: 640, height: 480 },
  ],
  videos: [
    { src: 'https://video.example/watch/seedlings', poster: null, duration: 82 },
    {
      src: 'https://video.example/watch/watering',
      poster: 'https://fieldnotes.example/media/watering.jpg',
      duration: 46,
    },
  ],
  audio: [],
  links: [],
  ld_json: [],
  raw_html_size: 48,
  seo: {
    url: 'https://fieldnotes.example/garden/seed-starting',
    fetched_at: 1_791_000_000_000,
    title: { value: 'Starting seeds indoors', length: 22 },
    description: { value: null, length: 0 },
    canonical: null,
    robots: null,
    lang: 'en',
    hreflang: [],
    og: {},
    twitter: {},
    schema_types: [],
    headings: [],
    links: { internal: 0, external: 0 },
    images: { total: 3, missing_alt: 1 },
    word_count: 3,
    sentence_count: 1,
    flesch_reading_ease: null,
    performance: {
      nav_type: null,
      duration_ms: null,
      transfer_size_bytes: null,
      http_status: null,
      redirect_count: null,
    },
  },
});

afterEach(() => useScrapeStore.getState().setCurrent(null));

describe('Scrape media edits in the in-memory capture', () => {
  it('removes the selected image while retaining other image entries and marking the capture edited', () => {
    useScrapeStore.getState().setCurrent(capture(), 'tab:seed-starting');
    for (const src of [
      'https://fieldnotes.example/media/seed-tray.jpg',
      'https://fieldnotes.example/media/site-mark.svg',
      'https://fieldnotes.example/media/soil-chart.png',
    ]) {
      useScrapeStore.getState().removeImage(src);
      const state = useScrapeStore.getState();
      expect(state.current?.images.map((image) => image.src)).not.toContain(src);
      expect(state.edited).toBe(true);
    }
    expect(useScrapeStore.getState().current?.images).toEqual([]);
  });

  it('removes only the selected video and retains the other playable URL', () => {
    useScrapeStore.getState().setCurrent(capture(), 'tab:seed-starting');
    useScrapeStore.getState().removeVideo('https://video.example/watch/seedlings');
    const state = useScrapeStore.getState();
    expect(state.current?.videos).toEqual([
      {
        src: 'https://video.example/watch/watering',
        poster: 'https://fieldnotes.example/media/watering.jpg',
        duration: 46,
      },
    ]);
    expect(state.edited).toBe(true);
  });

  it('adds distinct image and video URLs with the capture model defaults', () => {
    useScrapeStore.getState().setCurrent(capture(), 'tab:seed-starting');
    useScrapeStore.getState().addImage({
      src: 'https://fieldnotes.example/media/germination.jpg',
      alt: 'Germination tray',
    });
    useScrapeStore.getState().addVideo({ src: 'https://video.example/watch/transplanting' });
    const state = useScrapeStore.getState();
    expect(state.current?.images.at(-1)).toEqual({
      src: 'https://fieldnotes.example/media/germination.jpg',
      alt: 'Germination tray',
      width: null,
      height: null,
    });
    expect(state.current?.videos.at(-1)).toEqual({
      src: 'https://video.example/watch/transplanting',
      poster: null,
      duration: null,
    });
    expect(state.edited).toBe(true);
  });

  it('does not duplicate an already captured image or video URL', () => {
    useScrapeStore.getState().setCurrent(capture(), 'tab:seed-starting');
    const before = useScrapeStore.getState().current;
    useScrapeStore.getState().addImage({ src: 'https://fieldnotes.example/media/seed-tray.jpg' });
    useScrapeStore.getState().addVideo({ src: 'https://video.example/watch/seedlings' });
    const after = useScrapeStore.getState();
    expect(after.current?.images).toEqual(before?.images);
    expect(after.current?.videos).toEqual(before?.videos);
    expect(after.edited).toBe(false);
  });
});
