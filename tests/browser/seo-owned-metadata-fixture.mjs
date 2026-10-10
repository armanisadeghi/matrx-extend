import assert from 'node:assert/strict';

export const OWNED_SEO_METADATA_PATH = '/seo-metadata-article';
export const OWNED_SEO_METADATA_ES_PATH = '/seo-metadata-article-es';
export const OWNED_SEO_METADATA_TITLE = 'Harbor Dental appointment guide';

export const OWNED_SEO_METADATA_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${OWNED_SEO_METADATA_TITLE}</title>
  <link rel="alternate" hreflang="es" href="${OWNED_SEO_METADATA_ES_PATH}">
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","headline":"${OWNED_SEO_METADATA_TITLE}"}</script>
</head>
<body><main><h1>${OWNED_SEO_METADATA_TITLE}</h1><p>A patient guide to preparing for a routine dental appointment.</p></main></body>
</html>`;

export const OWNED_SEO_METADATA_ES_HTML = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>Guía de citas de Harbor Dental</title></head>
<body><main><h1>Guía de citas de Harbor Dental</h1></main></body></html>`;

export const OWNED_SEO_METADATA_PAGES = {
  [OWNED_SEO_METADATA_PATH]: OWNED_SEO_METADATA_HTML,
  [OWNED_SEO_METADATA_ES_PATH]: OWNED_SEO_METADATA_ES_HTML,
};

// Called both in the native page and by the DOM-backed forcing tests. The
// candidate values come from rendered source HTML, never from this fixture's
// expected-output constants.
export function inspectOwnedSeoMetadataDom(document = globalThis.document) {
  const alternates = [...document.querySelectorAll('link[rel~="alternate"][hreflang]')]
    .map((node) => ({ lang: node.getAttribute('hreflang')?.trim() ?? '', href: node.href }))
    .filter((item) => item.lang && /^https?:/.test(item.href));
  const schemaTypes = new Set();
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      JSON.parse(script.textContent, (key, value) => {
        if (key === '@type') {
          for (const type of Array.isArray(value) ? value : [value]) {
            if (typeof type === 'string' && type.trim()) schemaTypes.add(type.trim());
          }
        }
        return value;
      });
    } catch {
      // Invalid source JSON-LD is not a candidate.
    }
  }
  return {
    title: document.title.trim(),
    alternates,
    schemaTypes: [...schemaTypes],
  };
}

export function requireOwnedSeoMetadataCandidates(source, expected) {
  assert.equal(source.title, expected.title, 'owned SEO fixture title matches the source DOM');
  assert.equal(source.alternates.length, 1, 'source DOM has exactly one hreflang candidate');
  assert.deepEqual(source.alternates, [expected.alternate], 'source DOM hreflang is exact');
  assert.deepEqual(source.schemaTypes, ['Article'], 'source DOM has exactly one Article type');
  return {
    uniqueAlternate: source.alternates[0],
    uniqueSchema: { type: source.schemaTypes[0], href: 'https://schema.org/Article' },
  };
}
