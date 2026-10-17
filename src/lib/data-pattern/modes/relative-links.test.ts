import type { ExtractionPattern } from '@/lib/supabase/queries';
import { afterEach, describe, expect, it } from 'vitest';
import { applyPattern } from '../runner';
import { listPatternMode } from './list-pattern';
import { manualCssMode } from './manual-css';
import { microdataMode } from './microdata';

const PAGE = 'https://shop.example/catalog/';
const LIST = `<ul id="l"><li class="c"><a class="a" href="/p/1?x=1">One</a><img class="i" src="img/1.png"></li>
  <li class="c"><a class="a" href="../p/2">Two</a><img class="i" src="//cdn.example/2.png"></li></ul>`;

afterEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});
const load = (body: string) => {
  document.head.innerHTML = `<base href="${PAGE}">`;
  document.body.innerHTML = body;
};

describe('relative links in extracted fields are made absolute against the page', () => {
  it('manual_css', () => {
    load(LIST);
    const rows = manualCssMode.runInPage({
      list_root_selector: '.c',
      fields: [
        { name: 'url', selector: '.a', attr: 'href', is_list: false },
        { name: 'img', selector: '.i', attr: 'src', is_list: false },
      ],
    }) as Array<Record<string, string>>;
    expect(rows.map((r) => r.url)).toEqual([
      'https://shop.example/p/1?x=1',
      'https://shop.example/p/2',
    ]);
    expect(rows[0]?.img).toBe('https://shop.example/catalog/img/1.png');
    expect(rows[1]?.img).toBe('https://cdn.example/2.png');
  });

  it('list_pattern', () => {
    load(LIST);
    const rows = listPatternMode.runInPage({
      list_root: '#l',
      item_selector: '.c',
      field_paths: [{ name: 'url', rel_selector: '.a', attr: 'href' }],
    }) as Array<Record<string, string>>;
    expect(rows.map((r) => r.url)).toEqual([
      'https://shop.example/p/1?x=1',
      'https://shop.example/p/2',
    ]);
  });

  it('microdata', () => {
    load(
      '<div itemscope itemtype="https://schema.org/Product"><a itemprop="url" href="/p/9">x</a><img itemprop="image" src="a.png"></div>',
    );
    const rows = microdataMode.runInPage({}) as Array<Record<string, string>>;
    expect(rows[0]?.url).toBe('https://shop.example/p/9');
    expect(rows[0]?.image).toBe('https://shop.example/catalog/a.png');
  });

  it('saved-pattern runner', () => {
    load(LIST);
    const rows = applyPattern({
      list_root_selector: '.c',
      fields: [{ name: 'url', selector: '.a', attr: 'href', is_list: false }],
    } as unknown as ExtractionPattern);
    expect(rows.map((r) => r.url)).toEqual([
      'https://shop.example/p/1?x=1',
      'https://shop.example/p/2',
    ]);
  });

  it('leaves non-URL attributes alone', () => {
    load('<p class="c"><b data-sku="/abc">x</b></p>');
    const rows = manualCssMode.runInPage({
      list_root_selector: '.c',
      fields: [{ name: 's', selector: 'b', attr: 'data-sku', is_list: false }],
    }) as Array<Record<string, string>>;
    expect(rows[0]?.s).toBe('/abc');
  });
});
