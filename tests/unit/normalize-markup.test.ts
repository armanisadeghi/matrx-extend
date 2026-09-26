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
  it('keeps an inline chart caption and HTML label with the graphic', async () => {
    const doc = new DOMParser().parseFromString(
      `<!doctype html><html><head><title>Chart lesson</title></head><body><article>
        <h1>Chart lesson</h1><p>${'Context before the graph. '.repeat(40)}</p>
        <figure>
          <svg aria-label="Growth curve" width="100" height="100" viewBox="0 0 100 100">
            <path d="M0 90 L100 10" stroke="blue" />
          </svg>
          <figcaption>Revenue grew from January to March.</figcaption>
          <span>Measured in thousands of dollars.</span>
        </figure>
        <p>${'Context after the graph. '.repeat(40)}</p>
      </article></body></html>`,
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

    expect(result.article.extractor).toBe('defuddle');
    expect(markdown).toContain('![Growth curve](data:image/svg+xml;base64,');
    expect(markdown).toContain('Revenue grew from January to March.');
    expect(markdown).toContain('Measured in thousands of dollars.');
  });

  it('keeps two captioned SVG figures in article order without duplicating either', async () => {
    const doc = new DOMParser().parseFromString(
      `<!doctype html><html><head><title>Quarterly report</title></head><body><article>
        <h1>Quarterly report</h1><p>${'The financial report introduces both measures. '.repeat(20)}</p>
        <figure><svg aria-label="Revenue chart" width="120" height="80" viewBox="0 0 120 80">
          <path d="M0 70 L120 10" /></svg><figcaption>Revenue rose through March.</figcaption></figure>
        <p>The first measure leads into the second measure.</p>
        <figure><svg aria-label="Expense chart" width="120" height="80" viewBox="0 0 120 80">
          <path d="M0 10 L120 60" /></svg><figcaption>Expenses eased after February.</figcaption></figure>
        <p>${'The report closes with the margin outlook. '.repeat(20)}</p>
      </article></body></html>`,
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
    const markers = [
      '![Revenue chart](data:image/svg+xml;base64,',
      'Revenue rose through March.',
      'The first measure leads into the second measure.',
      '![Expense chart](data:image/svg+xml;base64,',
      'Expenses eased after February.',
    ];

    expect(result.article.extractor).toBe('defuddle');
    expect(markdown.match(/data:image\/svg\+xml;base64,/g)).toHaveLength(2);
    expect(markdown.match(/Revenue rose through March\./g)).toHaveLength(1);
    expect(markdown.match(/Expenses eased after February\./g)).toHaveLength(1);
    for (const [index, marker] of markers.entries()) {
      const position = markdown.indexOf(marker);
      expect(position, marker).toBeGreaterThan(
        index === 0 ? -1 : markdown.indexOf(markers[index - 1] ?? ''),
      );
    }
  });

  it('keeps a layered SVG caption and a regular image in surrounding article text', async () => {
    const doc = new DOMParser().parseFromString(
      `<!doctype html><html><head><title>Geometry field notes</title></head><body><article>
        <h1>Geometry field notes</h1><p>${'The plotted coordinates explain the measured route. '.repeat(20)}</p>
        <figure><svg width="120" height="80" viewBox="0 0 120 80"><line x1="0" y1="40" x2="120" y2="40" /></svg>
          <svg width="120" height="80" viewBox="0 0 120 80"><path d="M0 70 L120 10" /></svg>
          <figcaption>Route crosses the central axis.</figcaption><span>Scale: ten meters per unit.</span>
        </figure>
        <p>A field photograph documents the same route.</p>
        <img src="https://images.example.org/route-photo.png" alt="Survey route photograph" width="320" height="180" />
        <p>${'The observations continue after the photograph. '.repeat(20)}</p>
      </article></body></html>`,
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
    const encoded = markdown.match(/data:image\/svg\+xml;base64,([\w+/=]+)/)?.[1] ?? '';
    const plottedSvg = atob(encoded);

    expect(result.article.extractor).toBe('defuddle');
    expect(markdown.match(/data:image\/svg\+xml;base64,/g)).toHaveLength(1);
    expect(plottedSvg).toContain('<line');
    expect(plottedSvg).toContain('<path');
    expect(markdown).toContain('Route crosses the central axis.');
    expect(markdown).toContain('Scale: ten meters per unit.');
    expect(markdown).toContain(
      '![Survey route photograph](https://images.example.org/route-photo.png)',
    );
    expect(markdown.indexOf('Route crosses the central axis.')).toBeLessThan(
      markdown.indexOf('A field photograph documents the same route.'),
    );
    expect(markdown.indexOf('A field photograph documents the same route.')).toBeLessThan(
      markdown.indexOf('Survey route photograph'),
    );
    expect(markdown.indexOf('Survey route photograph')).toBeLessThan(
      markdown.indexOf('The observations continue after the photograph.'),
    );
  });

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
            <svg class="JXGsvg" width="260" height="260" viewBox="0 0 260 260">
              <path d=" M2 258 C45 4 95 245 140 125 S220 20 258 180" stroke="#03A887" stroke-width="2px" fill="none" fill-opacity="0" />
            </svg>
            <div style="width:100%;height:100%;position:absolute;top:0;left:0;z-index:2"></div>
          </div>
        </div>
      </figure>`,
      expectedAlt: 'Inline figure graphic',
      expectedGraphics: ['<line', '<path'],
      expectedImages: 1,
      expectedSvgLayers: 4,
      expectedPaths: 3,
      expectedLines: 44,
      expectedCurve: 'stroke="#03A887" stroke-width="2px" fill="none" fill-opacity="0"',
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
    if (sample.expectedCurve !== undefined) {
      expect(decodedImages.some((image) => image.includes(sample.expectedCurve))).toBe(true);
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

  it('reports an SVG whose executable child strips its curve instead of encoding a blank graph', () => {
    const doc = new DOMParser().parseFromString(
      `<body><figure><svg width="100" height="100" onload="steal()">
        <script>steal()</script>
        <a href="javascript:steal()">unsafe link</a>
        <path d="M0 0 L100 100" />
      </svg></figure></body>`,
      'text/html',
    );

    normalizeSemanticMarkup(doc);
    expect(doc.querySelector('figure')).toBeNull();
    expect(doc.body.textContent).toContain(
      'Inline figure graphic was omitted because this capture could not preserve it completely.',
    );
  });

  it('reports an unsupported layered figure instead of emitting a partial graph', async () => {
    const doc = new DOMParser().parseFromString(
      `<!doctype html><html><head><title>Visual lesson</title></head><body><article>
        <h1>Visual lesson</h1><p>${'Before the figure. '.repeat(40)}</p>
        <figure><svg width="260" height="260" viewBox="0 0 260 260">
          <line x1="0" y1="0" x2="260" y2="260" />
          <foreignObject width="260" height="260"><div>Unsupported visual layer</div></foreignObject>
        </svg><svg width="260" height="260" viewBox="0 0 260 260">
          <path d="M2 258 C45 4 95 245 140 125 S220 20 258 180" stroke="#03A887" stroke-width="2px" fill="none" fill-opacity="0" />
        </svg></figure><p>${'After the figure. '.repeat(40)}</p>
      </article></body></html>`,
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

    expect(markdown).toContain(
      'Inline figure graphic was omitted because this capture could not preserve it completely.',
    );
    expect(markdown).not.toContain('data:image/svg+xml;base64,');
  });

  it('keeps a Mathspace-style empty foreignObject overlay with the plotted curve', async () => {
    const doc = new DOMParser().parseFromString(
      `<!doctype html><html><head><title>Visual lesson</title></head><body><article>
        <h1>Visual lesson</h1><p>${'Before the figure. '.repeat(40)}</p>
        <figure><svg width="260" height="260" viewBox="0 0 260 260">
          <line x1="0" y1="0" x2="260" y2="260" />
          <foreignObject x="0" y="0" width="100%" height="100%"></foreignObject>
        </svg><svg width="260" height="260" viewBox="0 0 260 260">
          <path d="M2 258 C45 4 95 245 140 125 S220 20 258 180" stroke="#03A887" stroke-width="2px" fill="none" fill-opacity="0" />
        </svg></figure><p>${'After the figure. '.repeat(40)}</p>
      </article></body></html>`,
      'text/html',
    );

    const result = await runScrape(doc, {
      includeImages: false,
      includeVideos: false,
      includeAudio: false,
      includeLinks: false,
      includeStructured: false,
    });
    const payload = result.article.content_markdown?.match(/base64,([\w+/=]+)/)?.[1] ?? '';
    const composite = atob(payload);

    expect(composite).toContain('stroke="#03A887"');
    expect(composite).toContain('stroke-width="2px"');
    expect(composite).toContain('fill-opacity="0"');
  });

  it('reports a Mathspace renderer shell that still has no plotted graphics', async () => {
    const doc = new DOMParser().parseFromString(
      `<!doctype html><html><head><title>Visual lesson</title></head><body><article>
        <h1>Visual lesson</h1><p>${'Before the figure. '.repeat(40)}</p>
        <figure>
          <svg width="260" height="260"><line x1="0" y1="130" x2="260" y2="130" /></svg>
          <svg class="JXGsvg" width="260" height="260"><defs><filter id="f"></filter></defs>
            <foreignObject x="0" y="0" width="100%" height="100%"></foreignObject>
          </svg>
        </figure><p>${'After the figure. '.repeat(40)}</p>
      </article></body></html>`,
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

    expect(markdown).toContain(
      'Inline figure graphic was omitted because this capture could not preserve it completely.',
    );
    expect(markdown).not.toContain('data:image/svg+xml;base64,');
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
