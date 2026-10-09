/**
 * Guided capture — collects items AS THE PAGE LOADS THEM.
 *
 * Feeds like Instagram's recycle their DOM: scroll far enough and the first
 * posts' thumbnails are gone from the page. Reading only at the moment the
 * person presses Capture would lose them, so the content script feeds every
 * item link it sees into this accumulator (read-only; nothing is sent
 * anywhere until the person presses Capture). Pure and unit-tested.
 */

import type { GuidedRecipe } from '@/lib/guided-capture/recipes';

export interface SeenAnchor {
  href: string;
  /** The thumbnail inside the link, when it has one. */
  imgSrc?: string | null | undefined;
  imgAlt?: string | null | undefined;
  width?: number | null | undefined;
  height?: number | null | undefined;
}

export interface CapturedImageRef {
  src: string;
  alt?: string;
  width?: number;
  height?: number;
  /** The item this image belongs to (post id / shortcode). */
  post_ref?: string;
}

export interface Accumulator {
  add(anchor: SeenAnchor): boolean;
  count(): number;
  images(max?: number): CapturedImageRef[];
}

export function createAccumulator(recipe: GuidedRecipe): Accumulator {
  const items = new Map<string, CapturedImageRef | null>();
  return {
    add(a) {
      const k = recipe.itemKey(a.href);
      if (!k) return false;
      const isNew = !items.has(k);
      const existing = items.get(k) ?? null;
      if (!existing && a.imgSrc && /^https?:|^data:image\//.test(a.imgSrc)) {
        items.set(k, {
          src: a.imgSrc,
          post_ref: k,
          ...(a.imgAlt ? { alt: a.imgAlt.slice(0, 500) } : {}),
          ...(a.width ? { width: Math.round(a.width) } : {}),
          ...(a.height ? { height: Math.round(a.height) } : {}),
        });
      } else if (isNew) {
        items.set(k, null);
      }
      return isNew;
    },
    count: () => items.size,
    images: (max = 200) =>
      [...items.values()].filter((v): v is CapturedImageRef => !!v).slice(0, max),
  };
}
