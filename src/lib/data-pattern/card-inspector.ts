/**
 * Card inspector: given a List-Pattern config (list root + item selector),
 * find the first matching item and surface every extractable field it
 * contains. Used by the List Pattern tab to suggest "more fields available"
 * after the user picks the card structure.
 *
 * The shapes we surface (in priority order):
 *   1. [itemprop] — Schema.org microdata. Most semantic, most stable.
 *   2. data-* attributes on the item itself (data-job-id, data-event-id, etc.)
 *   3. <a href> — link candidates (e.g. detail-page URL).
 *   4. <img src|data-src> — image candidates.
 *   5. <time datetime> — parseable timestamps.
 *   6. distinct text leaves with regex hits ("Ages: 21+", "$45", "★ 4.5").
 *
 * Returned candidates are pre-named, pre-typed, and ready to drop into the
 * pattern's field_paths array.
 */

export interface CandidateField {
  /** Suggested column name (snake_case). User can rename. */
  name: string;
  /** Human-readable label for the UI. */
  label: string;
  /** Selector relative to the item element. ":scope" means the item itself. */
  rel_selector: string;
  /** Optional attribute to read instead of innerText. */
  attr?: string;
  /** Sample value (truncated) so the user can preview before selecting. */
  sample_value: string;
  /** Source kind for grouping in the UI. */
  kind: 'microdata' | 'data-attr' | 'link' | 'image' | 'time' | 'regex' | 'text';
  /** Optional human note (e.g. regex pattern that matched). */
  note?: string;
  /**
   * Optional value transform. The list-pattern runner applies this AFTER
   * reading the selector's text/attribute. Critical for regex-discovered
   * candidates: without it, the runner would return the whole parent text
   * (e.g. "Las Vegas, NV · Tao Beach · Ages: 21+") instead of just "21+".
   */
  transform?: { kind: 'regex'; expr: string };
}

export interface InspectInput {
  list_root: string;
  item_selector: string;
}

/**
 * Self-contained: runs across the chrome.scripting boundary.
 */
export function inspectCardInPage(input: InspectInput): CandidateField[] {
  const cfg = input;
  const root = document.querySelector(cfg.list_root);
  if (!root) return [];
  const sample = (root as ParentNode).querySelector(cfg.item_selector) as HTMLElement | null;
  if (!sample) return [];

  const out: CandidateField[] = [];
  const seenSelectors = new Set<string>();

  const slug = (raw: string): string => {
    let s = raw
      .normalize('NFKD')
      .replace(/[^\w\s]/g, ' ')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/__+/g, '_')
      .replace(/^_+|_+$/g, '');
    if (!s) return 'field';
    if (!/^[a-z]/.test(s)) s = `f_${s}`;
    return s;
  };

  const relSelector = (target: Element): string => {
    if (target === sample) return ':scope';
    const parts: string[] = [];
    let node: Element | null = target;
    while (node && node !== sample) {
      const tag = node.tagName.toLowerCase();
      let part = tag;
      // Prefer itemprop attribute selector when present — most stable.
      const ip = node.getAttribute('itemprop');
      if (ip) {
        part = `${tag}[itemprop="${ip}"]`;
      } else if (node.id) {
        part = `${tag}#${CSS.escape(node.id)}`;
      } else if (node.classList.length > 0) {
        const klass = Array.from(node.classList)
          .filter(
            (c) =>
              !/^(active|hover|focus|selected|open|expanded|hidden|loading)$/i.test(c) &&
              !/^(?:_[\w-]{4,}|css-[a-z0-9]{4,}|jsx-\d+|sc-[a-zA-Z0-9]+)$/.test(c),
          )
          .slice(0, 1)[0];
        if (klass) part = `${tag}.${CSS.escape(klass)}`;
      }
      parts.unshift(part);
      node = node.parentElement;
    }
    return parts.join(' > ');
  };

  const previewVal = (v: string): string => v.replace(/\s+/g, ' ').trim().slice(0, 80);

  const dedupePush = (c: CandidateField): void => {
    const key = `${c.rel_selector}|${c.attr ?? 'text'}`;
    if (seenSelectors.has(key)) return;
    seenSelectors.add(key);
    out.push(c);
  };

  // ── 1. [itemprop] ──────────────────────────────────────────────────────
  const itemProps = Array.from(sample.querySelectorAll<HTMLElement>('[itemprop]'));
  for (const el of itemProps) {
    // Skip itemscope wrappers — those are nested objects, not leaf fields.
    if (el.hasAttribute('itemscope')) continue;
    const name = el.getAttribute('itemprop') ?? 'item';
    const tag = el.tagName.toLowerCase();
    let attr: string | undefined;
    if (tag === 'meta') attr = 'content';
    else if (tag === 'time') attr = 'datetime';
    else if (tag === 'a' || tag === 'link') attr = 'href';
    else if (tag === 'img' || tag === 'audio' || tag === 'video') attr = 'src';
    else if (tag === 'data' || tag === 'meter') attr = 'value';

    const sampleValue = attr
      ? (el.getAttribute(attr) ?? '')
      : (el.innerText ?? el.textContent ?? '');

    dedupePush({
      kind: 'microdata',
      name: slug(name),
      label: name,
      rel_selector: relSelector(el),
      attr,
      sample_value: previewVal(sampleValue),
    });
  }

  // ── 2. data-* attributes on the item itself ────────────────────────────
  for (const a of Array.from(sample.attributes)) {
    if (!a.name.startsWith('data-')) continue;
    if (a.value.length > 200) continue; // skip giant blobs
    dedupePush({
      kind: 'data-attr',
      name: slug(a.name.replace(/^data-/, '')),
      label: a.name,
      rel_selector: ':scope',
      attr: a.name,
      sample_value: previewVal(a.value),
    });
  }

  // ── 3. Links ───────────────────────────────────────────────────────────
  const links = Array.from(sample.querySelectorAll<HTMLAnchorElement>('a[href]'));
  for (const a of links) {
    const href = a.getAttribute('href') ?? '';
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) continue;
    const linkText = (a.innerText ?? a.textContent ?? '').trim();
    const labelHint = linkText ? linkText.slice(0, 24) : href.slice(0, 50);
    dedupePush({
      kind: 'link',
      name: 'link_url',
      label: `Link → ${labelHint}`,
      rel_selector: relSelector(a),
      attr: 'href',
      sample_value: previewVal(href),
    });
  }

  // ── 4. Images ──────────────────────────────────────────────────────────
  const imgs = Array.from(sample.querySelectorAll<HTMLImageElement>('img'));
  for (const img of imgs) {
    const src =
      img.getAttribute('src') ??
      img.getAttribute('data-src') ??
      img.getAttribute('data-lazy-src') ??
      '';
    if (!src) continue;
    const attr = img.hasAttribute('src')
      ? 'src'
      : img.hasAttribute('data-src')
        ? 'data-src'
        : 'data-lazy-src';
    dedupePush({
      kind: 'image',
      name: 'image_url',
      label: `Image: ${img.getAttribute('alt') ?? '(no alt)'}`,
      rel_selector: relSelector(img),
      attr,
      sample_value: previewVal(src),
    });
  }

  // ── 5. Time elements with datetime attribute ──────────────────────────
  const times = Array.from(sample.querySelectorAll<HTMLTimeElement>('time[datetime]'));
  for (const t of times) {
    const dt = t.getAttribute('datetime') ?? '';
    if (!dt) continue;
    dedupePush({
      kind: 'time',
      name: 'timestamp',
      label: `Time: ${t.innerText?.trim() || dt}`,
      rel_selector: relSelector(t),
      attr: 'datetime',
      sample_value: previewVal(dt),
    });
  }

  // ── 6. Regex hits in distinct text leaves ─────────────────────────────
  const PATTERNS: { name: string; label: string; re: RegExp }[] = [
    { name: 'price', label: 'Price', re: /\$\s?\d+(?:[.,]\d{2})?/ },
    { name: 'age_range', label: 'Age range', re: /\bAges?:?\s*\d+\+?/i },
    { name: 'rating', label: 'Rating (★)', re: /★\s*\d(?:\.\d)?/ },
    { name: 'review_count', label: 'Review count', re: /\(\d{1,3}(?:,\d{3})*\s*reviews?\)/i },
  ];
  const walker = document.createTreeWalker(sample, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const text = (node.nodeValue ?? '').trim();
    if (!text || text.length > 200) continue;
    for (const p of PATTERNS) {
      const m = p.re.exec(text);
      if (!m) continue;
      const parent = node.parentElement;
      if (!parent || !sample.contains(parent)) continue;
      dedupePush({
        kind: 'regex',
        name: p.name,
        label: p.label,
        rel_selector: relSelector(parent),
        sample_value: previewVal(m[0]),
        transform: { kind: 'regex', expr: p.re.source },
        note: `regex match in ${parent.tagName.toLowerCase()}`,
      });
      break;
    }
  }

  return out;
}
