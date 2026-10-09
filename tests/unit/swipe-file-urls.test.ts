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
