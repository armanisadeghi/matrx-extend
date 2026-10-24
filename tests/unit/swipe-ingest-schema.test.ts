import { SocialPostResultSchema, describeSchemaIssues } from '@/lib/api/routes/social';
import { describe, expect, it } from 'vitest';

/** The exact shape the live server sent for an untouched Instagram carousel (2026-10-11). */
const LIVE_CAROUSEL = {
  __kind: 'social_post',
  post_id: 'd3391bb0-384c-4444-b34f-3cf96ff1657e',
  platform: 'instagram',
  url: 'https://www.instagram.com/p/DeAYvsnn4la/',
  title: null,
  caption: 'Swipe for countless stars',
  handle: 'nasa',
  trace: { provider: 'scrapecreators', fallback_reason: null, cost_credits: 1.0, reused: false },
  media: [
    {
      file_id: 'f1',
      role: 'thumbnail',
      mime_type: 'image/jpeg',
      size_bytes: 159881,
      source_identity: null,
      source_index: null,
      door: '/social/posts/p/media/f1',
    },
  ],
  media_notes: ['Some slides may be missing.'],
  media_coverage: {
    browser_capture: null,
    expected_items: 3,
    observed_items: 3,
    stored_items: 0,
    missing_items: 3,
    status: 'partial',
  },
  transcript: { status: 'none', notes: ['x'] },
};

describe('SocialPostResultSchema', () => {
  it('accepts the live carousel answer (browser_capture: null is normal)', () => {
    const r = SocialPostResultSchema.safeParse(LIVE_CAROUSEL);
    expect(r.success).toBe(true);
    expect(r.data?.media_coverage?.expected_items).toBe(3);
  });

  it('a malformed bonus field degrades alone and never loses the post', () => {
    const r = SocialPostResultSchema.safeParse({
      ...LIVE_CAROUSEL,
      media_coverage: { status: 'brand-new-status' },
      transcript: { status: 'queued' },
      media: 'oops',
    });
    expect(r.success).toBe(true);
    expect(r.data?.post_id).toBe(LIVE_CAROUSEL.post_id);
    expect(r.data?.media_coverage).toBeUndefined();
  });

  it('a null url, platform or trace never turns a stored post into "Not saved"', () => {
    // SocialPost.url is `str | None` on the server; `z.string().optional()` refused null.
    const r = SocialPostResultSchema.safeParse({
      ...LIVE_CAROUSEL,
      url: null,
      platform: null,
      trace: 'not-an-object',
      handle: 42,
    });
    expect(r.success).toBe(true);
    expect(r.data?.post_id).toBe(LIVE_CAROUSEL.post_id);
    expect(r.data?.url ?? undefined).toBeUndefined();
  });

  it('still refuses an answer with no post id, and names the field', () => {
    const r = SocialPostResultSchema.safeParse({ platform: 'instagram' });
    expect(r.success).toBe(false);
    expect(describeSchemaIssues(r.error!)).toBe('post_id: Required');
  });
});
