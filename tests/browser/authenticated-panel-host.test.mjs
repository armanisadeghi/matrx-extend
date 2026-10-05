import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const source = await readFile(
  new URL('./native-sidepanel-qa-harness.mjs', import.meta.url),
  'utf8',
);
const auth = await readFile(new URL('./settings-native-auth-driver.mjs', import.meta.url), 'utf8');
const body = source.slice(
  source.indexOf('async function observeAuthenticatedPanelHost('),
  source.indexOf('async function activateOwnedSidePanel('),
);

// External Chrome protocol is doubled; the actual measurement expressions,
// correlation, privacy projection and cleanup execute unchanged.
async function checkHost(implementation = body) {
  for (const { changed, panelWindowId, rootWindowId, expectedAssociation } of [
    { changed: false, panelWindowId: 11, rootWindowId: 11, expectedAssociation: true },
    { changed: true, panelWindowId: 22, rootWindowId: 11, expectedAssociation: false },
    // Chromium 141 GetSidePanelContext expects windowId -1 for an opened panel.
    { changed: false, panelWindowId: -1, rootWindowId: 11, expectedAssociation: null },
    { changed: false, panelWindowId: -1, rootWindowId: -1, expectedAssociation: null },
    { changed: false, panelWindowId: undefined, rootWindowId: 11, expectedAssociation: null },
    { changed: false, panelWindowId: 11, rootWindowId: -1, expectedAssociation: null },
  ]) {
    let hostReads = 0;
    const target = {
      disabled: changed,
      getBoundingClientRect: () => ({ x: 40, y: 5, width: 20, height: 20 }),
      contains: () => false,
    };
    const extensionApi = {
      send: async (_method, { expression }) => ({
        result: {
          value: await runInNewContext(expression, {
            chrome: {
              tabs: {
                query: async () => [
                  {
                    id: 1,
                    windowId: rootWindowId,
                    active: !changed,
                    url: 'http://localhost:1234/',
                  },
                  { url: 'https://private.invalid/?token=secret' },
                ],
              },
              windows: {
                getAll: async () => [
                  {
                    id: rootWindowId,
                    focused: !changed,
                    state: changed ? 'minimized' : 'normal',
                    title: 'private email',
                  },
                  ...(changed ? [{ id: 22, focused: true, state: 'normal' }] : []),
                ],
              },
              runtime: {
                getContexts: async () => [
                  {
                    documentUrl: 'chrome-extension://owned/sidepanel.html',
                    windowId: panelWindowId,
                    documentId: 'private-id',
                  },
                ],
              },
            },
          }),
        },
      }),
    };
    const observe = new Function(`${implementation}; return observeAuthenticatedPanelHost;`)();
    const calls = [];
    const result = await observe({
      cdp: {
        send: async (method, args) => {
          calls.push(method);
          assert.deepEqual(args, { targetId: 'owned-root' });
          return { windowId: 71, bounds: { windowState: changed ? 'minimized' : 'normal' } };
        },
      },
      panel: {
        send: async (_method, { expression }) => {
          if (expression.includes('chrome.tabs.query')) {
            hostReads++;
            return extensionApi.send(_method, { expression });
          }
          return {
            result: {
              value: runInNewContext(expression, {
                innerWidth: 360,
                innerHeight: 373,
                document: {
                  querySelectorAll: () => [target],
                  elementFromPoint: () => (changed ? null : target),
                  URL: 'private-url',
                },
              }),
            },
          };
        },
      },
      rootTargetId: 'owned-root',
      rootUrl: 'http://localhost:1234/',
      panelUrl: 'chrome-extension://owned/sidepanel.html',
    });
    assert.deepEqual(JSON.parse(JSON.stringify(result)), {
      native_window: { measured: true, state: changed ? 'minimized' : 'normal' },
      panel_host: {
        measured: true,
        root_unique: true,
        root_active: !changed,
        root_window_present: true,
        root_window_focused: !changed,
        root_window_state: changed ? 'minimized' : 'normal',
        panel_unique: true,
        panel_in_root_window: expectedAssociation,
        focused_window_count: 1,
        window_count: changed ? 2 : 1,
      },
      scrape_hit: {
        measured: true,
        unique: true,
        in_viewport: true,
        hit: changed ? 'none' : 'self',
        disabled: changed,
      },
    });
    assert.equal(hostReads, 1);
    assert.deepEqual(calls, ['Browser.getWindowForTarget']);
  }
}

test('owned host distinguishes minimization, wrong host and missed hit without emitting private data', async () => {
  await checkHost();
});
test('unavailable boundaries stay unmeasured and no authentication error text escapes', async () => {
  const fail = async () => {
    throw new Error('https://private.invalid/?token=secret');
  };
  const observe = new Function(`${body}; return observeAuthenticatedPanelHost;`)();
  assert.deepEqual(await observe({ cdp: { send: fail }, panel: { send: fail } }), {
    native_window: { measured: false },
    panel_host: { measured: false },
    scrape_hit: { measured: false },
  });
});
test('host counterfactuals fail on skipped measurement, wrong correlation and constant result', async () => {
  for (const mutant of [
    body.replace(
      'return observation;',
      `return {"native_window": {"measured": true, "state": "normal"}, "panel_host": {"measured": true, "root_unique": true, "root_active": true, "root_window_present": true, "root_window_focused": true, "root_window_state": "normal", "panel_unique": true, "panel_in_root_window": true, "focused_window_count": 1, "window_count": 1}, "scrape_hit": {"measured": true, "unique": true, "in_viewport": true, "hit": "self", "disabled": false}};`,
    ),
    body.replace('panel.windowId === root.windowId', 'true'),
    body.replace('panel.windowId >= 0', 'true'),
    body.replace('root.windowId >= 0', 'true'),
    body.replace('host?.focused ?? null', 'true'),
    body.replace("hit === target ? 'self'", "hit === target ? 'none'"),
    body.replace(
      'return observation;',
      'return { native_window: { measured: false }, panel_host: { measured: false }, scrape_hit: { measured: false } };',
    ),
  ])
    await assert.rejects(() => checkHost(mutant), assert.AssertionError);
});

const cleanup = auth.slice(
  auth.indexOf('    // Keep cleanup ordered'),
  auth.lastIndexOf('\n  }\n}'),
);
async function checkCleanup(implementation = cleanup) {
  for (const observerFails of [false, true]) {
    const events = [];
    const close = new Function(
      'web',
      'page',
      'observeBoundary',
      `return (async () => { ${implementation} })();`,
    );
    await close(
      { close: async () => events.push('close') },
      { bringToFront: async () => events.push('activate') },
      async (phase) => {
        events.push(phase);
        if (observerFails) throw Error('private');
      },
    );
    assert.deepEqual(events, [
      'member_before_web_close',
      'close',
      'member_after_web_close',
      'activate',
      'member_after_root_activation',
    ]);
  }
}
test('auth cleanup observes each native transition and observer failure cannot interrupt cleanup', async () => {
  await checkCleanup();
});
test('auth cleanup guard rejects skipped observation and activation before close', async () => {
  for (const mutant of [
    cleanup.replace("await observeBoundary('member_after_web_close').catch(() => {});", ''),
    cleanup
      .replace('await web.close();', 'await page.bringToFront();')
      .replace(
        "await page.bringToFront();\n    await observeBoundary('member_after_root_activation')",
        "await web.close();\n    await observeBoundary('member_after_root_activation')",
      ),
  ])
    await assert.rejects(() => checkCleanup(mutant), assert.AssertionError);
});

test('failed optional host observation cannot replace the actual authentication failure', async () => {
  const events = [];
  const signIn = new Function(
    'assert',
    'privateJson',
    'requireSettingsCredential',
    `${auth.slice(auth.indexOf('export async function signInSettings')).replace('export ', '')}; return signInSettings;`,
  )(
    assert,
    async () => {
      throw Error('credential_read_failed');
    },
    () => {},
  );
  await assert.rejects(
    () =>
      signIn({
        mode: 'member',
        page: {
          context: () => ({ newPage: async () => ({ close: async () => events.push('close') }) }),
          bringToFront: async () => events.push('activate'),
        },
        onStage: () => {},
        observeBoundary: async () => {
          throw Error('observer_unavailable');
        },
      }),
    /credential_read_failed/,
  );
  assert.deepEqual(events, ['close', 'activate']);
});
