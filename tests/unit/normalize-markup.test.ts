import { normalizeSemanticMarkup } from '@/lib/scrape/pipeline';
import { gfm } from '@joplin/turndown-plugin-gfm';
import TurndownService from 'turndown';
import { describe, expect, it } from 'vitest';

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
  emDelimiter: '_',
});
turndown.use(gfm);

/** Parse HTML, normalize, return markdown of the body — the real pipeline path. */
function toMarkdown(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  normalizeSemanticMarkup(doc);
  return turndown.turndown(doc.body.innerHTML);
}

describe('normalizeSemanticMarkup — Mintlify/MDX paragraphs', () => {
  it('keeps span[data-as=p] paragraphs separate instead of joining them', () => {
    const md = toMarkdown(
      `<span data-as="p">First paragraph here.</span>
       <span data-as="p">Second separate paragraph.</span>
       <span data-as="p">Third paragraph.</span>`,
    );
    // Regression guard: pre-fix this collapsed to one space-joined line.
    expect(md).toContain('First paragraph here.');
    expect(md).toContain('Second separate paragraph.');
    // Pre-fix bug: paragraphs were joined with a single space (no break).
    expect(md).not.toMatch(/First paragraph here\.[ \t]+Second separate paragraph\./);
    // Three paragraphs => blank-line separated.
    const paras = md.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
    expect(paras).toHaveLength(3);
  });

  it('renames data-as headings to real heading tags', () => {
    const md = toMarkdown(`<div data-as="h2">Managed buffering</div><span data-as="p">Body.</span>`);
    expect(md).toMatch(/^## Managed buffering$/m);
  });

  it('preserves inline markup inside a converted paragraph', () => {
    const md = toMarkdown(`<span data-as="p">Set <code>max_buffer_delay_ms</code> to <strong>0</strong>.</span>`);
    expect(md).toContain('`max_buffer_delay_ms`');
    expect(md).toContain('**0**');
  });

  it('leaves an unknown data-as value untouched (no arbitrary tag injection)', () => {
    const doc = new DOMParser().parseFromString(
      `<body><span data-as="script">x</span></body>`,
      'text/html',
    );
    normalizeSemanticMarkup(doc);
    expect(doc.querySelector('script')).toBeNull();
    expect(doc.querySelector('span[data-as="script"]')).not.toBeNull();
  });
});

describe('normalizeSemanticMarkup — highlighted code blocks', () => {
  // Mirrors Cartesia's Shiki output: source split across colored line spans
  // buried inside copy/feedback button chrome.
  const shiki = `
    <div class="code-block" language="json">
      <div class="buttons">
        <button aria-label="Copy"><svg></svg></button>
        <button aria-label="Ask Assistant"><svg></svg></button>
      </div>
      <pre class="shiki" language="json"><code language="json"><span class="line"><span>{</span></span>
<span class="line"><span>  "model_id"</span><span>: </span><span>"sonic-3.5"</span><span>,</span></span>
<span class="line"><span>  "max_buffer_delay_ms"</span><span>: </span><span>3000</span></span>
<span class="line"><span>}</span></span></code></pre>
    </div>`;

  it('produces a fenced code block with the right language and intact source', () => {
    const md = toMarkdown(shiki);
    expect(md).toContain('```json');
    expect(md).toContain('"model_id": "sonic-3.5"');
    expect(md).toContain('"max_buffer_delay_ms": 3000');
    // Newlines preserved across lines, not run together.
    expect(md).toMatch(/\{\n\s*"model_id"/);
  });

  it('drops the button chrome / svg noise around the code', () => {
    const md = toMarkdown(shiki);
    expect(md).not.toContain('Ask Assistant');
    expect(md).not.toContain('Copy');
  });
});
