import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { withClipboardReadPermission } from './clipboard-observation.mjs';

// SUT owns extension origin routing and the grant -> read -> restore lifetime.
// Transport and native clipboard are external. No clipboard contents are logged.
async function exercise(sut) {
  for (const [host, original, contents] of [
    ['cihdmkcdjjckfhjpgoedmgfpoljebaml', 'prompt', 'first-private-observation'],
    ['abcdefghijklmnopabcdefghijklmnop', 'denied', 'second-private-observation'],
  ]) {
    for (const failure of [null, 'grant', 'read', 'restore']) {
      const calls = [];
      const evidence = {};
      const promise = sut({
        panelUrl: `chrome-extension://${host}/sidepanel.html`,
        evidence,
        panel: {
          async send() {
            return { result: { value: original } };
          },
        },
        browserSession: {
          async send(method, params) {
            calls.push({ method, ...params });
            if (
              (failure === 'grant' && params.setting === 'granted') ||
              (failure === 'restore' && params.setting === original)
            )
              throw new Error('transport');
          },
        },
        async read() {
          calls.push('read');
          if (failure === 'read') throw new Error('read');
          return contents;
        },
      });
      if (failure) await assert.rejects(promise);
      else assert.equal(await promise, contents);
      const packet = (setting) => ({
        method: 'Browser.setPermission',
        permission: { name: 'clipboard-read' },
        setting,
        origin: `chrome-extension://${host}`,
      });
      assert.deepEqual(
        calls,
        failure === 'grant'
          ? [packet('granted'), packet(original)]
          : [packet('granted'), 'read', packet(original)],
      );
      assert.equal(evidence.clipboardObservationPermissionRestored, failure !== 'restore');
    }
  }
  for (const panelUrl of [
    'https://www.aimatrx.com/sidepanel.html',
    'chrome-extension://invalid/sidepanel.html',
  ]) {
    await assert.rejects(sut({ panelUrl }), /origin_refused/);
  }
  await assert.rejects(
    sut({
      panelUrl: 'chrome-extension://cihdmkcdjjckfhjpgoedmgfpoljebaml/sidepanel.html',
      panel: {
        async send() {
          return { result: { value: 'unknown' } };
        },
      },
    }),
    /permission_state_unavailable/,
  );
}
await exercise(withClipboardReadPermission);
// Isolated in-memory mutations: origin regression, missing restore, wrong
// permission, omitted read and constant-return gut check must each go red.
const source = await readFile(new URL('./clipboard-observation.mjs', import.meta.url), 'utf8');
const variants = [
  source.replace('`${url.protocol}//${url.host}`', 'url.origin'),
  source.replace(
    "await browserSession.send('Browser.setPermission', { permission, setting: original, origin });",
    '',
  ),
  source.replace(
    "const permission = { name: 'clipboard-read' };",
    "const permission = { name: 'clipboard-write' };",
  ),
  source.replace('return await read();', "return 'first-private-observation';"),
  "export async function withClipboardReadPermission() { return 'first-private-observation'; }",
];
for (const variant of variants) {
  assert.notEqual(variant, source);
  const mutant = await import(
    `data:text/javascript;base64,${Buffer.from(variant).toString('base64')}`
  );
  await assert.rejects(exercise(mutant.withClipboardReadPermission));
}
// Reproduce the installed Playwright normalization failure without launching:
// server BrowserContext.grantPermissions runs new URL(origin).origin.
const extensionOrigin = new URL(
  'chrome-extension://cihdmkcdjjckfhjpgoedmgfpoljebaml/sidepanel.html',
).origin;
assert.equal(extensionOrigin, 'null');
assert.throws(() => new URL(extensionOrigin), { code: 'ERR_INVALID_URL' });
console.log(
  'PASS clipboard observation lifetime; five unsafe mutations rejected; origin defect reproduced',
);
