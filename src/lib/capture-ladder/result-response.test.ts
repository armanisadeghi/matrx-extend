import { describe, expect, it } from 'vitest';
import { parseResultResponse } from './api';

describe('parseResultResponse', () => {
  it('keeps the Source id and every well-formed notice', () => {
    const r = parseResultResponse({
      handoff: {},
      processed_document_id: 'doc-1',
      source_id: 'spp-1',
      library_item_id: null,
      library_id: null,
      notices: [{ code: 'a', message: 'First.', remedy: '' }, { nope: true }],
    });
    expect(r.processed_document_id).toBe('doc-1');
    expect(r.notices).toEqual([{ code: 'a', message: 'First.', remedy: '' }]);
    expect('library_item_id' in r).toBe(false);
  });

  it('a caption answer (no Source) still parses', () => {
    const r = parseResultResponse({ handoff: {}, transcript_id: 't-1', library_id: 'lib' });
    expect(r).toMatchObject({ processed_document_id: null, transcript_id: 't-1', notices: [] });
  });
});
