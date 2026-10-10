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

export interface CapturedVideoRef {
  src: string;
  post_ref?: string;
  poster?: string;
  mime_type?: string;
}

export interface Accumulator {
  add(anchor: SeenAnchor): boolean;
  addImage(href: string, image: CapturedImageRef): void;
  addVideo(href: string, video: CapturedVideoRef): void;
  videos(): CapturedVideoRef[];
  count(): number;
  images(max?: number): CapturedImageRef[];
}

export function createAccumulator(recipe: GuidedRecipe): Accumulator {
  const items = new Map<string, CapturedImageRef | null>();
  const slides = new Map<string, CapturedImageRef>();
  const videos = new Map<string, CapturedVideoRef>();
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
    addImage(href, image) {
      const post_ref = recipe.itemKey(href);
      if (!post_ref || !/^https?:/.test(image.src)) return;
      if (!items.has(post_ref)) items.set(post_ref, null);
      slides.set(`${post_ref}:${image.src}`, { ...image, post_ref });
    },
    addVideo(href, video) {
      const post_ref = recipe.itemKey(href);
      if (!post_ref || !/^https?:/.test(video.src)) return;
      if (!items.has(post_ref)) items.set(post_ref, null);
      videos.set(`${post_ref}:${video.src}`, { ...video, post_ref });
    },
    videos: () => [...videos.values()],
    count: () => items.size,
    images: (max) => {
      const all = new Map<string, CapturedImageRef>();
      for (const image of [...items.values(), ...slides.values()]) {
        if (image) all.set(`${image.post_ref}:${image.src}`, image);
      }
      return [...all.values()].slice(0, max);
    },
  };
}
