import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { test } from 'node:test';
import { serveOwnedFixture } from './owned-fixture-server.mjs';

const path = join(import.meta.dirname, 'fixtures/form-controls.html');
const page = await readFile(path, 'utf8');
// Reviewed selector inputs extracted from the case procedures before evidence left Git.
// CI validates the owned page without reading a machine-local operational inventory.
const cases = JSON.parse(
  await readFile(join(import.meta.dirname, 'fixtures/form-control-selector-contract.json'), 'utf8'),
).cases;

test('owned page covers every reviewed form-control selector and observable', () => {
  assert.equal(cases.length, 9);
  const ids = [...page.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, 'fixture IDs must be unique');
  for (const feature of cases) {
    for (const selector of feature.selectors) {
      assert.ok(ids.includes(selector), `${feature.featureId} requires #${selector}`);
    }
  }
  for (const event of [
    'keydown',
    'keypress',
    'keyup',
    'input',
    'mouseover',
    'mouseenter',
    'mousemove',
    'focus',
    'blur',
    'contextmenu',
    'click',
    'change',
    'submit',
  ]) {
    assert.match(page, new RegExp(`['"]${event}['"]`), `missing ${event} observer`);
  }
  for (const key of [
    'keys:',
    'choice:',
    'consent:',
    'selectedRadio:',
    'activeElement:',
    'lastContext,',
    'lastSubmit,',
    'counters,',
  ])
    assert.ok(page.includes(key), `missing ${key} readback`);
  assert.match(page, /event\.preventDefault\(\);[\s\S]*?lastSubmit/);
  assert.match(page, /form-action 'none'/);
  assert.match(page, /new FormData\(event\.currentTarget\)\.get\('payload'\)/);
  assert.match(page, /event\.submitter\?\.id/);
  assert.match(page, /id="radio-a"[^>]*checked/);
  assert.match(page, /id="keys" value="seed"/);
  assert.match(page, /id="choice"[\s\S]*?value="alpha"[\s\S]*?value="beta"/);
});

test('existing owned fixture server serves exact page and refuses unknown paths', async () => {
  const server = createServer((request, response) =>
    serveOwnedFixture(request, response, {
      ownedPages: { '/form-controls': page },
      rootPage: '<h1>Root</h1>',
    }),
  );
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const fixture = await fetch(`${base}/form-controls`);
    assert.equal(fixture.status, 200);
    assert.equal(
      createHash('sha256')
        .update(await fixture.text())
        .digest('hex'),
      createHash('sha256').update(page).digest('hex'),
    );
    assert.equal((await fetch(`${base}/missing-form`)).status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
