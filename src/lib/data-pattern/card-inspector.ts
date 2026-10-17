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
  attr?: string | undefined;
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

export interface CardInspection {
  status: 'ready' | 'root_missing' | 'items_missing';
  item_count: number;
  candidates: CandidateField[];
}

/**
 * Self-contained: runs across the chrome.scripting boundary.
 */
export function inspectCardInPage(input: InspectInput): CardInspection {
  const cfg = input;
  const root = document.querySelector(cfg.list_root);
  if (!root) return { status: 'root_missing', item_count: 0, candidates: [] };
  const items = (root as ParentNode).querySelectorAll(cfg.item_selector);
  if (items.length === 0) return { status: 'items_missing', item_count: 0, candidates: [] };

  // Pick the RICHEST of the first few items as the structural sample. A plain
  // nav/list often leads with a section header (few children, an anchor to
  // "#") — sampling only items[0] there surfaces zero fields, the regression
  // Arman hit on the Gemini docs nav. Choosing the item with the most
  // content as the exemplar makes discovery representative of a real row.
  const hasRealLink = (el: Element): boolean => {
    for (const a of Array.from(el.querySelectorAll('a[href]'))) {
      const href = a.getAttribute('href') ?? '';
      if (href && !href.startsWith('#') && !href.startsWith('javascript:')) return true;
    }
    return false;
  };
  const probe = Array.from(items).slice(0, 8) as HTMLElement[];
  let sample = probe[0] as HTMLElement;
  let bestScore = -1;
  for (const it of probe) {
    const text = (it.innerText ?? it.textContent ?? '').trim().length;
    // Reward a real (non-anchor-to-#) link heavily: in a nav/list the first
    // item is often a section header whose only anchor points at "#", and
    // sampling it would starve the link + field suggestions.
    const score =
      it.querySelectorAll('*').length * 2 + (text > 0 ? 1 : 0) + (hasRealLink(it) ? 5 : 0);
    if (score > bestScore) {
      bestScore = score;
      sample = it;
    }
  }
  if (!sample) return { status: 'items_missing', item_count: 0, candidates: [] };

  const ranked: { c: CandidateField; rank: number }[] = [];
  const seenSelectors = new Set<string>();
  const seenTexts = new Set<string>();

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

  // Same rule as selector-resilience's AUTOGEN_CLASS_RE (this runs in the page and cannot import).
  const AUTOGEN =
    /^(?:_[\w-]{4,}|[a-z]+_(?=[\w-]*(?:\d|__))[a-zA-Z0-9_-]{6,}|[a-z]+-(?=[A-Za-z]*\d)[A-Za-z0-9]{5,}|[a-z]{2,4}-[b-df-hj-np-tv-xzB-DF-HJ-NP-TV-XZ]{5,}|[a-z]{1,3}[A-Z][a-zA-Z0-9]{4,}|css-[a-z0-9]{4,}|jsx-\d+|sc-[a-zA-Z0-9]+|c-[a-zA-Z0-9]{6,}|[A-Za-z0-9_]*-sc-[a-z0-9]{5,}-\d+|(?=[a-zA-Z]*[A-Z])(?=[a-zA-Z]*[a-z])[a-zA-Z]{6})$/;
  const STATE = /^(active|hover|focus|selected|open|expanded|hidden|loading)$/i;

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
      } else if (
        node.id &&
        node.id.length <= 60 &&
        !/\d{4,}/.test(node.id) &&
        !node.id.includes(':')
      ) {
        part = `${tag}#${CSS.escape(node.id)}`;
      } else if (node.classList.length > 0) {
        const klass = Array.from(node.classList).filter(
          (c) => !STATE.test(c) && !AUTOGEN.test(c),
        )[0];
        if (klass) part = `${tag}.${CSS.escape(klass)}`;
      }
      // Siblings that share the tag + class (a card's "language" and "stars"
      // spans) would collapse into one selector and both read the first, so
      // pin the position among same-tag siblings.
      const parentEl: Element | null = node.parentElement;
      if (!ip && !part.includes('#') && parentEl) {
        const probe = part;
        const twins = Array.from(parentEl.children).filter((c) => {
          try {
            return c.matches(probe);
          } catch {
            return false;
          }
        });
        // A long run of twins is a chip/tag list: keep it as one field.
        if (twins.length > 1 && twins.length <= 3) {
          const sameTag = Array.from(parentEl.children).filter((c) => c.tagName === node?.tagName);
          part += `:nth-of-type(${sameTag.indexOf(node) + 1})`;
        }
      }
      parts.unshift(part);
      node = node.parentElement;
    }
    // The shortest tail that still finds the target first in the card: inner
    // wrappers differ between a card's big and small variants, so a full
    // child chain only fits the sample.
    for (let k = 1; k <= parts.length; k++) {
      const tail = parts.slice(-k).join(' ');
      try {
        if (sample.querySelector(tail) === target) return tail;
      } catch {
        // keep deepening
      }
    }
    return parts.join(' > ');
  };

  const collapse = (v: string): string => v.replace(/\s+/g, ' ').trim();
  const previewVal = (v: string): string => collapse(v).slice(0, 80);
  const textOf = (el: Element): string =>
    collapse((el as HTMLElement).innerText ?? el.textContent ?? '');

  // Usefulness order: 0 title · 1 primary link · 2 price/date/number ·
  // 3 description · 4 image · 5 other named facts · 6 other text ·
  // 7 other links · 8 other images · 9 data attributes · 10 whole text.
  const push = (c: CandidateField, rank: number): boolean => {
    const key = `${c.rel_selector}|${c.attr ?? 'text'}`;
    if (seenSelectors.has(key)) return false;
    if (!c.attr && !c.transform) {
      const v = collapse(c.sample_value);
      if (v && seenTexts.has(v)) return false;
      if (v) seenTexts.add(v);
    }
    seenSelectors.add(key);
    ranked.push({ c, rank });
    return true;
  };

  const realHref = (a: Element): boolean => {
    const href = a.getAttribute('href') ?? '';
    return !!href && !href.startsWith('#') && !href.startsWith('javascript:');
  };

  // ── The card's title and primary link ──────────────────────────────────
  const heading = Array.from(
    sample.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6,[role="heading"]'),
  ).find((h) => textOf(h));
  const links = [
    ...(sample.matches('a[href]') ? [sample as HTMLAnchorElement] : []),
    ...Array.from(sample.querySelectorAll<HTMLAnchorElement>('a[href]')),
  ].filter(realHref);
  const headText = heading ? textOf(heading).toLowerCase() : '';
  const primaryLink =
    (heading &&
      (links.find((a) => a.contains(heading) || heading.contains(a)) ??
        links.find((a) => {
          const label = collapse(a.getAttribute('aria-label') ?? textOf(a)).toLowerCase();
          return !!label && !!headText && (label.includes(headText) || headText.includes(label));
        }))) ||
    links[0];

  // Without a heading, the card's own name: its microdata name, else the
  // main link's words — never a call to action like "Details".
  const namedEl = heading
    ? null
    : (Array.from(
        sample.querySelectorAll<HTMLElement>(
          '[itemprop="name"],[itemprop="headline"],[itemprop="title"]',
        ),
      ).find((el) => !el.hasAttribute('itemscope') && textOf(el)) ?? null);
  const CTA =
    /^(?:details|more|more info|info|read more|see more|view|view more|view details|learn more|buy|buy now|shop|shop now|book|book now|tickets?|open|go|click here)$/i;
  if (heading) {
    push(
      {
        kind: 'text',
        name: 'title',
        label: `Title (${heading.tagName.toLowerCase()})`,
        rel_selector: relSelector(heading),
        sample_value: previewVal(textOf(heading)),
      },
      0,
    );
  } else if (namedEl) {
    push(
      {
        kind: 'microdata',
        name: 'title',
        label: `Title (${namedEl.getAttribute('itemprop')})`,
        rel_selector: relSelector(namedEl),
        sample_value: previewVal(textOf(namedEl)),
      },
      0,
    );
  } else if (primaryLink && textOf(primaryLink) && !CTA.test(textOf(primaryLink))) {
    push(
      {
        kind: 'text',
        name: 'title',
        label: 'Title (link text)',
        rel_selector: relSelector(primaryLink),
        sample_value: previewVal(textOf(primaryLink)),
      },
      0,
    );
  }
  if (primaryLink) {
    push(
      {
        kind: 'link',
        name: 'link',
        label: 'Link (main)',
        rel_selector: relSelector(primaryLink),
        attr: 'href',
        sample_value: previewVal(primaryLink.getAttribute('href') ?? ''),
      },
      1,
    );
  }

  // ── Meaning of a text leaf, read from its words and its class ──────────
  const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';
  const DATE_RE = new RegExp(
    `^(?:\\d{4}-\\d{2}-\\d{2}|\\d{1,2}[/.-]\\d{1,2}[/.-]\\d{2,4}|${MONTH} \\d{1,2}(?:st|nd|rd|th)?,? ?\\d{0,4}|\\d{1,2} ${MONTH},? ?\\d{0,4})`,
    'i',
  );
  const PRICE_RE = /^(?:[$€£¥]\s?\d|\d[\d.,]*\s?(?:usd|eur|gbp)\b)/i;
  const UTILITY =
    /^(?:m[trblxy]?|p[trblxy]?|w|h|min|max|text|bg|flex|grid|gap|font|leading|tracking|rounded|border|shadow|items|justify|self|place|space|col|row|order|z|top|left|right|bottom|inset|opacity|overflow|truncate|block|inline|hidden|relative|absolute|fixed|sticky|sr|cursor|select|transition|duration|ease|hover|focus|dark|sm|md|lg|xl|line|whitespace|break|align|float|clear|object|aspect|fill|stroke|ring|divide|shrink|grow|basis|container|visible|invisible|muted|small|large|bold|italic|uppercase|lowercase|capitalize|d|fs|fw|lh|u|is|has|js|show|clearfix|wrapper|inner|outer|content|item|card|meta|info|details|body)(?:-|$)/i;
  const meaning = (el: Element, text: string): { name: string; rank: number; label: string } => {
    const hint =
      `${el.getAttribute('class') ?? ''} ${el.getAttribute('itemprop') ?? ''} ${el.getAttribute('data-testid') ?? ''}`.toLowerCase();
    if (/author|byline|creator|username|posted-?by/.test(hint))
      return { name: 'author', rank: 5, label: 'Author' };
    if (DATE_RE.test(text) || /(?:^|[\s_-])(?:date|time|age|ago|published)/.test(hint))
      return { name: 'date', rank: 2, label: 'Date' };
    if (PRICE_RE.test(text) || /price|cost|amount/.test(hint))
      return { name: 'price', rank: 2, label: 'Price' };
    const counted = /^[\d.,]+\s*[kKmMbB]?\s+([a-z][a-z ]{1,20})$/i.exec(text);
    if (counted?.[1]) return { name: slug(counted[1]), rank: 2, label: `Count (${counted[1]})` };
    if (/^[\d.,]+\s*[kKmM%]?$/.test(text)) return { name: 'number', rank: 2, label: 'Number' };
    if (
      /desc|summary|excerpt|standfirst|blurb|snippet|trail|abstract|teaser|lede|subtitle/.test(
        hint,
      ) ||
      text.length >= 60
    )
      return { name: 'description', rank: 3, label: 'Description' };
    if (/tag|categor|kicker|label|badge|genre|topic/.test(hint))
      return { name: 'category', rank: 5, label: 'Category' };
    if (/location|address|city|venue|place/.test(hint))
      return { name: 'location', rank: 5, label: 'Location' };
    const word = Array.from(el.classList).find(
      (c) =>
        /^[a-z][a-z-]{2,24}$/i.test(c) && !UTILITY.test(c) && !AUTOGEN.test(c) && !STATE.test(c),
    );
    if (word) return { name: slug(word), rank: 6, label: `Text (${word})` };
    return { name: 'text', rank: 6, label: 'Text' };
  };

  // ── 1. [itemprop] ──────────────────────────────────────────────────────
  const MICRO_RANK: Record<string, number> = {
    name: 0,
    headline: 0,
    title: 0,
    url: 1,
    price: 2,
    pricecurrency: 2,
    datepublished: 2,
    startdate: 2,
    enddate: 2,
    datecreated: 2,
    ratingvalue: 2,
    description: 3,
    image: 4,
  };
  for (const el of Array.from(sample.querySelectorAll<HTMLElement>('[itemprop]'))) {
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
    const sampleValue = attr ? (el.getAttribute(attr) ?? '') : textOf(el);
    push(
      {
        kind: 'microdata',
        name: slug(name),
        label: name,
        rel_selector: relSelector(el),
        attr,
        sample_value: previewVal(sampleValue),
      },
      MICRO_RANK[name.toLowerCase()] ?? 5,
    );
  }

  // ── 2. Time elements ───────────────────────────────────────────────────
  for (const t of Array.from(sample.querySelectorAll<HTMLTimeElement>('time'))) {
    const dt = t.getAttribute('datetime') ?? '';
    push(
      {
        kind: 'time',
        name: 'date',
        label: `Date: ${textOf(t) || dt}`,
        rel_selector: relSelector(t),
        ...(dt ? { attr: 'datetime' } : {}),
        sample_value: previewVal(dt || textOf(t)),
      },
      2,
    );
  }

  // ── 3. Regex hits in distinct text leaves ──────────────────────────────
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
      // A leaf that IS the price needs no regex; keep its whole value.
      const whole = collapse(text) === m[0];
      push(
        {
          kind: 'regex',
          name: p.name,
          label: p.label,
          rel_selector: relSelector(parent),
          sample_value: previewVal(m[0]),
          ...(whole ? {} : { transform: { kind: 'regex' as const, expr: p.re.source } }),
          note: `regex match in ${parent.tagName.toLowerCase()}`,
        },
        2,
      );
      break;
    }
  }

  // ── 4. Images ──────────────────────────────────────────────────────────
  let firstImage = true;
  for (const img of Array.from(sample.querySelectorAll<HTMLImageElement>('img'))) {
    const attr = img.hasAttribute('src')
      ? 'src'
      : img.hasAttribute('data-src')
        ? 'data-src'
        : img.hasAttribute('data-lazy-src')
          ? 'data-lazy-src'
          : null;
    const src = attr ? (img.getAttribute(attr) ?? '') : '';
    if (!attr || !src) continue;
    const added = push(
      {
        kind: 'image',
        name: 'image',
        label: `Image: ${img.getAttribute('alt') || '(no alt)'}`,
        rel_selector: relSelector(img),
        attr,
        sample_value: previewVal(src),
      },
      firstImage ? 4 : 8,
    );
    if (added) firstImage = false;
  }

  // ── 5. Text: other headings, link labels, leaves ───────────────────────
  for (const h of Array.from(sample.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6'))) {
    const txt = textOf(h);
    if (!txt) continue;
    push(
      {
        kind: 'text',
        name: 'subtitle',
        label: `Heading (${h.tagName.toLowerCase()})`,
        rel_selector: relSelector(h),
        sample_value: previewVal(txt),
      },
      5,
    );
  }

  // Leaf text elements (own direct text only), capped so a dense card does
  // not flood the panel. The longest becomes the description.
  const LEAF_CAP = 10;
  let leafCount = 0;
  let described = ranked.some((r) => r.rank === 3);
  for (const el of Array.from(sample.querySelectorAll<HTMLElement>('*'))) {
    if (leafCount >= LEAF_CAP) break;
    const tag = el.tagName.toLowerCase();
    if (tag === 'script' || tag === 'style' || tag === 'a' || /^h[1-6]$/.test(tag)) continue;
    const direct = collapse(
      Array.from(el.childNodes)
        .filter((n) => n.nodeType === 3)
        .map((n) => n.nodeValue ?? '')
        .join(''),
    );
    // Descriptions run long; only whole-article walls of text are not a field.
    if (!direct || direct.length > 1000) continue;
    const m = meaning(el, direct);
    let rank = m.rank;
    if (m.name === 'description') {
      rank = described ? 6 : 3;
      described = true;
    }
    if (
      push(
        {
          kind: 'text',
          name: m.name,
          label: `${m.label}: ${direct.slice(0, 24)}`,
          rel_selector: relSelector(el),
          sample_value: previewVal(direct),
        },
        rank,
      )
    )
      leafCount++;
  }

  // Other links: their label text, then their URL.
  for (const a of links) {
    if (a === primaryLink) continue;
    const txt = textOf(a);
    const named = txt ? slug(txt.split(/\s+/).slice(0, 3).join(' ')) : 'link';
    if (txt) {
      push(
        {
          kind: 'text',
          name: named,
          label: `Link text: ${txt.slice(0, 24)}`,
          rel_selector: relSelector(a),
          sample_value: previewVal(txt),
        },
        6,
      );
    }
    push(
      {
        kind: 'link',
        name: txt ? `${named}_link` : 'link',
        label: `Link → ${txt ? txt.slice(0, 24) : (a.getAttribute('href') ?? '').slice(0, 50)}`,
        rel_selector: relSelector(a),
        attr: 'href',
        sample_value: previewVal(a.getAttribute('href') ?? ''),
      },
      7,
    );
  }

  // ── 6. data-* attributes on the item itself ────────────────────────────
  for (const a of Array.from(sample.attributes)) {
    if (!a.name.startsWith('data-')) continue;
    if (a.value.length > 200) continue; // skip giant blobs
    push(
      {
        kind: 'data-attr',
        name: slug(a.name.replace(/^data-/, '')),
        label: a.name,
        rel_selector: ':scope',
        attr: a.name,
        sample_value: previewVal(a.value),
      },
      9,
    );
  }

  // ── 7. Guaranteed floor — the whole item's text. Always valid, always
  // non-empty when the item has any content, so Extract is never a dead end.
  const wholeText = textOf(sample);
  if (wholeText) {
    const key = ':scope|text';
    if (!seenSelectors.has(key)) {
      seenSelectors.add(key);
      ranked.push({
        c: {
          kind: 'text',
          name: 'full_text',
          label: 'Item text (all)',
          rel_selector: ':scope',
          sample_value: previewVal(wholeText),
        },
        rank: 10,
      });
    }
  }

  // Most useful first; page order within a tier (Array sort is stable).
  ranked.sort((a, b) => a.rank - b.rank);
  const taken = new Set<string>();
  const out = ranked.map(({ c }) => {
    let name = c.name;
    for (let n = 2; taken.has(name); n += 1) name = `${c.name}_${n}`;
    taken.add(name);
    return { ...c, name };
  });

  return { status: 'ready', item_count: items.length, candidates: out };
}
