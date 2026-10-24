import { describe, expect, it } from 'vitest';
import { editorQuery, parseEditorQuery } from './links';

describe('screenshot editor links', () => {
  it('round-trips the editor target through the page query', () => {
    const target = { fileId: 'f-1', screenshotId: 's-1', tool: 'crop' as const };
    expect(parseEditorQuery(`?${editorQuery(target)}`)).toEqual(target);
  });

  it('opens a bare file with no gallery row', () => {
    expect(parseEditorQuery(`?${editorQuery({ fileId: 'f-2' })}`)).toEqual({
      fileId: 'f-2',
      screenshotId: null,
    });
  });

  it('refuses a page with no file', () => {
    expect(parseEditorQuery('?shot=x')).toBeNull();
  });
});
