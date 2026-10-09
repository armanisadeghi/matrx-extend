/**
 * Which pages are a saveable social post or ad, and what their canonical URL is.
 *
 * Pure (no chrome.*): the content script, the service worker's context menu and
 * the tests all call this one function. The server's ingest door re-parses the
 * URL itself (`social_unsupported` 422 is the authority); this is only the
 * client's "is there anything to offer here" gate and tracking-param cleanup.
 */

export type SwipePlatform =
  | 'tiktok'
  | 'instagram'
  | 'youtube'
  | 'linkedin'
  | 'x'
  | 'facebook'
  | 'meta_ads';

export interface SwipeTarget {
  platform: SwipePlatform;
  /** The URL sent to the server: no tracking params, no fragment. */
  url: string;
  /** Plain-language kind for UI, e.g. "TikTok video". */
  label: string;
}

const host = (u: URL) => u.hostname.toLowerCase().replace(/^(www|m|mobile)\./, '');

function clean(u: URL, keep: string[] = []): string {
  const out = new URL(u.origin + u.pathname.replace(/\/+$/, ''));
  for (const k of keep) {
    const v = u.searchParams.get(k);
    if (v) out.searchParams.set(k, v);
  }
  return out.toString();
}

export function swipeTargetFromUrl(raw: string | undefined | null): SwipeTarget | null {
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const h = host(u);
  const p = u.pathname;

  if (h === 'tiktok.com' || h.endsWith('.tiktok.com')) {
    if (/^\/@[^/]+\/(video|photo)\/\d+/.test(p))
      return { platform: 'tiktok', url: clean(u), label: 'TikTok video' };
    if (h === 'vm.tiktok.com' || h === 'vt.tiktok.com')
      return /^\/[A-Za-z0-9]+/.test(p)
        ? { platform: 'tiktok', url: clean(u), label: 'TikTok video' }
        : null;
    return null;
  }
  if (h === 'instagram.com') {
    if (/^\/(?:[^/]+\/)?(p|reel|reels|tv)\/[A-Za-z0-9_-]+/.test(p)) {
      const m = p.match(/\/(p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
      if (m) {
        const kind = m[1] === 'p' ? 'p' : m[1] === 'tv' ? 'tv' : 'reel';
        return {
          platform: 'instagram',
          url: `https://www.instagram.com/${kind}/${m[2]}/`,
          label: kind === 'reel' ? 'Instagram reel' : 'Instagram post',
        };
      }
    }
    return null;
  }
  if (h === 'youtube.com' || h === 'youtu.be' || h === 'music.youtube.com') {
    if (h === 'youtu.be' && /^\/[\w-]{6,}/.test(p))
      return { platform: 'youtube', url: clean(u), label: 'YouTube video' };
    if (p === '/watch' && u.searchParams.get('v'))
      return { platform: 'youtube', url: clean(u, ['v']), label: 'YouTube video' };
    if (/^\/shorts\/[\w-]+/.test(p))
      return { platform: 'youtube', url: clean(u), label: 'YouTube Short' };
    return null;
  }
  if (h === 'linkedin.com') {
    if (/^\/(posts\/[^/]+|feed\/update\/urn:li:(activity|share|ugcPost):\d+)/.test(p))
      return { platform: 'linkedin', url: clean(u), label: 'LinkedIn post' };
    return null;
  }
  if (h === 'x.com' || h === 'twitter.com') {
    if (/^\/[^/]+\/status\/\d+/.test(p)) {
      const m = p.match(/^\/([^/]+)\/status\/(\d+)/);
      if (m) return { platform: 'x', url: `https://x.com/${m[1]}/status/${m[2]}`, label: 'X post' };
    }
    return null;
  }
  if (h === 'facebook.com' || h === 'fb.watch') {
    if (h === 'fb.watch') return { platform: 'facebook', url: clean(u), label: 'Facebook video' };
    if (
      /^\/[^/]+\/(posts|videos)\/[^/]+/.test(p) ||
      (/^\/(reel|watch)\/?/.test(p) && (p.startsWith('/reel/') || u.searchParams.get('v')))
    )
      return { platform: 'facebook', url: clean(u, ['v']), label: 'Facebook post' };
    if (p === '/permalink.php' || p === '/photo.php' || p === '/photo' || p === '/story.php')
      return {
        platform: 'facebook',
        url: clean(u, ['story_fbid', 'id', 'fbid']),
        label: 'Facebook post',
      };
    if (p.startsWith('/ads/library') && u.searchParams.get('id'))
      return { platform: 'meta_ads', url: clean(u, ['id']), label: 'Meta ad' };
    return null;
  }
  return null;
}

/** Hostnames the content script is injected on (kept next to the matcher above). */
export const SWIPE_MATCH_PATTERNS = [
  '*://*.tiktok.com/*',
  '*://*.instagram.com/*',
  '*://*.youtube.com/*',
  '*://youtu.be/*',
  '*://*.linkedin.com/*',
  '*://x.com/*',
  '*://twitter.com/*',
  '*://*.facebook.com/*',
];
