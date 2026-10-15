import { afterEach, describe, expect, it } from 'vitest';
import { inspectCardInPage } from './card-inspector';
import { listPatternMode, probeFirstRowInPage } from './modes/list-pattern';
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
});
