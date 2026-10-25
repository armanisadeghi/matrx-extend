/**
 * Guided capture — WHICH element scrolls the feed.
 *
 * "Scroll for me" used to scroll the window only. Several social layouts scroll an inner panel
 * instead (the window never moves), so the scroller saw no new posts, decided the feed had ended
 * after five steps, and the person saw a button that did nothing. This finds the element that
 * really scrolls: the page itself when it can move, otherwise the largest visible scrollable panel.
 */

// KNOB MIRROR: room left to scroll, in px, below which an element does not count as scrollable —
// a layout-detection threshold, not an organization opinion.
const MIN_SCROLL_ROOM = 100;

export interface FeedScroller {
  /** The element being scrolled, or null for the page itself. */
  element: Element | null;
  scrollBy(px: number): void;
  /** Current scroll offset, to notice a step that did not move. */
  position(): number;
  /** Total scrollable height, to notice a feed that is still growing. */
  height(): number;
}

function scrollsVertically(el: Element, view: Window): boolean {
  if (el.scrollHeight - el.clientHeight < MIN_SCROLL_ROOM) return false;
  const style = view.getComputedStyle(el);
  if (style.visibility === 'hidden' || style.display === 'none') return false;
  return /(auto|scroll|overlay)/.test(style.overflowY);
}

/** The page scroller when the page moves; otherwise the largest visible scrolling panel. */
export function findFeedScroller(doc: Document = document): FeedScroller {
  const view = doc.defaultView ?? window;
  const root = (doc.scrollingElement ?? doc.documentElement) as Element;
  const page: FeedScroller = {
    element: null,
    scrollBy: (px) => view.scrollBy({ top: px, behavior: 'auto' }),
    position: () => view.scrollY || root.scrollTop,
    height: () => root.scrollHeight,
  };
  if (root.scrollHeight - root.clientHeight >= MIN_SCROLL_ROOM) return page;

  let best: Element | null = null;
  let bestArea = 0;
  for (const el of Array.from(doc.body?.querySelectorAll('*') ?? [])) {
    if (el.id === 'matrx-guided-capture') continue;
    const area = el.clientWidth * el.clientHeight;
    if (area <= bestArea || !scrollsVertically(el, view)) continue;
    best = el;
    bestArea = area;
  }
  if (!best) return page;
  const panel = best;
  return {
    element: panel,
    scrollBy: (px) => panel.scrollBy({ top: px, behavior: 'auto' }),
    position: () => panel.scrollTop,
    height: () => panel.scrollHeight,
  };
}
