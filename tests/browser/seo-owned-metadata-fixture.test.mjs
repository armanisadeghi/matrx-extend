import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { Window } from 'happy-dom';
import { serveOwnedFixture } from './owned-fixture-server.mjs';
import {
  OWNED_SEO_METADATA_PAGES,
  OWNED_SEO_METADATA_PATH,
  OWNED_SEO_METADATA_TITLE,
  inspectOwnedSeoMetadataDom,
  requireOwnedSeoMetadataCandidates,
} from './seo-owned-metadata-fixture.mjs';

async function servedDom(html, url = 'http://127.0.0.1:43127/seo-metadata-article') {
  const window = new Window({ url });
  window.document.write(html);
  await window.happyDOM.whenAsyncComplete();
  return window;
}

test('owned SEO fixture serves one real hreflang door and one JSON-LD Article door', async () => {
  const server = createServer((request, response) =>
    serveOwnedFixture(request, response, {
      ownedPages: OWNED_SEO_METADATA_PAGES,
      rootPage: '<h1>Fixture index</h1>',
    }),
  );
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${origin}${OWNED_SEO_METADATA_PATH}`);
    assert.equal(response.status, 200);
    const html = await response.text();
    const window = await servedDom(html, `${origin}${OWNED_SEO_METADATA_PATH}`);
    try {
      const source = inspectOwnedSeoMetadataDom(window.document);
      const doors = requireOwnedSeoMetadataCandidates(source, {
        title: OWNED_SEO_METADATA_TITLE,
        alternate: {
          lang: 'es',
          href: new URL('/seo-metadata-article-es', origin).href,
        },
      });
      assert.deepEqual(doors, {
        uniqueAlternate: {
          lang: 'es',
          href: new URL('/seo-metadata-article-es', origin).href,
        },
        uniqueSchema: { type: 'Article', href: 'https://schema.org/Article' },
      });
      assert.equal((await fetch(`${origin}/unowned`)).status, 404);
    } finally {
      window.happyDOM.abort();
    }
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test('owned SEO candidate oracle rejects altered href and JSON-LD type', async () => {
  const changedHref = await servedDom(
    OWNED_SEO_METADATA_PAGES[OWNED_SEO_METADATA_PATH].replace(
      '/seo-metadata-article-es',
      '/different-spanish-page',
    ),
  );
  const changedType = await servedDom(
    OWNED_SEO_METADATA_PAGES[OWNED_SEO_METADATA_PATH].replace(
      '"@type":"Article"',
      '"@type":"Product"',
    ),
  );
  try {
    const expected = {
      title: OWNED_SEO_METADATA_TITLE,
      alternate: {
        lang: 'es',
        href: 'http://127.0.0.1:43127/different-spanish-page',
      },
    };
    assert.throws(
      () =>
        requireOwnedSeoMetadataCandidates(inspectOwnedSeoMetadataDom(changedHref.document), {
          ...expected,
          alternate: {
            lang: 'es',
            href: 'http://127.0.0.1:43127/seo-metadata-article-es',
          },
        }),
      /source DOM hreflang is exact/,
    );
    assert.throws(
      () =>
        requireOwnedSeoMetadataCandidates(inspectOwnedSeoMetadataDom(changedType.document), {
          title: OWNED_SEO_METADATA_TITLE,
          alternate: {
            lang: 'es',
            href: 'http://127.0.0.1:43127/seo-metadata-article-es',
          },
        }),
      /source DOM has exactly one Article type/,
    );
  } finally {
    changedHref.happyDOM.abort();
    changedType.happyDOM.abort();
  }
});

test('owned SEO candidate oracle refuses absent hreflang or JSON-LD doors', async () => {
  const noAlternate = await servedDom(
    OWNED_SEO_METADATA_PAGES[OWNED_SEO_METADATA_PATH].replace(/\s*<link rel="alternate"[^>]+>/, ''),
  );
  const noSchema = await servedDom(
    OWNED_SEO_METADATA_PAGES[OWNED_SEO_METADATA_PATH].replace(
      /\s*<script type="application\/ld\+json">.*?<\/script>/,
      '',
    ),
  );
  try {
    const expected = {
      title: OWNED_SEO_METADATA_TITLE,
      alternate: {
        lang: 'es',
        href: 'http://127.0.0.1:43127/seo-metadata-article-es',
      },
    };
    assert.throws(
      () =>
        requireOwnedSeoMetadataCandidates(
          inspectOwnedSeoMetadataDom(noAlternate.document),
          expected,
        ),
      /source DOM has exactly one hreflang candidate/,
    );
    assert.throws(
      () =>
        requireOwnedSeoMetadataCandidates(inspectOwnedSeoMetadataDom(noSchema.document), expected),
      /source DOM has exactly one Article type/,
    );
  } finally {
    noAlternate.happyDOM.abort();
    noSchema.happyDOM.abort();
  }
});
