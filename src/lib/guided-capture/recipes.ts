/**
 * Guided capture — the per-platform step recipes. THE one config.
 *
 * "Take me there" (the web app) sends a person to a page our data provider
 * could not read. The overlay this extension draws on that page needs two
 * things per platform: the few plain steps the person follows, and the little
 * the page can tell us about its own progress (how many posts have loaded).
 * Both live here and nowhere else; the overlay, the service worker and the
 * tests all read this file.
 *
 * STEP TEXT is plain English for a non-technical person — no selectors, no
 * "DOM", no "scrape". When the capture row already carries steps
 * (`what_to_do`, written by the web app/server from the same recipe),
 * `stepsFor` prefers those so the dialog and the overlay never disagree.
 *
 * Pure: no chrome.*, no document. Selectors are strings the content script
 * hands to `querySelectorAll`.
 */

export const GUIDED_PLATFORMS = ['instagram', 'linkedin', 'x', 'facebook', 'tiktok'] as const;
export type GuidedPlatform = (typeof GUIDED_PLATFORMS)[number];

/** What a capture is of. Mirrors `metadata.social.target` in GATED-CAPTURE.md. */
export type GuidedTarget = 'profile' | 'activity' | 'post';

export interface GuidedRecipe {
  platform: GuidedPlatform;
  /** "Instagram" — what the overlay calls the place. */
  label: string;
  /** Registrable hosts (no www/m prefix). */
  hosts: readonly string[];
  /** Numbered steps shown in the overlay, in order. */
  steps: readonly string[];
  /** Different steps for a specific target (e.g. LinkedIn activity). */
  stepsByTarget?: Partial<Record<GuidedTarget, readonly string[]>>;
  /** What "an item" is called in progress text. */
  noun: { one: string; many: string };
  /** CSS selector for anchors that point at one item (post/video/tweet). */
  itemLinkSelector: string;
  /** Pull a stable item key out of an item href; null = not an item. */
  itemKey: (href: string) => string | null;
}

const key = (re: RegExp) => (href: string) => {
  const m = re.exec(href);
  return m ? (m.slice(1).find((g) => !!g) ?? null) : null;
};

export const RECIPES: Readonly<Record<GuidedPlatform, GuidedRecipe>> = {
  instagram: {
    platform: 'instagram',
    label: 'Instagram',
    hosts: ['instagram.com'],
    steps: [
      'Log in if Instagram asks you to',
      'Stay on the profile page',
      'Scroll down so the posts load',
      'Press Capture',
    ],
    noun: { one: 'post', many: 'posts' },
    itemLinkSelector: 'a[href*="/p/"], a[href*="/reel/"], a[href*="/tv/"]',
    itemKey: key(/\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/),
  },
  linkedin: {
    platform: 'linkedin',
    label: 'LinkedIn',
    hosts: ['linkedin.com'],
    steps: [
      'Log in if LinkedIn asks you to',
      'Open the Activity section',
      'Choose "Show all posts"',
      'Scroll down so more posts load',
      'Press Capture',
    ],
    stepsByTarget: {
      activity: [
        'Log in if LinkedIn asks you to',
        'Choose "Show all posts"',
        'Scroll down so more posts load',
        'Press Capture',
      ],
    },
    noun: { one: 'post', many: 'posts' },
    itemLinkSelector: 'a[href*="/feed/update/"], a[href*="/posts/"]',
    itemKey: key(/(urn:li:(?:activity|share|ugcPost):\d+)|\/posts\/([^/?#]+)/),
  },
  x: {
    platform: 'x',
    label: 'X',
    hosts: ['x.com', 'twitter.com'],
    steps: [
      'Log in if X asks you to',
      'Stay on the profile page',
      'Scroll down so the posts load',
      'Press Capture',
    ],
    noun: { one: 'post', many: 'posts' },
    itemLinkSelector: 'a[href*="/status/"]',
    itemKey: key(/\/status\/(\d+)/),
  },
  facebook: {
    platform: 'facebook',
    label: 'Facebook',
    hosts: ['facebook.com'],
    steps: [
      'Log in if Facebook asks you to',
      'Stay on the page',
      'Scroll down so the posts load',
      'Press Capture',
    ],
    noun: { one: 'post', many: 'posts' },
    itemLinkSelector: 'a[href*="/posts/"], a[href*="/videos/"], a[href*="/reel/"], a[href*="story_fbid"]',
    itemKey: key(/\/(?:posts|videos|reel)\/([^/?#]+)|story_fbid=(\d+)/),
  },
  tiktok: {
    platform: 'tiktok',
    label: 'TikTok',
    hosts: ['tiktok.com'],
    steps: [
      'Log in if TikTok asks you to',
      'Stay on the profile page',
      'Scroll down so the videos load',
      'Press Capture',
    ],
    noun: { one: 'video', many: 'videos' },
    itemLinkSelector: 'a[href*="/video/"], a[href*="/photo/"]',
    itemKey: key(/\/(?:video|photo)\/(\d+)/),
  },
};

const stripHost = (h: string) => h.toLowerCase().replace(/^(www|m|mobile)\./, '');

/** The recipe for a page's address, or null when the address is not a supported place. */
export function recipeForUrl(raw: string | null | undefined): GuidedRecipe | null {
  if (!raw) return null;
  let host: string;
  try {
    host = stripHost(new URL(raw).hostname);
  } catch {
    return null;
  }
  for (const r of Object.values(RECIPES)) {
    if (r.hosts.some((h) => host === h || host.endsWith(`.${h}`))) return r;
  }
  return null;
}

export function recipeForPlatform(platform: string | null | undefined): GuidedRecipe | null {
  return platform && (GUIDED_PLATFORMS as readonly string[]).includes(platform)
    ? RECIPES[platform as GuidedPlatform]
    : null;
}

/** Split a row's `what_to_do` into steps ("1. Do this" or one per line). */
export function parseWhatToDo(text: string | null | undefined): string[] {
  if (!text) return [];
  return text
    // The server writes "1. A 2. B 3. C" on one line; also accept one per line.
    .split(/\r?\n|\s(?=\d+[.)]\s)/)
    .map((l) => l.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, '').trim())
    .filter(Boolean);
}

/**
 * The steps to show. The row's own steps win (one source for dialog and
 * overlay); otherwise the recipe's, specialised by target.
 */
export function stepsFor(
  recipe: GuidedRecipe | null,
  target: GuidedTarget | null | undefined,
  rowWhatToDo?: string | null,
): string[] {
  const fromRow = parseWhatToDo(rowWhatToDo);
  if (fromRow.length > 0) return fromRow;
  if (!recipe) return ['Get the page to show what you want saved', 'Press Capture'];
  return [...((target && recipe.stepsByTarget?.[target]) || recipe.steps)];
}

/** "12 posts" / "1 post" / "No posts yet". */
export function countSentence(recipe: GuidedRecipe | null, count: number): string {
  const noun = recipe?.noun ?? { one: 'item', many: 'items' };
  if (count <= 0) return `No ${noun.many} yet`;
  return `${count} ${count === 1 ? noun.one : noun.many}`;
}
