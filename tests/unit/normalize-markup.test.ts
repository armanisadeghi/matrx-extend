import { normalizeSemanticMarkup, runScrape } from '@/lib/scrape/pipeline';
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

// The captured Mathspace graph has 11 vertical and 11 horizontal grid lines,
// each drawn once in the light grid and once in the dark axis layer (44 total).
const mathspaceGridLines = [-0.5, 25.5, 51.5, 77.5, 103.5, 129.5, 155.5, 181.5, 207.5, 233.5, 259.5]
  .flatMap((coordinate) => [
    `<line x1="${coordinate}" y1="0" x2="${coordinate}" y2="260" stroke="#F1F2F3" />`,
    `<line x1="0" y1="${coordinate + 0.5}" x2="260" y2="${coordinate + 0.5}" stroke="#F1F2F3" />`,
    `<line x1="${coordinate}" y1="0" x2="${coordinate}" y2="260" />`,
    `<line x1="0" y1="${coordinate + 0.5}" x2="260" y2="${coordinate + 0.5}" />`,
  ])
  .join('');

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
    const paras = md
      .split(/\n{2,}/)
      .map((s) => s.trim())
      .filter(Boolean);
    expect(paras).toHaveLength(3);
  });

  it('renames data-as headings to real heading tags', () => {
    const md = toMarkdown(
      `<div data-as="h2">Managed buffering</div><span data-as="p">Body.</span>`,
    );
    expect(md).toMatch(/^## Managed buffering$/m);
  });

  it('preserves inline markup inside a converted paragraph', () => {
    const md = toMarkdown(
      `<span data-as="p">Set <code>max_buffer_delay_ms</code> to <strong>0</strong>.</span>`,
    );
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

  it('replaces the whole .code-block wrapper, not just the inner <pre>', () => {
    // Regression guard: leaving the button-laden wrapper in place causes
    // Defuddle to prune the entire subtree (code included). We must hoist the
    // clean <pre> up to where the wrapper sat. See codeBlockWrapper().
    const doc = new DOMParser().parseFromString(
      `<body><div id="content"><p>Intro.</p>${shiki}<p>Outro.</p></div></body>`,
      'text/html',
    );
    normalizeSemanticMarkup(doc);
    expect(doc.querySelector('.code-block')).toBeNull();
    expect(doc.querySelector('[aria-label="Ask Assistant"]')).toBeNull();
    const pre = doc.querySelector('pre');
    expect(pre).not.toBeNull();
    // The clean <pre> sits directly under #content (sibling of the paragraphs),
    // not buried in wrapper divs.
    expect(pre?.parentElement?.id).toBe('content');
    expect(pre?.querySelector('code')?.className).toBe('language-json');
  });
});

describe('scrape pipeline — inline SVG figures', () => {
  it.each([
    {
      name: 'a labelled standalone chart',
      figure: `<figure>
        <svg aria-label="Quarterly revenue chart" width="320" height="180" viewBox="0 0 320 180">
          <path d="M0 170 L80 120 L160 140 L240 60 L320 20" stroke="#0875BE" />
        </svg>
      </figure>`,
      expectedAlt: 'Quarterly revenue chart',
      expectedGraphics: ['<path'],
      expectedImages: 1,
    },
    {
      name: 'a Mathspace-style layered coordinate plane',
      figure: `<figure style="display:block;margin:16px 0;break-inside:avoid">
        <div style="position:relative;text-align:center;isolation:isolate">
          <div style="display:block;position:relative;width:260px;height:260px;margin:0 auto;background:#fff">
            <svg width="260" height="7" viewBox="0 0 260 7">
              <path d="M 7 3 v -3 l -7 3.5 l 7 3.5 v -3 h 246 v 3 l 7,-3.5 l -7,-3.5 v 3 h -246 Z" />
            </svg>
            <svg width="260" height="7" viewBox="0 0 260 7">
              <path d="M 7 3 v -3 l -7 3.5 l 7 3.5 v -3 h 246 v 3 l 7,-3.5 l -7,-3.5 v 3 h -246 Z" />
            </svg>
            <svg style="position:absolute;top:0;left:0" width="260" height="260" viewBox="0 0 260 260" stroke="#99A4AF">
              ${mathspaceGridLines}
            </svg>
            <div style="width:100%;height:100%;position:absolute;top:0;left:0;z-index:2"></div>
          </div>
        </div>
      </figure>`,
      expectedAlt: 'Inline figure graphic',
      expectedGraphics: ['<line', '<path'],
      expectedImages: 1,
      expectedSvgLayers: 3,
      expectedPaths: 2,
      expectedLines: 44,
    },
  ])('keeps $name through Defuddle, sanitization, and Turndown', async (sample) => {
    const doc = new DOMParser().parseFromString(
      `<!doctype html><html><head><title>Visual lesson</title></head><body>
        <main><article>
          <h1>Visual lesson</h1>
          <p>${'This explanatory paragraph establishes the lesson article content. '.repeat(12)}</p>
          ${sample.figure}
          <p>${'The discussion continues after the visual with more explanatory content. '.repeat(12)}</p>
        </article></main>
      </body></html>`,
      'text/html',
    );

    const result = await runScrape(doc, {
      includeImages: false,
      includeVideos: false,
      includeAudio: false,
      includeLinks: false,
      includeStructured: false,
    });
    const markdown = result.article.content_markdown ?? '';
    const encodedImages = Array.from(markdown.matchAll(/data:image\/svg\+xml;base64,([\w+/=]+)/g));
    const decodedImages = encodedImages.map((match) => atob(match[1] ?? ''));

    expect(result.article.extractor).toBe('defuddle');
    expect(markdown).toContain(`![${sample.expectedAlt}](data:image/svg+xml;base64,`);
    for (const graphic of sample.expectedGraphics) {
      expect(decodedImages.some((image) => image.includes(graphic))).toBe(true);
    }
    if (sample.expectedSvgLayers !== undefined) {
      // Captured Mathspace graphs have two 260x7 arrow layers over a 260x260
      // grid. This catches the old same-size filter silently dropping arrows.
      const composite = decodedImages[0] ?? '';
      expect(composite.match(/<svg\b/g) ?? []).toHaveLength(sample.expectedSvgLayers + 1);
      expect(composite.match(/<path\b/g) ?? []).toHaveLength(sample.expectedPaths);
      expect(composite.match(/<line\b/g) ?? []).toHaveLength(sample.expectedLines);
    }
    expect(encodedImages, markdown).toHaveLength(sample.expectedImages);
  });

  it('sanitizes executable SVG markup before encoding the image URL', () => {
    const doc = new DOMParser().parseFromString(
      `<body><figure><svg width="100" height="100" onload="steal()">
        <script>steal()</script>
        <a href="javascript:steal()">unsafe link</a>
        <path d="M0 0 L100 100" />
      </svg></figure></body>`,
      'text/html',
    );

    normalizeSemanticMarkup(doc);
    const src = doc.querySelector('figure img')?.getAttribute('src') ?? '';
    const decoded = atob(src.slice(src.indexOf(',') + 1));

    expect(decoded).toContain('<svg');
    expect(decoded).not.toContain('<script');
    expect(decoded).not.toContain('onload=');
    expect(decoded).not.toContain('javascript:');
  });

  it('keeps Mathspace axes at their measured graph positions and orientation', async () => {
    const doc = new DOMParser().parseFromString(
      `<!doctype html><html><head><title>Coordinate plane</title></head><body><article>
        <h1>Coordinate plane</h1><p>${'Context before the graph. '.repeat(40)}</p>
        <figure><div style="position:relative;width:260px;height:260px">
          <div style="position:absolute;transform:translateY(130px) translateY(calc(-50% - .5px))">
            <svg width="260" height="7" viewBox="0 0 260 7"><path d="M0 3h260" /></svg>
          </div>
          <div style="position:absolute;transform:translateX(129.5px) rotate(90deg)">
            <svg width="260" height="7" viewBox="0 0 260 7"><path d="M0 3h260" /></svg>
          </div>
          <svg width="260" height="260" viewBox="0 0 260 260"><line x1="0" y1="0" x2="260" y2="260" /></svg>
        </div></figure>
        <p>${'Context after the graph. '.repeat(40)}</p>
      </article></body></html>`,
      'text/html',
    );
    const layers = Array.from(doc.querySelectorAll('figure svg'));
    const rect = (left: number, top: number, width: number, height: number) =>
      ({ left, top, width, height }) as DOMRect;
    const rects = [rect(0, 126, 260, 7), rect(126.5, 0, 7, 260), rect(0, 0, 260, 260)];
    for (const [index, layer] of layers.entries()) {
      Object.defineProperty(layer, 'getBoundingClientRect', {
        value: () => rects[index],
      });
    }

    const result = await runScrape(doc, {
      includeImages: false,
      includeVideos: false,
      includeAudio: false,
      includeLinks: false,
      includeStructured: false,
    });
    const encoded = result.article.content_markdown?.match(/base64,([\w+/=]+)/)?.[1] ?? '';
    const composite = atob(encoded);

    // These exact bounds come from the captured Mathspace figure: the
    // horizontal arrow is y=126 and the 7px-wide vertical arrow is x=126.5.
    expect(composite).toContain('transform="translate(0 126)"');
    expect(composite).toContain('transform="translate(133.5 0) rotate(90)"');
  });
});
