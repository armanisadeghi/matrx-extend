/**
 * Old vs new markdown renderer parity. `parity-legacy-shapes.json` was recorded from the hand-rolled
 * renderer (react-markdown + remark-gfm + block parser) before `Markdown` became a door onto
 * @ai-matrx/rich-content; every corpus message must keep the same visible text, headings, list
 * items, table cells, link targets, images and code text. Known, judged differences are listed in
 * KNOWN and asserted explicitly — never skipped silently.
 */
import { chatMarkdownRegistry } from '@/features/chat/markdown-registry';
import { describe, expect, test } from 'vitest';
import { Markdown } from '../Markdown';
import { PARITY_CORPUS } from './parity-corpus';
import legacy from './parity-legacy-shapes.json';
import { type ParityShape, renderShape } from './parity-shape';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LEGACY = legacy as Record<string, ParityShape>;

/**
 * Judged differences. The old renderer dropped a data: image silently (an empty <img>); the new one
 * says why it is not shown. Same image count (none drawn), the text gains the honest notice.
 */
const KNOWN: Record<string, (oldShape: ParityShape, newShape: ParityShape) => void> = {
  'scrape capture with an inline svg data image': (o, n) => {
    expect(n.images).toEqual(o.images);
    expect(n.text.startsWith(o.text)).toBe(true);
    expect(n.text).toContain('Imagenotshown');
  },
};

describe('Markdown door keeps the old renderer’s output', () => {
  test('warm the lazy chunks (code block, prose core)', { timeout: 120_000 }, async () => {
    await renderShape(
      <Markdown content={'# Warm\n\n```python\nprint(1)\nprint(2)\nprint(3)\n```'} />,
    );
  });

  for (const c of PARITY_CORPUS) {
    test(c.name, { timeout: 120_000 }, async () => {
      const before = LEGACY[c.name];
      expect(before, 'legacy shape recorded').toBeDefined();
      const after = await renderShape(
        <Markdown content={c.content} {...(c.chat && { registry: chatMarkdownRegistry })} />,
      );
      const known = KNOWN[c.name];
      if (known && before) {
        known(before, after);
        return;
      }
      expect(after).toEqual(before);
    });
  }

  test('corpus is real-shaped and large enough', () => {
    expect(PARITY_CORPUS.length).toBeGreaterThanOrEqual(15);
    expect(PARITY_CORPUS.filter((c) => c.chat).length).toBeGreaterThanOrEqual(4);
  });
});

const stripToolbar = (text: string) =>
  text.replace(/Window|Data|Chartthis|Fullscreen|Moretableactions|Filter|Sort/g, '');

describe('after the chat package registers its rich-content host (Chat tab visited)', () => {
  test(
    'tables, code, links and reasoning tags still draw outside the chat store',
    { timeout: 180_000 },
    async () => {
      // MarkdownStreamImpl imports chat's rich-content-defaults, which install store-bound bindings.
      await import('@ai-matrx/chat/ui/markdown-stream/MarkdownStreamImpl');
      for (const name of [
        'gfm table',
        'typescript and bash code blocks',
        'links inline and autolink',
        'reasoning and reflection blocks',
      ]) {
        const c = PARITY_CORPUS.find((x) => x.name === name);
        if (!c) throw new Error(`missing corpus case ${name}`);
        const after = await renderShape(
          <Markdown content={c.content} {...(c.chat && { registry: chatMarkdownRegistry })} />,
        );
        const before = LEGACY[name];
        if (name === 'gfm table' && before) {
          // The package table adds toolbar buttons (Window, Data, Chart this, ...) whose set and
          // arrival time depend on lazy chunks: assert the cells, and that the text is the old text once
          // the toolbar labels are taken out - whenever the lazy buttons land.
          expect(after.cells).toEqual(before.cells);
          expect({ ...after, text: '' }).toEqual({ ...before, text: '' });
          expect(stripToolbar(after.text)).toEqual(before.text);
        } else {
          expect(after).toEqual(before);
        }
      }
    },
  );
});
