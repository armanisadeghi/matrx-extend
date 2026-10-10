/** Post-scoped browser observations. Recycled slides remain in the canonical accumulator. */
import type { Accumulator } from '@/lib/guided-capture/accumulator';
import type { GuidedRecipe } from '@/lib/guided-capture/recipes';

const POST_ROOT =
  'article, [role="article"], [data-e2e="browse-video"], [data-e2e="photo-post-container"]';

export function resolvePostRoot(recipe: GuidedRecipe, requestedUrl: string): Element | null {
  const key = recipe.itemKey(requestedUrl);
  if (!key || recipe.itemKey(location.href) !== key) return null;
  const matches = new Set<Element>();
  for (const a of document.querySelectorAll<HTMLAnchorElement>(recipe.itemLinkSelector)) {
    if (recipe.itemKey(a.href) !== key) continue;
    const root = a.closest(POST_ROOT);
    if (root) matches.add(root);
  }
  if (matches.size) return matches.size === 1 ? [...matches][0]! : null;
  // A standalone post often omits its own permalink. Never guess among feed cards.
  const roots = [
    ...document.querySelectorAll(
      `[role="dialog"] ${POST_ROOT.split(', ').join(', [role="dialog"] ')}`,
    ),
  ];
  const candidates = roots.length
    ? roots
    : [...document.querySelectorAll(`main ${POST_ROOT.split(', ').join(', main ')}`)];
  return candidates.length === 1 ? candidates[0]! : null;
}

function belongsToPost(
  node: Element,
  root: Element,
  recipe: GuidedRecipe,
  requestedUrl: string,
): boolean {
  if (
    node.closest(POST_ROOT) !== root ||
    node.closest('header, nav, [data-testid="Tweet-User-Avatar"]')
  )
    return false;
  const anchor = node.closest<HTMLAnchorElement>('a[href]');
  const key = anchor && recipe.itemKey(anchor.href);
  return !key || key === recipe.itemKey(requestedUrl);
}

export interface PostObservation {
  root: Element | null;
  signature: string;
  unavailableVideos: number;
}

export function scanPost(
  acc: Accumulator,
  recipe: GuidedRecipe,
  requestedUrl: string,
): PostObservation {
  const root = resolvePostRoot(recipe, requestedUrl);
  if (!root) return { root: null, signature: '', unavailableVideos: 0 };
  const ready: string[] = [];
  let unavailableVideos = 0;
  for (const img of root.querySelectorAll<HTMLImageElement>('img')) {
    if (!belongsToPost(img, root, recipe, requestedUrl) || /profile picture|avatar/i.test(img.alt))
      continue;
    if (img.naturalWidth < 80 && img.width < 80) continue;
    const src = img.currentSrc || img.src;
    if (!/^https?:/.test(src)) continue;
    // Keep observed URLs while loading; automatic navigation waits for decoded content.
    acc.addImage(requestedUrl, {
      src,
      ...(img.alt ? { alt: img.alt } : {}),
      width: img.naturalWidth || img.width,
      height: img.naturalHeight || img.height,
    });
    if (img.complete && img.naturalWidth > 0) ready.push(src);
  }
  for (const video of root.querySelectorAll<HTMLVideoElement>('video')) {
    if (!belongsToPost(video, root, recipe, requestedUrl)) continue;
    const src = video.currentSrc || video.src || video.querySelector('source')?.src || '';
    if (!/^https?:/.test(src)) {
      unavailableVideos++;
      continue;
    }
    const type = video.querySelector('source')?.type;
    acc.addVideo(requestedUrl, {
      src,
      ...(video.poster ? { poster: video.poster } : {}),
      ...(type ? { mime_type: type } : {}),
    });
    if (video.readyState >= 2) ready.push(src);
  }
  return { root, signature: ready.sort().join('\n'), unavailableVideos };
}

/** Only a unique explicit carousel control inside the saved post can be driven. */
export function nextSlideControl(root: Element): HTMLElement | null {
  const controls = [...root.querySelectorAll<HTMLElement>('button, [role="button"]')].filter(
    (button) => {
      if (
        button.closest(POST_ROOT) !== root ||
        button.hasAttribute('disabled') ||
        button.getAttribute('aria-disabled') === 'true' ||
        button.closest('[hidden], [aria-hidden="true"]')
      )
        return false;
      const label =
        button.getAttribute('aria-label') ||
        button.querySelector('[aria-label]')?.getAttribute('aria-label') ||
        '';
      return /^(next|next slide|next photo|next image|next video|next media|next carousel slide)$/i.test(
        label.trim(),
      );
    },
  );
  return controls.length === 1 ? controls[0]! : null;
}

/** A slide must actually load before another click; cancellation leaves manual capture available. */
export function waitForSlide(
  read: () => PostObservation,
  previous: string,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<PostObservation | null> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve(null);
    const finish = (result: PostObservation | null) => {
      observer.disconnect();
      clearTimeout(timer);
      document.removeEventListener('load', check, true);
      document.removeEventListener('loadeddata', check, true);
      signal.removeEventListener('abort', cancel);
      resolve(result);
    };
    const check = () => {
      const observation = read();
      if (!observation.root) finish(null);
      else if (
        observation.signature.split('\n').some((src) => src && !previous.split('\n').includes(src))
      )
        finish(observation);
    };
    const cancel = () => finish(null);
    const observer = new MutationObserver(check);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src', 'srcset', 'aria-label', 'aria-disabled', 'disabled'],
    });
    const timer = setTimeout(() => finish(null), timeoutMs);
    document.addEventListener('load', check, true);
    document.addEventListener('loadeddata', check, true);
    signal.addEventListener('abort', cancel, { once: true });
    check();
  });
}
