import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { test } from 'node:test';
import { serveOwnedFixture } from './owned-fixture-server.mjs';

const path = join(import.meta.dirname, 'fixtures/form-controls.html');
const page = await readFile(path, 'utf8');
const inventory = JSON.parse(
  await readFile(join(import.meta.dirname, '../../docs/stabilization/inventory.json'), 'utf8'),
);
const cases = [];
function collect(value) {
  if (!value || typeof value !== 'object') return;
  if (/^EXT-F-406[1-9]$/.test(value.id ?? '')) cases.push(value);
  else for (const child of Object.values(value)) collect(child);
}
collect(inventory);

test('owned page covers every reviewed form-control selector and observable', () => {
  assert.equal(cases.length, 9);
  const ids = [...page.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, 'fixture IDs must be unique');
  for (const feature of cases) {
    const procedure = feature.cases[0];
    const selectors = [...JSON.stringify(procedure.steps).matchAll(/#([a-z][a-z-]*)/g)].map(
      (match) => match[1],
    );
    for (const selector of selectors.filter((value) => !value.startsWith('missing-'))) {
      assert.ok(ids.includes(selector), `${feature.id} requires #${selector}`);
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
