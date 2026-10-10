import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { Window } from 'happy-dom';
import { register } from 'tsx/esm/api';
register();
import { serveOwnedFixture } from './owned-fixture-server.mjs';
import { panelOpenerHtml } from './owned-panel-opener.mjs';
const extensionId = 'cihdmkcdjjckfhjpgoedmgfpoljebaml';
test('owned fixture navigation restores opener without changing assigned page or extraction content', async () => {
  const server = createServer((req, res) =>
    serveOwnedFixture(req, res, {
      rootPage: '<article>Root</article>',
      ownedPages: {
        '/capture-on':
          '<html><title>Harbor Dental</title><body><article><h1>Morning appointments</h1><p>Appointments begin at eight.</p></article></body></html>',
        '/capture-off':
          '<html><title>Harbor Dental</title><body><article><h1>Afternoon appointments</h1><p>Appointments begin at two.</p></article></body></html>',
      },
      ownedPageSuffix: panelOpenerHtml(extensionId, true),
    }),
  );
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const [path, marker] of [
      ['/capture-on', 'Morning appointments'],
      ['/capture-off', 'Afternoon appointments'],
    ]) {
      const url = origin + path;
      const response = await fetch(url);
      const html = await response.text();
      const window = new Window({ url });
      window.document.write(html);
      for (const key of [
        'window',
        'document',
        'DOMParser',
        'Node',
        'Element',
        'HTMLElement',
        'HTMLImageElement',
        'HTMLAnchorElement',
      ])
        globalThis[key] = key === 'window' ? window : window[key];
      const { runScrape } = await import('../../src/lib/scrape/pipeline.ts');
      const plain = new Window({ url });
      plain.document.write(html.split('<script>')[0]);
      const beforeCapture = await runScrape(plain.document, { baseUrl: url });
      let calls = 0;
      window.chrome = {
        runtime: {
          sendMessage(id, message, reply) {
            assert.equal(id, extensionId);
            assert.equal(message.action, 'openPanel');
            calls++;
            reply({ ok: true, result: { opened: true } });
          },
        },
      };
      const script = window.document.querySelector('script');
      assert.ok(script, 'registered navigated page must contain the canonical opener');
      window.eval(script.textContent);
      script.remove();
      const root = window.document.querySelector('#native-owned-panel-opener').shadowRoot;
      root.querySelector('#open-panel').click();
      assert.equal(calls, 1);
      assert.equal(JSON.parse(root.querySelector('#result').textContent).result.opened, true);
      assert.equal(window.location.href, url);
      assert.equal(window.document.querySelector('article h1').textContent, marker);
      const extraction = window.document.cloneNode(true);
      assert.equal(extraction.querySelector('#open-panel'), null);
      assert.doesNotMatch(extraction.body.textContent, /Open panel|opened|sendMessage/);
      assert.equal(extraction.querySelector('article h1').textContent, marker);
      const afterCapture = await runScrape(window.document, { baseUrl: url });
      for (const field of ['article', 'metadata', 'images', 'videos', 'audio', 'links', 'ld_json'])
        assert.deepEqual(
          afterCapture[field],
          beforeCapture[field],
          `canonical scrape ${field} must ignore opener shadow controls`,
        );
      const { fetched_at: beforeTime, ...beforeSeo } = beforeCapture.seo;
      const { fetched_at: afterTime, ...afterSeo } = afterCapture.seo;
      assert.ok(Number.isFinite(beforeTime) && Number.isFinite(afterTime));
      assert.deepEqual(afterSeo, beforeSeo);
      assert.ok(JSON.stringify(afterCapture.article).includes(marker));
      assert.doesNotMatch(
        JSON.stringify(afterCapture.article),
        /Open panel|sendMessage|native-owned-panel-opener/,
      );
      plain.happyDOM.abort();
      window.happyDOM.abort();
    }
    const unrelated = await fetch(`${origin}/unregistered`);
    assert.equal(unrelated.status, 404);
    assert.doesNotMatch(await unrelated.text(), /open-panel|sendMessage/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
