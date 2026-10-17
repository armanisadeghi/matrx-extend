import { afterEach, describe, expect, it } from 'vitest';
import { inspectCardInPage } from './card-inspector';
import { listPatternMode } from './modes/list-pattern';
import { pageDiagnosticInPage } from './page-diagnostic';
import {
  AUTOGEN_CLASS_RE,
  inferListPatternCandidates,
  verifiedPath,
  verifiedPathSelector,
} from './selector-resilience';

/**
 * Scattered cards — the shape of a news front (The Guardian /world, 2026-10-17):
 * one or two headline cards per list, a dozen sections, every class a build
 * hash. No parent holds more than two cards, so sibling detection alone found
 * only whole sections. The card must be found by its own structure, saved as
 * a stable selector, and replayed on another front built from the same template.
 */
const card = (title: string, slug: string, wide: boolean) => `
  <li class="dcr-${wide ? 'jq2eac' : 'xfgkr8'}">
    <div class="dcr-ldus9v" data-format-design="0">
      <div class="dcr-6hpled">
        <a class="dcr-idxb0f" href="/world/2026/oct/15/${slug}" aria-label="${title}"></a>
        <div class="dcr-${wide ? '12rrx4o' : 'natx2v'}">
          <div class="dcr-14qnufr"><picture><img src="https://i.guim.co.uk/${slug}.jpg" alt="${title}"></picture></div>
          <div class="dcr-d1c482"><div class="dcr-mgshf5"><div class="dcr-yfbcn3">
            <h3 class="card-headline dcr-10aa6d"><span class="show-underline headline-text dcr-oj557d">${title}</span></h3>
          </div>
          ${wide ? `<span class="dcr-qda0hp"><div><div>Standfirst for ${title}, long enough to be a description line.</div></div></span>` : ''}
          <footer class="dcr-kwnnv"><time datetime="2026-10-15T10:00:00Z">2h ago</time></footer>
          </div>
        </div>
      </div>
    </div>
  </li>`;

const front = (sections: string[][]) => `
  <header><nav><ul class="pillars">${Array.from({ length: 8 }, (_, i) => `<li class="pillar"><a href="/p${i}">Pillar ${i}</a></li>`).join('')}</ul></nav></header>
  <main id="maincontent" class="dcr-0">
    ${sections
      .map(
        (titles, s) => `
      <section id="section-${s}" class="dcr-cavc6m" data-component="s${s}">
        <div class="dcr-tx1zxd"><a href="/world/s${s}" data-link-name="section heading"><h2 class="dcr-1o7wz7b">Section ${s}</h2></a></div>
        <div class="dcr-18agdrd">
          <ul class="dcr-e76yd7">${titles
            .slice(0, 1)
            .map((t) => card(t, `${s}-0`, true))
            .join('')}</ul>
          <ul class="dcr-gsuzd0">${titles
            .slice(1)
            .map((t, i) => card(t, `${s}-${i + 1}`, false))
            .join('')}</ul>
        </div>
      </section>`,
      )
      .join('')}
  </main>`;

const WORLD = front([
  ['Senegal arrests', 'Zimbabwe author', 'Guinea-Bissau vaccine'],
  ['Americas one', 'Americas two'],
  ['Asia one', 'Asia two', 'Asia three'],
  ['Europe one', 'Europe two'],
]);
const UK_NEWS = front([
  ['UK one', 'UK two', 'UK three'],
  ['Politics one', 'Politics two', 'Politics three'],
  ['Scotland one'],
  ['Wales one', 'Wales two'],
  ['Ireland one', 'Ireland two'],
]);

const POSITIONAL = /nth-child|nth-of-type/;
const HASHED = /dcr-/;

afterEach(() => {
  document.body.innerHTML = '';
});

describe('Scattered cards — same card structure under many parents', () => {
  it('a click on one headline offers every headline card on the page, first', () => {
    document.body.innerHTML = WORLD;
    const headline = document.querySelectorAll('.headline-text')[4] as Element;
    const top = inferListPatternCandidates(headline)[0];
    expect(top?.itemCount).toBe(10);
    expect(top?.containerCount).toBeGreaterThan(1);
    expect(top?.itemSelector).toBe('li:has(h3.card-headline)');
    expect(top?.listRoot).toBe('#maincontent');
    for (const sel of [top?.listRoot, top?.itemSelector]) {
      expect(sel).not.toMatch(POSITIONAL);
      expect(sel).not.toMatch(HASHED);
    }
  });

  it('Doctor ranks the scattered cards above the sections that hold them', () => {
    document.body.innerHTML = WORLD;
    const top = pageDiagnosticInPage().sources.repeating_groups[0];
    expect(top?.item_selector).toBe('li:has(h3.card-headline)');
    expect(top?.parent_selector).toBe('#maincontent');
    expect(top?.count).toBe(10);
  });

  it('the saved recipe replays on another page of the same template', () => {
    document.body.innerHTML = WORLD;
    const top = inferListPatternCandidates(document.querySelector('.headline-text') as Element)[0];
    if (!top) throw new Error('no candidate');
    const inspection = inspectCardInPage({
      list_root: top.listRoot,
      item_selector: top.itemSelector,
    });
    const pick = (name: string) => inspection.candidates.find((c) => c.name === name);
    const fields = ['title', 'link', 'image'].map((name) => {
      const c = pick(name);
      if (!c) throw new Error(`no ${name} suggestion`);
      return {
        name,
        rel_selector: c.rel_selector,
        ...(c.attr ? { attr: c.attr } : {}),
      };
    });
    for (const f of fields) expect(f.rel_selector).not.toMatch(HASHED);

    document.body.innerHTML = UK_NEWS;
    const rows = listPatternMode.runInPage({
      list_root: top.listRoot,
      item_selector: top.itemSelector,
      field_paths: fields,
    }) as Array<Record<string, string | null>>;
    expect(rows).toHaveLength(11);
    // Page order, every card complete — wide and small variants alike.
    expect(rows.map((r) => r.title)).toEqual([
      'UK one',
      'UK two',
      'UK three',
      'Politics one',
      'Politics two',
      'Politics three',
      'Scotland one',
      'Wales one',
      'Wales two',
      'Ireland one',
      'Ireland two',
    ]);
    for (const r of rows) {
      expect(r.link).toContain('/world/2026/oct/15/');
      expect(r.image).toMatch(/^https:\/\/i\.guim\.co\.uk\//);
    }
  });
});

describe('Suggested fields — most useful first, named by meaning', () => {
  it('leads with the title and the main link, then date, description, image', () => {
    document.body.innerHTML = WORLD;
    const inspection = inspectCardInPage({
      list_root: '#maincontent',
      item_selector: 'li:has(h3.card-headline)',
    });
    const names = inspection.candidates.map((c) => c.name);
    expect(names.slice(0, 2)).toEqual(['title', 'link']);
    expect(names.indexOf('date')).toBeLessThan(names.indexOf('description'));
    expect(names.indexOf('description')).toBeLessThan(names.indexOf('image'));
    expect(names.at(-1)).toBe('full_text');
    expect(new Set(names).size).toBe(names.length);
  });

  it('never names a column after a utility class or a counter suffix', () => {
    const row = (i: number) =>
      `<div class="flex gap-2 p-4"><a class="font-bold" href="/item/${i}">Item ${i} title</a><span class="mr-1 text-sm">${i}23 points</span><span class="mr-1 text-sm">by user${i}</span><a href="/item/${i}#c">${i} comments</a></div>`;
    document.body.innerHTML = `<div id="list">${[1, 2, 3, 4].map(row).join('')}</div>`;
    const inspection = inspectCardInPage({ list_root: '#list', item_selector: ':scope > div' });
    const names = inspection.candidates.map((c) => c.name);
    expect(names[0]).toBe('title');
    expect(names[1]).toBe('link');
    expect(names).toContain('points');
    for (const n of names) {
      expect(n).not.toMatch(/^mr_|^text_sm|^link_url/);
    }
  });
});

describe('Selectors never fall back to a position-only path', () => {
  it('a container no readable selector can tell apart reports its look-alikes', () => {
    const twin = (label: string) =>
      `<div id="dup"><ul class="results">${[1, 2, 3].map((i) => `<li class="hit">${label} ${i}</li>`).join('')}</ul></div>`;
    document.body.innerHTML = `${twin('first')}${twin('second')}`;
    const ul = document.querySelectorAll('ul.results')[1] as Element;
    const path = verifiedPath(ul);
    expect(path.selector).not.toMatch(POSITIONAL);
    expect(path.matches).toBe(2);
    expect(verifiedPathSelector(ul)).toBe(path.selector);
    const group = inferListPatternCandidates(ul.querySelector('li') as Element).find(
      (g) => g.itemCount === 3,
    );
    expect(group?.rootMatches).toBe(2);
  });

  it('keeps real-word classes and drops build hashes', () => {
    for (const word of ['card-headline', 'headline-text', 'product_title', 'Box-row'])
      expect(AUTOGEN_CLASS_RE.test(word)).toBe(false);
    for (const hash of ['dcr-1t2r5md', 'dcr-kwnnv', 'css-1a2b3c', 'styles_card__x9a2'])
      expect(AUTOGEN_CLASS_RE.test(hash)).toBe(true);
  });
});
