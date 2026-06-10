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
const AUTOGEN_CLASS_RE =
  /^(?:_[\w-]{4,}|[a-z]+_[a-zA-Z0-9_-]{6,}|[a-z]+-[A-Za-z0-9]{5,}|[a-z]{1,3}[A-Z][a-zA-Z0-9]{4,}|css-[a-z0-9]{4,}|jsx-\d+|sc-[a-zA-Z0-9]+|c-[a-zA-Z0-9]{6,})$/;

const STATEFUL_CLASS_RE =
  /^(active|hover|focus|focused|selected|open|opened|closed|expanded|collapsed|hidden|visible|loading|disabled)$/i;

const STABLE_ID_RE = /^[a-z][a-z0-9_-]{0,29}$/i; // human-typed id, no random suffix

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
  if (el.id && STABLE_ID_RE.test(el.id)) {
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
    if (node.id) {
      parts.unshift(`#${CSS.escape(node.id)}`);
      break;
    }
    parts.unshift(localFingerprint(node, true));
    node = node.parentElement;
  }
  return parts.join(' > ');
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
  if (tag === 'li' || tag === 'article' || tag === 'tr') {
    candidates.push(tag);
  }
  // Dedupe while preserving order.
  return Array.from(new Set(candidates));
}

/**
 * Find the smallest list scope: walk up from `clicked` and at each ancestor
 * check whether the structural pattern matches >=2 direct siblings. The
 * first ancestor where the pattern matches multiple children is the
 * list_root, and the relative item selector is the matching pattern.
 *
 * Tries progressively looser fingerprints at each level (e.g. tag.class.class
 * → tag.class → tag for li/article/tr).
 */
export function inferListPattern(clicked: Element): {
  listRoot: string;
  itemSelector: string;
  itemCount: number;
  sampleItem: Element;
} | null {
  let item: Element = clicked;
  let parent: Element | null = clicked.parentElement;

  while (parent) {
    const candidates = listItemFingerprintCandidates(item);
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
        return {
          listRoot: elementPathSelector(parent),
          itemSelector: fp,
          itemCount: matches.length,
          sampleItem: item,
        };
      }
    }
    // Climb up: the previous "item" becomes a level deeper into the candidate.
    item = parent;
    parent = parent.parentElement;
  }
  return null;
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
    if (node.id && withinItem.querySelectorAll(`#${CSS.escape(node.id)}`).length === 1) {
      parts.unshift(`#${CSS.escape(node.id)}`);
      break;
    }
    parts.unshift(localFingerprint(node, true));
    node = node.parentElement;
  }
  const sel = parts.join(' > ');

  // If the pure structural path matches multiple things in the item, that's
  // OK for "first match wins" extraction — but check for sanity.
  try {
    if (withinItem.querySelectorAll(sel).length === 0) return null;
  } catch {
    return null;
  }

  return sel;
}
