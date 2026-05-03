/**
 * Split scraped images into "main content" vs "icons & small graphics".
 *
 * Why we need this: a typical webpage has a handful of real images (heroes,
 * inline photos, screenshots) plus dozens of icons (favicons, social-share,
 * tracking pixels, sprite tiles). Rendering them in the same big-thumb grid
 * makes the panel look broken. Partitioning lets the UI show real content
 * prominently and tuck the small stuff behind an opt-in expander.
 *
 * Classification is conservative — when in doubt, keep the image in `main`.
 * Better to show one icon than to hide a real photo.
 */

import type { CollectedImage } from '@/lib/scrape/collectors';

/**
 * Square pixels below which we treat an image as small/icon. Tuned so that
 * favicons (16/32/48px), social icons (24-32px), tracking pixels, and
 * thin dividers fall out, while modest thumbnails (80px+) stay in main.
 */
const ICON_DIM_THRESHOLD = 64;

/**
 * URL fragments that strongly suggest "icon" semantics when dimensions are
 * unavailable (e.g. background-images, lazy-loaded SVGs that haven't laid
 * out yet). Conservative — most legitimate photos won't match these.
 */
const ICON_URL_HINTS =
  /favicon|\/icon[s]?[/-]|\/sprite[s]?[/-]|\bpixel\.(?:gif|png)|\/1x1\.|spacer\.gif|blank\.gif/i;

export function isSmallImage(img: CollectedImage): boolean {
  const w = img.width ?? 0;
  const h = img.height ?? 0;
  if (w > 0 && h > 0) return Math.min(w, h) < ICON_DIM_THRESHOLD;
  // No reliable dimensions — fall back to URL hints. Background-image
  // CSS extractions and unloaded lazy images land here.
  return ICON_URL_HINTS.test(img.src);
}

export interface PartitionedImages {
  /** Real content — render in the prominent grid. */
  main: CollectedImage[];
  /** Icons, favicons, tracking pixels, dividers — render behind a toggle. */
  small: CollectedImage[];
}

export function partitionImages(images: CollectedImage[]): PartitionedImages {
  const main: CollectedImage[] = [];
  const small: CollectedImage[] = [];
  for (const img of images) {
    if (isSmallImage(img)) small.push(img);
    else main.push(img);
  }
  return { main, small };
}
