/**
 * Bucket scraped images into three size tiers so the UI can lay them out
 * proportionally — real content prominent, smaller graphics tucked below,
 * favicons and tracking pixels at the very bottom. Nothing is hidden, just
 * sized and ordered so the panel doesn't look broken on icon-heavy pages.
 *
 * Why three tiers and not two: in practice there's a real gap between
 * favicons (16-48px) and "small but valid" graphics (avatars, social-icons,
 * inline glyphs at 60-150px). Lumping them together either crowds the main
 * grid with avatars or buries useful thumbnails alongside trackers.
 *
 * Classification is conservative — when in doubt, push toward the larger
 * bucket. Better to show a 70px graphic in `medium` than to bury a real
 * thumbnail among the favicons.
 */

import type { CollectedImage } from '@/lib/scrape/collectors';

/**
 * Threshold cutoffs by `min(width, height)`:
 *   - icon:    < 48px   (favicons, tracking pixels, tiny inline icons)
 *   - medium:  48-159   (avatars, small button graphics, social icons)
 *   - large:   >= 160   (real content thumbnails and hero images)
 */
const ICON_MAX = 48;
const MEDIUM_MAX = 160;

/**
 * URL fragments that strongly suggest "icon" semantics when dimensions are
 * unavailable (background-images, SVGs that haven't laid out, lazy-loaded
 * images that haven't been measured yet). Conservative: most legitimate
 * photo URLs won't match.
 */
const ICON_URL_HINTS =
  /favicon|\/icon[s]?[/-]|\/sprite[s]?[/-]|\bpixel\.(?:gif|png)|\/1x1\.|spacer\.gif|blank\.gif/i;

export type ImageSize = 'large' | 'medium' | 'icon';

export function classifyImageSize(img: CollectedImage): ImageSize {
  const w = img.width ?? 0;
  const h = img.height ?? 0;
  if (w > 0 && h > 0) {
    const minDim = Math.min(w, h);
    if (minDim < ICON_MAX) return 'icon';
    if (minDim < MEDIUM_MAX) return 'medium';
    return 'large';
  }
  // Unknown dimensions — URL hints, then default to medium (safer than
  // hiding real content among icons or surfacing trackers among photos).
  if (ICON_URL_HINTS.test(img.src)) return 'icon';
  return 'medium';
}

export interface PartitionedImages {
  /** Real content — render in a prominent 3-column grid. */
  large: CollectedImage[];
  /** Small-but-meaningful graphics — render in a denser secondary grid. */
  medium: CollectedImage[];
  /** Favicons, trackers, glyphs — render in a tiny strip at the bottom. */
  icons: CollectedImage[];
}

export function partitionImages(images: CollectedImage[]): PartitionedImages {
  const large: CollectedImage[] = [];
  const medium: CollectedImage[] = [];
  const icons: CollectedImage[] = [];
  for (const img of images) {
    const tier = classifyImageSize(img);
    if (tier === 'large') large.push(img);
    else if (tier === 'medium') medium.push(img);
    else icons.push(img);
  }
  return { large, medium, icons };
}
