import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { runForcedNoticeReload } from './seo-notice-reload-fixture.mjs';

// The SUT owns real request classification, reload ordering, notice and hit
// assertions, trusted-click routing and cleanup. Only CDP/DOM IO is doubled.
async function run(breakage = '', sut = runForcedNoticeReload) {
  let listener;
  let clickListener;
  const documentContext = vm.createContext({
    document: {
      addEventListener: (_name, fn) => {
        clickListener = fn;
      },
    },
  });
  let reloaded = false;
  let refused = false;
  let dismissed = false;
  let disabled = false;
  let detached = false;
  const calls = [];
  const pageUrl = 'https://www.iana.org/domains/reserved';
  const sample = () => ({
    active: true,
    target_count: 1,
    target_enabled: true,
    database_refused_notice_count: refused && !dismissed ? 1 : 0,
    dismiss_visible: refused && !dismissed && breakage !== 'missing-dismiss',
    hit_point_count:
      (reloaded && breakage === 'target-occluded') ||
      (dismissed && breakage === 'dismiss-target-occluded')
        ? 0
        : 9,
    notice_hit_point_count:
      (reloaded && breakage === 'notice-occludes') ||
      (dismissed && breakage === 'dismiss-notice-occludes')
        ? 9
        : 0,
  });
  const panel = {
    on: (_name, fn) => {
      listener = fn;
      return () => {
        detached = true;
      };
    },
    send: async (method, params) => {
      calls.push(method);
      if (method === 'Page.reload') {
        reloaded = true;
        listener({
          requestId: 'owned-read',
          request: {
            method: 'GET',
            url: `https://db.invalid/rest/v1/wbx_seo_audit?url=eq.${encodeURIComponent(
              breakage === 'wrong-url' ? 'https://unrelated.invalid/' : pageUrl,
            )}`,
            headers: { 'Accept-Profile': 'extend' },
          },
        });
      }
      if (method === 'Fetch.fulfillRequest') {
        assert.equal(reloaded, true, 'failure originates after reload');
        assert.equal(params.responseCode, 403);
        assert.equal(JSON.parse(Buffer.from(params.body, 'base64')).code, '42501');
        if (breakage === 'delivery-failure') throw new Error('response not delivered');
        refused = true;
      }
      if (method === 'Fetch.disable') disabled = true;
    },
  };
  try {
    const result = await sut({
      panel,
      pageUrl,
      title: 'IANA-managed Reserved Domains',
      selectedSeo: async () => ({
        mainTablists: 1,
        seoTabs: 1,
        selected: true,
        documentTimeOrigin: reloaded && breakage !== 'same-document' ? 2 : 1,
      }),
      seoContent: async () => ({
        scopeValid: true,
        title: breakage === 'stale-title' ? 'Example Domain' : 'IANA-managed Reserved Domains',
        reAudit: true,
        error: false,
      }),
      io: {
        evaluate: async (_panel, expression) =>
          expression === 'innerWidth'
            ? breakage === 'wrong-width'
              ? 480
              : 360
            : vm.runInContext(expression, documentContext),
        hit: async () => sample(),
        click: async (_panel, kind) => {
          assert.equal(kind, 'seo-database-refused-dismiss');
          assert.equal(refused, true, 'second Dismiss follows delivered reload refusal');
          calls.push('trusted-dismiss');
          clickListener?.({
            isTrusted: breakage !== 'untrusted-click',
            target: {
              closest: () => ({
                getAttribute: () => (breakage === 'wrong-dismiss' ? 'Other' : 'Dismiss'),
                closest: () => ({
                  textContent:
                    'Saved audits unavailable: the database refused the request because your account is not allowed',
                }),
              }),
            },
          });
          if (breakage !== 'dismiss-no-effect') dismissed = true;
        },
        waitFor: async (name, read, accept) => {
          await Promise.resolve();
          const value = await read();
          assert.ok(accept(value), name);
          return value;
        },
      },
    });
    assert.equal(disabled, true);
    assert.equal(detached, true);
    return { result, calls };
  } catch (error) {
    if (reloaded) {
      assert.equal(disabled, true);
      assert.equal(detached, true);
    }
    throw error;
  }
}

test('forced reload requires actual request refusal, distinct document and second Dismiss clearance', async () => {
  const { result, calls } = await run();
  assert.deepEqual(calls, [
    'Fetch.enable',
    'Page.reload',
    'Fetch.fulfillRequest',
    'trusted-dismiss',
    'Fetch.disable',
  ]);
  assert.equal(result.refusedHistoryReads, 1);
  assert.equal(result.visible.database_refused_notice_count, 1);
  assert.equal(result.dismissed.database_refused_notice_count, 0);
  assert.equal(result.dismissed.hit_point_count, 9);
});

for (const defect of [
  'wrong-url',
  'same-document',
  'delivery-failure',
  'stale-title',
  'wrong-width',
  'untrusted-click',
  'wrong-dismiss',
  'missing-dismiss',
  'target-occluded',
  'notice-occludes',
  'dismiss-no-effect',
  'dismiss-target-occluded',
  'dismiss-notice-occludes',
])
  test(`forced reload rejects ${defect}`, async () => {
    await assert.rejects(run(defect));
  });

test('gut check rejects a helper that skips the forcing chain', async () => {
  await assert.rejects(run('', async () => ({})));
});

test('mutants prove independent hit ownership and second Dismiss guards force failure', async () => {
  const source = readFileSync(
    new URL('./seo-notice-reload-fixture.mjs', import.meta.url),
    'utf8',
  ).replaceAll(
    /from '(\.\/[^']+)'/g,
    (_all, path) => `from '${new URL(path, import.meta.url).href}'`,
  );
  for (const [removed, defect] of [
    [
      "assert.equal(sample.hit_point_count, 9, 'reload Re-audit owns all nine sampled points');",
      'target-occluded',
    ],
    [
      "assert.equal(sample.notice_hit_point_count, 0, 'reload notice owns no sampled point');",
      'notice-occludes',
    ],
  ]) {
    assert.ok(source.includes(removed));
    const mutant = await import(
      `data:text/javascript;base64,${Buffer.from(source.replace(removed, '')).toString('base64')}`
    );
    await assert.doesNotReject(run(defect, mutant.runForcedNoticeReload));
  }
});
