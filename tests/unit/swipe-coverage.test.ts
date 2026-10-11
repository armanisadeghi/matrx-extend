import {
  type MediaCoverage,
  type SwipeCaptureReceipt,
  captureReceiptSummary,
  captureReceiptWarnings,
  missingSlideNumbers,
} from '@/lib/swipe-file/receipt';
import { describe, expect, it } from 'vitest';

// A relocation marketer needs all slides of a saved visa-options carousel.
const receipt = (coverage?: MediaCoverage): SwipeCaptureReceipt => ({
  postId: 'spain-options',
  organizationId: 'relocation',
  platform: 'instagram',
  capturedAt: '2026-10-10T15:00:00Z',
  media: [],
  mediaNotes: [],
  transcript: { status: 'available', notes: [] },
  reused: false,
  ...(coverage ? { coverage } : {}),
});

describe('carousel capture receipt', () => {
  it('makes a first-slide-only save visibly partial rather than a successful full capture', () => {
    const captured = receipt({
      expected_items: 7,
      observed_items: 7,
      stored_items: 1,
      missing_items: 6,
      status: 'partial',
    });
    expect(captureReceiptSummary(captured)).toBe('1 of 7 media items stored');
    expect(captureReceiptWarnings(captured)).toContain('6 media items missing');
  });
  it('distinguishes verified completeness from unknown coverage', () => {
    expect(
      captureReceiptSummary(
        receipt({
          expected_items: 7,
          observed_items: 7,
          stored_items: 7,
          missing_items: 0,
          status: 'complete',
        }),
      ),
    ).toBe('7 of 7 media items stored');
    expect(
      captureReceiptWarnings(
        receipt({
          expected_items: null,
          observed_items: 1,
          stored_items: 1,
          missing_items: null,
          status: 'unknown',
        }),
      ),
    ).toContain('Full media coverage could not be verified');
    expect(
      captureReceiptWarnings(
        receipt({
          expected_items: 7,
          observed_items: 7,
          stored_items: 7,
          missing_items: 0,
          status: 'complete',
        }),
      ),
    ).toEqual([]);
  });
});

describe('plain carousel wording and notes', () => {
  const base = {
    postId: 'p',
    organizationId: 'o',
    platform: 'instagram',
    capturedAt: '2026-10-11T00:00:00Z',
    media: [],
    mediaNotes: [
      'Some slides may be missing. Open the post in your browser to capture the remaining slides.',
      'image_2: could not be downloaded',
      "The provider did not name the author's account id; the post has no profile link yet.",
    ],
    transcript: {
      status: 'none' as const,
      notes: [
        "platform transcript unavailable: We couldn't find that account or post.",
        'speech-to-text: no stored video for this post',
      ],
    },
    reused: false,
    format: 'carousel',
    coverage: {
      expected_items: 8,
      observed_items: 8,
      stored_items: 7,
      missing_items: 1,
      status: 'partial' as const,
    },
  };
  it('says "7 of 8 slides saved" and names what is missing without vendor or stage words', () => {
    expect(captureReceiptSummary(base)).toBe('7 of 8 slides saved');
    const w = captureReceiptWarnings(base);
    expect(w).toEqual([
      'Slide 2 could not be downloaded',
      '1 slide missing',
      'Transcript unavailable',
    ]);
    expect(w.join(' ')).not.toMatch(/provider|speech|platform transcript/i);
  });
});

describe('naming exactly which slides are missing', () => {
  const stored = (i: number) => ({
    file_id: `f${i}`,
    role: `image_${i}`,
    source_index: i,
    mime_type: 'image/jpeg',
    size_bytes: 1,
    door: '/d',
  });
  const receipt = {
    postId: 'p',
    organizationId: 'o',
    platform: 'instagram',
    capturedAt: '2026-10-11T00:00:00Z',
    media: [1, 3, 4].map(stored),
    mediaNotes: [],
    transcript: { status: 'available' as const, notes: [] },
    reused: false,
    format: 'carousel',
    coverage: {
      expected_items: 5,
      observed_items: 5,
      stored_items: 3,
      missing_items: 2,
      status: 'partial' as const,
    },
  };
  it('lists the slide numbers when stored positions are known', () => {
    expect(missingSlideNumbers(receipt)).toEqual([2, 5]);
    expect(captureReceiptWarnings(receipt)).toContain('Slides 2, 5 missing');
  });
  it('falls back to a count when positions disagree with the stored total', () => {
    const odd = {
      ...receipt,
      coverage: { ...receipt.coverage, stored_items: 4, missing_items: 1 },
    };
    expect(missingSlideNumbers(odd)).toBeNull();
    expect(captureReceiptWarnings(odd)).toContain('1 slide missing');
  });
});
