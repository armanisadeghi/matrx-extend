import { describe, expect, it } from 'vitest';
import { pageCaptureOfferedValues } from './page-capture-offer';

describe('pageCaptureOfferedValues', () => {
  it('names every held fact with its declared kind', () => {
    expect(
      pageCaptureOfferedValues({
        pageMetadata: {
          description: 'Used bikes for sale',
          author: 'Pat Rider',
          lang: 'en',
          og: null,
          truncated: true,
        },
        extractionDescription: 'Every listing with price and title',
        extractedRows: [
          { title: 'Trek', price: 400 },
          { title: 'Giant', price: 350, city: 'Irvine' },
        ],
        tabId: 812,
      }),
    ).toEqual({
      page_description: 'Used bikes for sale',
      page_author: 'Pat Rider',
      page_lang: 'en',
      page_text_truncated: true,
      extraction_description: 'Every listing with price and title',
      extracted_row_count: 2,
      extracted_field_names: ['title', 'price', 'city'],
      tab_id: '812',
    });
  });

  it('omits absent facts instead of sending empty values', () => {
    expect(
      pageCaptureOfferedValues({
        pageMetadata: { description: null, author: '', lang: null, truncated: false },
        extractionDescription: '  ',
      }),
    ).toEqual({ page_text_truncated: false });
    expect(pageCaptureOfferedValues({})).toEqual({});
  });
});
