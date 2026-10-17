import { afterEach, describe, expect, it } from 'vitest';
import { inspectCardInPage } from './card-inspector';
import { listPatternMode, probeFirstRowInPage } from './modes/list-pattern';
import { pageDiagnosticInPage } from './page-diagnostic';
import { inferListPatternCandidates, relativeFieldSelector } from './selector-resilience';

/**
 * Crown-jewel guard for the List Pattern tool: "click one example item, we
 * find every similar sibling, then extract fields." These are the pure
 * in-page functions the Showcase List Pattern tab injects via
 * chrome.scripting.executeScript. If sibling inference or extraction
 * regresses, the whole tool silently returns nothing — this locks the
 * contract in the always-run suite. Verified end-to-end in a real
 * Chromium with the built extension on 2026-10-15.
 */
const GRID = `
  <main>
    <div class="product-grid" id="grid">
      <article class="product-card" data-testid="card-1"><h3 class="title">Widget A</h3><span class="price">$9.99</span><a class="buy" href="/a">Buy</a></article>
      <article class="product-card" data-testid="card-2"><h3 class="title">Widget B</h3><span class="price">$19.99</span><a class="buy" href="/b">Buy</a></article>
      <article class="product-card" data-testid="card-3"><h3 class="title">Widget C</h3><span class="price">$29.99</span><a class="buy" href="/c">Buy</a></article>
      <article class="product-card" data-testid="card-4"><h3 class="title">Widget D</h3><span class="price">$39.99</span><a class="buy" href="/d">Buy</a></article>
    </div>
  </main>`;

afterEach(() => {
  document.body.innerHTML = '';
});

describe('List Pattern — find every similar sibling', () => {
  it('infers the sibling group from a click INSIDE one card', () => {
    document.body.innerHTML = GRID;
    const clicked = document.querySelector('.product-card .title');
    expect(clicked).not.toBeNull();
    const candidates = inferListPatternCandidates(clicked as Element);
    expect(candidates.length).toBeGreaterThanOrEqual(1);
    const top = candidates[0];
    expect(top?.itemCount).toBe(4);
    expect(top?.listRoot).toContain('#grid');
    // Must NOT lock onto the per-item data-testid (that would match 1).
    expect(top?.itemSelector).toBe('article.product-card');
  });

  it('infers the same group from a click ON the card itself', () => {
    document.body.innerHTML = GRID;
    const card = document.querySelector('.product-card');
    const top = inferListPatternCandidates(card as Element)[0];
    expect(top?.itemCount).toBe(4);
    expect(top?.itemSelector).toBe('article.product-card');
  });

  it('builds a stable relative field selector inside the item', () => {
    document.body.innerHTML = GRID;
    const card = document.querySelector('.product-card') as Element;
    const title = card.querySelector('.title') as Element;
    expect(relativeFieldSelector(title, card)).toBe('h3.title');
  });

  it('extracts one row per sibling with the picked fields', () => {
    document.body.innerHTML = GRID;
    const top = inferListPatternCandidates(document.querySelector('.product-card') as Element)[0];
    if (!top) throw new Error('expected a sibling group');
    const cfg = {
      list_root: top.listRoot,
      item_selector: top.itemSelector,
      field_paths: [
        { name: 'title', rel_selector: '.title' },
        { name: 'price', rel_selector: '.price' },
        { name: 'link', rel_selector: '.buy', attr: 'href' },
      ],
    };
    const rows = listPatternMode.runInPage?.(cfg) as Record<string, string | null>[];
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({ title: 'Widget A', price: '$9.99', link: '/a' });
    expect(rows[3]).toMatchObject({ title: 'Widget D', price: '$39.99', link: '/d' });
    // The inline preview probe must agree with the runner (no second impl).
    expect(probeFirstRowInPage(cfg)).toMatchObject({
      title: 'Widget A',
      price: '$9.99',
      link: '/a',
    });
  });

  // The exact shape Arman hit: a docs nav whose FIRST item is a section
  // header (anchor to "#", no real field), the rest are real links. Before
  // the fix the inspector sampled only items[0] and surfaced ZERO fields,
  // and Extract stayed disabled forever. It must now offer text + links.
  const NAV = `
    <nav class="devsite-book-nav">
      <ul class="devsite-nav-list" id="nav">
        <li class="devsite-nav-item"><a class="devsite-nav-title" href="#">Section header</a></li>
        <li class="devsite-nav-item"><a class="devsite-nav-title" href="/gemini-api/docs/a">Deprecation A</a></li>
        <li class="devsite-nav-item"><a class="devsite-nav-title" href="/gemini-api/docs/b">Deprecation B</a></li>
        <li class="devsite-nav-item"><a class="devsite-nav-title" href="/gemini-api/docs/c">Deprecation C</a></li>
      </ul>
    </nav>`;

  it('suggests text fields for a plain nav list whose first item is a header', () => {
    document.body.innerHTML = NAV;
    const inspection = inspectCardInPage({
      list_root: 'ul#nav',
      item_selector: 'li.devsite-nav-item',
    });
    expect(inspection.status).toBe('ready');
    // The regression returned 0 here. There must be real suggestions now.
    expect(inspection.candidates.length).toBeGreaterThan(0);
    const kinds = new Set(inspection.candidates.map((c) => c.kind));
    expect(kinds.has('text')).toBe(true);
    // A :scope "all text" floor candidate must always be present.
    expect(inspection.candidates.some((c) => c.rel_selector === ':scope')).toBe(true);
    // A real link (from a non-header item) should also surface.
    expect(inspection.candidates.some((c) => c.kind === 'link')).toBe(true);
  });

  it('extracts every nav item as text+link with ZERO picked fields', () => {
    document.body.innerHTML = NAV;
    const cfg = { list_root: 'ul#nav', item_selector: 'li.devsite-nav-item', field_paths: [] };
    const rows = listPatternMode.runInPage?.(cfg) as Record<string, string | null>[];
    // All four items (header included — it has text) become rows.
    expect(rows).toHaveLength(4);
    expect(rows[1]).toMatchObject({ text: 'Deprecation A' });
    expect(rows[1]?.link).toContain('/gemini-api/docs/a');
    // The header has no real link (href="#") → link is null but text is kept.
    expect(rows[0]).toMatchObject({ text: 'Section header', link: null });
    // Inline preview must agree with the runner's default.
    expect(probeFirstRowInPage(cfg)).toMatchObject({ text: 'Section header', link: null });
  });

  it('suggests one-click candidate fields from the sample card', () => {
    document.body.innerHTML = GRID;
    const top = inferListPatternCandidates(document.querySelector('.product-card') as Element)[0];
    if (!top) throw new Error('expected a sibling group');
    const inspection = inspectCardInPage({
      list_root: top.listRoot,
      item_selector: top.itemSelector,
    });
    expect(inspection.status).toBe('ready');
    expect(inspection.candidates.length).toBeGreaterThan(0);
    // The price and the buy link should both surface as suggestions.
    const selectors = inspection.candidates.map((c) => c.rel_selector);
    expect(selectors).toContain('span.price');
    expect(selectors).toContain('a.buy');
  });

  // Utility-class sites (Tailwind) leave the repeating card wrapper bare and
  // put the classes one level down. The repeat is the bare tag + child shape.
  const BARE_CARDS = `
    <main>
      <section class="week"><h2>This week</h2>
        <div class="grid" id="bare">
          ${['alpha/one', 'beta/two', 'gamma/three', 'delta/four', 'eps/five']
            .map(
              (name) =>
                `<a href="/${name}"><div class="card border"><div class="head"><span class="name">${name}</span></div><p class="desc">About ${name} and why it is trending this week</p></div></a>`,
            )
            .join('')}
        </div>
      </section>
      <section class="week"><h2>Last week</h2><div class="grid"></div></section>
    </main>`;

  it('finds classless card wrappers by tag and child shape', () => {
    document.body.innerHTML = BARE_CARDS;
    const span = document.querySelector('#bare a:nth-child(2) .name') as Element;
    const candidates = inferListPatternCandidates(span);
    const cards = candidates.find((c) => c.itemCount === 5 && c.itemSelector === ':scope > a');
    if (!cards) throw new Error(`no card group in ${JSON.stringify(candidates.map((c) => c.itemSelector))}`);
    const rows = listPatternMode.runInPage({
      list_root: cards.listRoot,
      item_selector: cards.itemSelector,
      field_paths: [],
    }) as Array<{ text: string; link: string | null }>;
    expect(rows).toHaveLength(5);
    expect(rows[0]?.text).toContain('alpha/one');
    expect(rows[4]?.link).toContain('/eps/five');
  });

  it('Doctor ranks content cards above navigation menus that repeat more', () => {
    document.body.innerHTML = `<nav><ul class="menu">${Array.from({ length: 30 }, (_, i) => `<li class="item"><a href="/n${i}">N${i}</a></li>`).join('')}</ul></nav>${BARE_CARDS}`;
    const diag = pageDiagnosticInPage();
    const top = diag.sources.repeating_groups[0];
    expect(top?.item_selector).toBe(':scope > a');
    expect(top?.count).toBe(5);
    const list = diag.recommendations.find((r) => r.mode === 'list_pattern');
    expect(list?.config).toMatchObject({ item_selector: ':scope > a' });
  });
});
