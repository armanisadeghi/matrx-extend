/**
 * Selector generation for the list-pattern picker.
 *
 * v1 ships CSS-only with structural fingerprinting (tag + truncated class
 * list + nth-of-type when needed). XPath / ARIA-path / text-anchor fallbacks
 * are tracked in the schema (FieldSelector) and will be wired in v2.
 */

/**
 * Stable-anchor preference: when present, these attributes survive class-name
 * churn (LinkedIn/Indeed/Yelp style). We prefer them over auto-generated
 * class hashes.
 *
 * Order of preference within an element:
 *   1. data-testid / data-test-id / data-qa / data-cy   (test hooks; stable)
 *   2. data-job-id / data-id / data-key / data-tracking-control-name
 *      (LinkedIn-style stable hooks)
 *   3. role + aria-label (accessibility-driven; tends to survive)
 *   4. itemtype / itemprop (microdata)
 *   5. id (only when stable-looking — not auto-generated)
 *   6. class hash (filtered to drop dynamic classes)
 */

const STABLE_DATA_ATTRS = [
  'data-testid',
  'data-test-id',
  'data-test',
  'data-qa',
  'data-cy',
  'data-automation-id',
];

const STABLE_HINT_DATA_ATTRS = [
  'data-tracking-control-name', // LinkedIn
  'data-jk', // Indeed
  'data-component-type', // Amazon
];

// Class names that look auto-generated (hash-style) shouldn't be used as
// stable anchors. These tend to rotate every deploy on LinkedIn/Indeed/etc.
// A hyphen/underscore suffix is a hash only when it LOOKS like one: it holds a
// digit (`dcr-1t2r5md`, `css-1a2b3c`), a CSS-modules `__` tail, or no vowel at
// all (`dcr-kwnnv`). Real words (`card-headline`, `headline-text`,
// `product_title`) are the most stable anchors a page has and must survive.
export const AUTOGEN_CLASS_RE =
  /^(?:_[\w-]{4,}|[a-z]+_(?=[\w-]*(?:\d|__))[a-zA-Z0-9_-]{6,}|[a-z]+-(?=[A-Za-z]*\d)[A-Za-z0-9]{5,}|[a-z]{2,4}-[b-df-hj-np-tv-xzB-DF-HJ-NP-TV-XZ]{5,}|[a-z]{1,3}[A-Z][a-zA-Z0-9]{4,}|css-[a-z0-9]{4,}|jsx-\d+|sc-[a-zA-Z0-9]+|c-[a-zA-Z0-9]{6,}|[A-Za-z0-9_]*-sc-[a-z0-9]{5,}-\d+|(?=[a-zA-Z]*[A-Z])(?=[a-zA-Z]*[a-z])[a-zA-Z]{6})$/;

const STATEFUL_CLASS_RE =
  /^(active|hover|focus|focused|selected|open|opened|closed|expanded|collapsed|hidden|visible|loading|disabled)$/i;

const STABLE_ID_RE = /^[a-z][a-z0-9_-]{0,29}$/i; // human-typed id, no random suffix

/**
 * An id worth anchoring a saved pattern on: no long digit run (Shopify's
 * `shopify-section-template--16476858417232__grid` differs per page), no
 * React `:r1:` ids, nothing absurdly long. A generated id names one render.
 */
export function isStableId(id: string): boolean {
  return id.length > 0 && id.length <= 60 && !/\d{4,}/.test(id) && !id.includes(':');
}

function isAutogenClass(c: string): boolean {
  return AUTOGEN_CLASS_RE.test(c);
}

function isStateClass(c: string): boolean {
  return STATEFUL_CLASS_RE.test(c);
}

/** Stable classes only: filtered to drop auto-generated hashes and state. */
function classChunk(el: Element, max = 2): string {
  if (!el.classList.length) return '';
  return Array.from(el.classList)
    .filter((c) => !isStateClass(c) && !isAutogenClass(c))
    .slice(0, max)
    .map((c) => `.${CSS.escape(c)}`)
    .join('');
}

/**
 * Returns the highest-priority stable-anchor selector fragment for the
 * element, or null if no stable anchor exists. Used to prefer attribute
 * selectors over class names when generating fingerprints.
 */
function stableAnchor(el: Element): string | null {
  for (const attr of STABLE_DATA_ATTRS) {
    const v = el.getAttribute(attr);
    if (v) return `[${attr}="${CSS.escape(v).replace(/"/g, '\\"')}"]`;
  }
  for (const attr of STABLE_HINT_DATA_ATTRS) {
    const v = el.getAttribute(attr);
    if (v && v.length < 60) return `[${attr}="${CSS.escape(v).replace(/"/g, '\\"')}"]`;
  }
  const role = el.getAttribute('role');
  if (role) {
    const label = el.getAttribute('aria-label');
    if (label && label.length < 60) {
      return `[role="${role}"][aria-label="${label.replace(/"/g, '\\"')}"]`;
    }
    return `[role="${role}"]`;
  }
  const itemtype = el.getAttribute('itemtype');
  if (itemtype) return `[itemtype="${itemtype.replace(/"/g, '\\"')}"]`;
  const itemprop = el.getAttribute('itemprop');
  if (itemprop) return `[itemprop="${itemprop}"]`;
  if (el.id && STABLE_ID_RE.test(el.id) && isStableId(el.id)) {
    return `#${CSS.escape(el.id)}`;
  }
  return null;
}

/**
 * Local fingerprint: stable anchor (if present), else tag + filtered classes.
 * Adds nth-of-type only when the parent has multiple same-tag siblings AND
 * we couldn't find a stable anchor.
 *
 * For semantic tags (article, section, time, address) we keep the tag even
 * when no class is present — those are usually the most reliable signal.
 */
function localFingerprint(el: Element, includeNth = false): string {
  const anchor = stableAnchor(el);
  if (anchor) {
    // Pin the tag too, so cards (article[data-testid="x"]) stay distinct
    // from random divs that happen to share a data-* attr.
    return el.tagName.toLowerCase() + anchor;
  }

  let s = el.tagName.toLowerCase();
  s += classChunk(el);

  if (includeNth && el.parentElement) {
    const sibs = Array.from(el.parentElement.children).filter((c) => c.tagName === el.tagName);
    if (sibs.length > 1) {
      s += `:nth-of-type(${sibs.indexOf(el) + 1})`;
    }
  }
  return s;
}

/** A unique-ish path selector from `root` to `el`. Used for list_root. */
export function elementPathSelector(el: Element, depth = 5): string {
  const parts: string[] = [];
  let node: Element | null = el;
  while (node && node.nodeType === 1 && parts.length < depth) {
    if (node.id && isStableId(node.id)) {
      parts.unshift(`#${CSS.escape(node.id)}`);
      break;
    }
    parts.unshift(localFingerprint(node, true));
    node = node.parentElement;
  }
  return parts.join(' > ');
}

function isUniqueSelector(root: ParentNode, sel: string, el: Element): boolean {
  try {
    const all = root.querySelectorAll(sel);
    return all.length === 1 && all[0] === el;
  } catch {
    return false;
  }
}

function countMatches(sel: string, doc: Document): number {
  try {
    return doc.querySelectorAll(sel).length;
  } catch {
    return 0;
  }
}

export interface VerifiedPath {
  selector: string;
  /** How many elements the selector names on this page; 1 means exact. */
  matches: number;
}

/**
 * A path selector for `el` that is CHECKED against the live document: it
 * resolves to exactly `el` and nothing else. A saved list root that also
 * matched a twin list elsewhere on the page would replay on whichever the
 * browser found first. Deepens the readable path; it never falls back to a
 * position-only chain (`div:nth-child(3) > …` from `html`), which breaks on
 * the next page that has one more banner. When no readable path is unique the
 * deepest one is returned with its match count, so the caller can say so.
 */
export function verifiedPath(el: Element): VerifiedPath {
  const doc = el.ownerDocument;
  let sel = '';
  for (const depth of [5, 8, 12, 24]) {
    sel = elementPathSelector(el, depth);
    if (isUniqueSelector(doc, sel, el)) return { selector: sel, matches: 1 };
  }
  return { selector: sel, matches: countMatches(sel, doc) };
}

export function verifiedPathSelector(el: Element): string {
  return verifiedPath(el).selector;
}

/**
 * The item selector as replay will evaluate it (`querySelectorAll` from the
 * list root, which also reaches nested descendants), checked against the
 * items the user actually meant: the root's direct children that match.
 * When nested look-alikes would be swept in, pin it to direct children.
 */
function exactItemSelector(root: Element, fp: string, intended: Element[]): string {
  const same = (sel: string): boolean => {
    try {
      const got = Array.from(root.querySelectorAll(sel));
      return got.length === intended.length && got.every((g, i) => g === intended[i]);
    } catch {
      return false;
    }
  };
  if (same(fp)) return fp;
  const scoped = `:scope > ${fp}`;
  return same(scoped) ? scoped : fp;
}

/**
 * STRUCTURAL fingerprint for list-inference. Differs from localFingerprint:
 * intentionally ignores stable-anchor attributes (data-testid, data-jk,
 * aria-label) because those are typically UNIQUE PER ITEM in a list and
 * would cause sibling-matching to always return 1. We want what's common
 * across siblings (tag + structural class), not what's unique.
 *
 * Returns multiple progressively-relaxed selectors so the caller can fall
 * back from strict (tag+2 classes) to loose (just tag) until siblings match.
 */
function listItemFingerprintCandidates(el: Element): string[] {
  const tag = el.tagName.toLowerCase();
  const candidates: string[] = [];
  if (el.classList.length > 0) {
    const classes = Array.from(el.classList).filter((c) => !isStateClass(c) && !isAutogenClass(c));
    if (classes.length >= 2) {
      candidates.push(
        tag +
          classes
            .slice(0, 2)
            .map((c) => `.${CSS.escape(c)}`)
            .join(''),
      );
    }
    if (classes.length >= 1) {
      const c = classes[0];
      if (c) candidates.push(`${tag}.${CSS.escape(c)}`);
    }
  }
  // Loosest fallback: just the tag. Matches a lot, but useful for repeating
  // <li>/<article>/<tr>-style lists where classes don't repeat.
  if (SEMANTIC_ITEM_TAGS.has(tag)) {
    candidates.push(tag);
  }
  // Dedupe while preserving order.
  return Array.from(new Set(candidates));
}

/** Tags that read as list items on their own, even with no class. */
const SEMANTIC_ITEM_TAGS = new Set(['li', 'article', 'tr']);

/**
 * Same-shape siblings: a classless card (`<a>`, `<div>`) carries no class to
 * fingerprint, so its repeat is recognized by tag plus the tag sequence of its
 * direct children. Utility-class sites (Tailwind) often put the classes one
 * level down and leave the repeating wrapper bare.
 */
export function childShape(el: Element): string {
  return Array.from(el.children)
    .map((c) => c.tagName)
    .join(',');
}

export interface ListPatternCandidate {
  listRoot: string;
  itemSelector: string;
  itemCount: number;
  sampleItem: Element;
  /**
   * Elements the list root names on this page. Above 1, the container has
   * look-alikes no readable selector can tell apart, and replay reads the
   * first one; the picker says so instead of saving a position-only path.
   */
  rootMatches?: number;
  /** Cards repeat across this many separate containers (scattered cards). */
  containerCount?: number;
}

/** Find each repeated group containing the click, nearest first. */
export function inferListPatternCandidates(clicked: Element): ListPatternCandidate[] {
  const groups: ListPatternCandidate[] = [];
  let item: Element = clicked;
  let parent: Element | null = clicked.parentElement;

  const push = (root: Element, itemSelector: string, itemCount: number, sample: Element) => {
    const path = verifiedPath(root);
    groups.push({
      listRoot: path.selector,
      itemSelector,
      itemCount,
      sampleItem: sample,
      ...(path.matches > 1 ? { rootMatches: path.matches } : {}),
    });
  };

  while (parent) {
    const candidates = listItemFingerprintCandidates(item);
    let matched = false;
    for (const fp of candidates) {
      let matches: Element[] = [];
      try {
        matches = Array.from(parent.children).filter((c) => {
          try {
            return c.matches(fp);
          } catch {
            return false;
          }
        });
      } catch {
        matches = [];
      }
      if (matches.length >= 2) {
        push(parent, exactItemSelector(parent, fp, matches), matches.length, item);
        matched = true;
        break;
      }
    }
    if (!matched && !SEMANTIC_ITEM_TAGS.has(item.tagName.toLowerCase())) {
      // Classless repeat: same tag, same child shape, direct children only.
      const tagName = item.tagName;
      const shape = childShape(item);
      const same = Array.from(parent.children).filter(
        (c) => c.tagName === tagName && childShape(c) === shape,
      );
      // Two bare siblings is ordinary layout; a list of bare cards is three or more.
      if (same.length >= 3 && item.children.length > 0) {
        push(
          parent,
          `:scope > ${tagName.toLowerCase()}`,
          Array.from(parent.children).filter((c) => c.tagName === tagName).length,
          item,
        );
      }
    }
    // Climb up: the previous "item" becomes a level deeper into the candidate.
    item = parent;
    parent = parent.parentElement;
  }

  // Cards that repeat across SEVERAL containers (a news front: one or two
  // headlines per section, many sections) never form a big sibling group.
  // Offer them as one list when that finds more cards than the nearest group.
  const scattered = inferScatteredCards(clicked);
  if (scattered) {
    const nearest = groups[0];
    const duplicate = groups.some(
      (g) => g.itemCount === scattered.itemCount && g.sampleItem === scattered.sampleItem,
    );
    if (!duplicate && (!nearest || scattered.itemCount > nearest.itemCount)) {
      // First when the nearest group is no real list (a pair), is dwarfed, or
      // is a list of SECTIONS that each hold several of these cards.
      const holds = nearest ? queryAll(nearest.sampleItem, scattered.itemSelector).length : 0;
      if (
        !nearest ||
        nearest.itemCount < 3 ||
        scattered.itemCount >= nearest.itemCount * 4 ||
        holds >= 2
      )
        groups.unshift(scattered);
      else groups.splice(1, 0, scattered);
    }
  }
  return groups;
}

const HEADING_SEL = 'h1,h2,h3,h4,h5,h6,[role="heading"]';

/** Tag plus up to two stable classes — what one card's part has in common with the others'. */
function shapeSignature(el: Element): string {
  return el.tagName.toLowerCase() + classChunk(el);
}

function queryAll(scope: ParentNode, sel: string): Element[] {
  try {
    return Array.from(scope.querySelectorAll(sel));
  } catch {
    return [];
  }
}

/**
 * The nearest container of every card that is safe to replay on another page
 * built from the same template: a stable id, else `main`, else `body`. Never a
 * position.
 */
function stableRootFor(items: Element[]): Element {
  const doc = items[0]?.ownerDocument ?? document;
  let lca: Element | null = items[0]?.parentElement ?? doc.body;
  while (lca && !items.every((i) => lca?.contains(i))) lca = lca.parentElement;
  let node: Element | null = lca;
  while (node && node !== doc.body && node !== doc.documentElement) {
    if (
      node.id &&
      STABLE_ID_RE.test(node.id) &&
      isStableId(node.id) &&
      isUniqueSelector(doc, `#${CSS.escape(node.id)}`, node)
    )
      return node;
    if (node.tagName === 'MAIN' && doc.querySelectorAll('main').length === 1) return node;
    node = node.parentElement;
  }
  return doc.body;
}

function rootSelectorFor(root: Element): string {
  if (root.tagName === 'BODY') return 'body';
  if (root.tagName === 'MAIN' && !(root.id && isStableId(root.id))) return 'main';
  return `#${CSS.escape(root.id)}`;
}

/**
 * Scattered cards: the same card structure under many different parents.
 * The card is recognized by what it CARRIES, not where it sits: an anchor part
 * (its heading, or the stable-classed element clicked) and the largest wrapper
 * around it that holds exactly one such anchor on every card of the page. The
 * saved recipe is `wrapper:has(anchor)` under a stable root — no positions, no
 * generated ids, no build-hash classes — so the same template's next page
 * replays it.
 */
export function inferScatteredCards(clicked: Element): ListPatternCandidate | null {
  const doc = clicked.ownerDocument;
  const anchors: Element[] = [];
  const own = clicked.closest(HEADING_SEL);
  if (own) anchors.push(own);
  for (let n: Element | null = clicked, i = 0; n && n !== doc.body && i < 8; i++) {
    const hs = queryAll(n, HEADING_SEL);
    if (hs.length > 1) break;
    if (hs.length === 1 && hs[0] && !anchors.includes(hs[0])) {
      anchors.push(hs[0]);
      break;
    }
    n = n.parentElement;
  }
  if (classChunk(clicked)) anchors.push(clicked);

  for (const anchor of anchors) {
    const found = scatteredFromAnchor(anchor);
    if (found) return found;
  }
  return null;
}

function scatteredFromAnchor(anchor: Element): ListPatternCandidate | null {
  const doc = anchor.ownerDocument;
  const sigA = shapeSignature(anchor);
  const anchorsOnPage = queryAll(doc, sigA);
  if (anchorsOnPage.length < 3) return null;
  let best: { sel: string; items: Element[]; sample: Element } | null = null;
  for (let node: Element | null = anchor; node && node !== doc.body; node = node.parentElement) {
    // A wrapper that already holds two anchors is a section, not a card.
    if (queryAll(node, sigA).length > 1) break;
    const sel = node === anchor ? sigA : `${shapeSignature(node)}:has(${sigA})`;
    const items = queryAll(doc, sel);
    if (items.length < 3) continue;
    const oneEach = items.every((it) => it === anchor || queryAll(it, sigA).length <= 1);
    const set = new Set(items);
    const nested = items.some((it) => {
      for (let up = it.parentElement; up; up = up.parentElement) if (set.has(up)) return true;
      return false;
    });
    if (!oneEach || nested) continue;
    // Most anchors on the page must sit in such a wrapper, or it is a variant.
    if (items.length < anchorsOnPage.length * 0.6) continue;
    best = { sel, items, sample: node };
  }
  if (!best) return null;
  const parents = new Set(best.items.map((i) => i.parentElement));
  if (parents.size < 2) return null;
  const root = stableRootFor(best.items);
  const exact = queryAll(root, best.sel);
  if (exact.length !== best.items.length) return null;
  return {
    listRoot: rootSelectorFor(root),
    itemSelector: best.sel,
    itemCount: best.items.length,
    sampleItem: best.sample,
    containerCount: parents.size,
  };
}

/** Preserve the nearest-match contract for noninteractive callers. */
export function inferListPattern(clicked: Element): ListPatternCandidate | null {
  return inferListPatternCandidates(clicked)[0] ?? null;
}

/**
 * Produce a selector relative to `withinItem` that uniquely (or near-uniquely)
 * identifies `target`. Used for field paths inside a list item.
 */
export function relativeFieldSelector(target: Element, withinItem: Element): string | null {
  if (target === withinItem) return ':scope';
  if (!withinItem.contains(target)) return null;

  const parts: string[] = [];
  let node: Element | null = target;
  while (node && node !== withinItem && node.nodeType === 1) {
    if (
      node.id &&
      isStableId(node.id) &&
      withinItem.querySelectorAll(`#${CSS.escape(node.id)}`).length === 1
    ) {
      parts.unshift(`#${CSS.escape(node.id)}`);
      break;
    }
    parts.unshift(localFingerprint(node, true));
    node = node.parentElement;
  }
  // The shortest tail of the path that still finds `target` first inside the
  // item: a card's inner wrappers differ between its big and small variants,
  // and a full child chain breaks on every one that is not the sample.
  for (let k = 1; k <= parts.length; k++) {
    const tail = parts.slice(-k).join(' ');
    try {
      if (withinItem.querySelector(tail) === target) return tail;
    } catch {
      // keep deepening
    }
  }
  const sel = parts.join(' > ');
  try {
    if (withinItem.querySelectorAll(sel).length === 0) return null;
  } catch {
    return null;
  }
  return sel;
}
