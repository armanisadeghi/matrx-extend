import { swipeTargetFromUrl } from '@/lib/swipe-file/urls';
import { describe, expect, it } from 'vitest';

describe('swipeTargetFromUrl', () => {
  const ok: Array<[string, string, string]> = [
    [
      'https://www.tiktok.com/@user/video/7300000000000000000?is_from_webapp=1',
      'tiktok',
      'https://www.tiktok.com/@user/video/7300000000000000000',
    ],
    [
      'https://www.instagram.com/reel/Cabc_123/?igsh=xyz',
      'instagram',
      'https://www.instagram.com/reel/Cabc_123/',
    ],
    [
      'https://www.instagram.com/someone/p/Cabc123/',
      'instagram',
      'https://www.instagram.com/p/Cabc123/',
    ],
    [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s&list=x',
      'youtube',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    ],
    [
      'https://www.youtube.com/shorts/abcDEF12345',
      'youtube',
      'https://www.youtube.com/shorts/abcDEF12345',
    ],
    [
      'https://www.linkedin.com/posts/jane-doe_launch-activity-7300-abcd?utm_source=share',
      'linkedin',
      'https://www.linkedin.com/posts/jane-doe_launch-activity-7300-abcd',
    ],
    ['https://twitter.com/jack/status/20?s=20', 'x', 'https://x.com/jack/status/20'],
    [
      'https://www.facebook.com/page/posts/123456',
      'facebook',
      'https://www.facebook.com/page/posts/123456',
    ],
    [
      'https://www.facebook.com/ads/library/?id=999&active_status=all',
      'meta_ads',
      'https://www.facebook.com/ads/library?id=999',
    ],
  ];
  it.each(ok)('accepts %s', (raw, platform, url) => {
    const t = swipeTargetFromUrl(raw);
    expect(t?.platform).toBe(platform);
    expect(t?.url).toBe(url);
  });

  it.each([
    'https://www.tiktok.com/@user',
    'https://www.instagram.com/someone/',
    'https://www.youtube.com/',
    'https://www.youtube.com/watch',
    'https://x.com/home',
    'https://www.facebook.com/',
    'https://example.com/watch?v=1',
    'chrome://extensions',
    'not a url',
    '',
    null,
  ])('rejects %s', (raw) => {
    expect(swipeTargetFromUrl(raw as string | null)).toBeNull();
  });
});

describe('feedTargetFromUrl ("Capture more" pages)', () => {
  it('accepts profiles and feeds, never a single post or a bare home/login page', async () => {
    const { feedTargetFromUrl } = await import('@/lib/swipe-file/urls');
    expect(feedTargetFromUrl('https://www.instagram.com/nasa/?hl=en')).toBe(
      'https://www.instagram.com/nasa/',
    );
    expect(feedTargetFromUrl('https://www.tiktok.com/@nasa')).toBe('https://www.tiktok.com/@nasa');
    expect(feedTargetFromUrl('https://www.linkedin.com/company/nasa/posts/')).not.toBeNull();
    expect(feedTargetFromUrl('https://www.instagram.com/p/DeAYvsnn4la/')).toBeNull();
    expect(feedTargetFromUrl('https://x.com/nasa/status/123')).toBeNull();
    expect(feedTargetFromUrl('https://www.instagram.com/')).toBeNull();
    expect(feedTargetFromUrl('https://www.instagram.com/accounts/login/')).toBeNull();
    expect(feedTargetFromUrl('https://www.youtube.com/@nasa')).toBeNull();
    expect(feedTargetFromUrl('https://example.com/nasa')).toBeNull();
    expect(feedTargetFromUrl('https://ads.tiktok.com/i18n/login/security-verify')).toBeNull();
    expect(feedTargetFromUrl('https://business.facebook.com/latest/home')).toBeNull();
    expect(feedTargetFromUrl('https://m.facebook.com/nasa')).toBe('https://m.facebook.com/nasa');
  });
});
