import { afterEach, describe, expect, it, vi } from 'vitest';
import { manualCssMode } from './manual-css';

describe('manual CSS patterns without a list root', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('extracts one row from the first scalar match for each picked field', () => {
    const firstName = {
      innerText: 'Cedar chair',
      textContent: 'Cedar chair',
    } as unknown as Element;
    const firstPrice = { innerText: '$189', textContent: '$189' } as unknown as Element;
    const querySelector = vi.fn((selector: string) => {
      if (selector === '.product-name') return firstName;
      if (selector === '.product-price') return firstPrice;
      return null;
    });
    vi.stubGlobal('document', {
      querySelectorAll: () => [],
      querySelector,
    });

    const rows = manualCssMode.runInPage({
      fields: [
        { name: 'field_1', selector: '.product-name', is_list: false },
        { name: 'field_2', selector: '.product-price', is_list: false },
      ],
      list_root_selector: null,
    });

    expect(rows).toEqual([{ field_1: 'Cedar chair', field_2: '$189' }]);
    expect(querySelector).toHaveBeenCalledTimes(2);
    expect(querySelector).toHaveBeenNthCalledWith(1, '.product-name');
    expect(querySelector).toHaveBeenNthCalledWith(2, '.product-price');
  });
});
