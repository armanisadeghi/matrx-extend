import { describe, expect, it } from 'vitest';
import { parseBlocks } from '../block-parser';

const known = new Set(['reflection', 'thinking']);

describe('parseBlocks — self-closing registered tags', () => {
  it('<tag/> is a complete empty xml block and does not swallow the rest of the content', () => {
    const blocks = parseBlocks('before <reflection/> after\n\nmore text', known);
    expect(blocks.map((b) => b.kind)).toEqual(['markdown', 'xml', 'markdown']);
    expect(blocks[1]).toMatchObject({ kind: 'xml', tag: 'reflection', inner: '', complete: true, raw: '<reflection/>' });
    expect(blocks[2]).toMatchObject({ kind: 'markdown', text: ' after\n\nmore text' });
  });

  it('keeps attributes on a self-closing tag', () => {
    const [block] = parseBlocks('<thinking mood="calm" />', known);
    expect(block).toMatchObject({ kind: 'xml', tag: 'thinking', attrs: { mood: 'calm' }, complete: true });
  });

  it('non-self-closing output is unchanged: closed, and streaming-open at the tail', () => {
    const closed = parseBlocks('a <reflection x="1">inner</reflection> b', known);
    expect(closed[1]).toMatchObject({ kind: 'xml', inner: 'inner', attrs: { x: '1' }, complete: true });
    const open = parseBlocks('a <reflection>half', known);
    expect(open[1]).toMatchObject({ kind: 'xml', inner: 'half', complete: false });
  });
});

describe('parseBlocks — unquoted attribute ending in a slash (documented current behavior)', () => {
  it('`<reflection a=b/>`: the unquoted value regex eats the slash, so it is NOT self-closing (an open streaming block)', () => {
    const blocks = parseBlocks('x <reflection a=b/> tail', known);
    expect(blocks[1]).toMatchObject({ kind: 'xml', tag: 'reflection', complete: false });
  });
  it('quoted values with a slash are still self-closing', () => {
    const blocks = parseBlocks('<reflection a="b/c"/> tail', known);
    expect(blocks[0]).toMatchObject({ kind: 'xml', complete: true, raw: '<reflection a="b/c"/>' });
  });
});
