import { describe, expect, it } from 'vitest';
import {
  captureReceiptSummary,
  captureReceiptWarnings,
  type SwipeCaptureReceipt,
  type MediaCoverage,
} from '@/lib/swipe-file/receipt';

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
