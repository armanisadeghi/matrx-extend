import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { serveOwnedFixture } from './owned-fixture-server.mjs';
import { intakeImage } from './scrape-media-fixture.mjs';

test('owned image fixture is served as image bytes and unowned routes are refused', async () => {
  const server = createServer((request, response) =>
    serveOwnedFixture(request, response, {
      ownedPages: { '/intake': '<h1>Intake</h1>' },
      ownedAssets: { '/intake.svg': { contentType: 'image/svg+xml', body: intakeImage } },
      rootPage: '<h1>Root</h1>',
    }),
  );
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const image = await fetch(`${origin}/intake.svg`);
    assert.equal(image.status, 200);
    assert.match(image.headers.get('content-type') ?? '', /^image\/svg\+xml/);
    assert.equal(await image.text(), intakeImage);
    assert.match(intakeImage, /width="640" height="480"/);
    assert.equal((await fetch(`${origin}/intake`)).status, 200);
    assert.equal((await fetch(`${origin}/missing.svg`)).status, 404);
    assert.equal((await fetch(`${origin}/etc/passwd`)).status, 404);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
