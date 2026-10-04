import assert from 'node:assert/strict';
import test from 'node:test';
import { runNativeResourceAction } from './native-resource-boundary.mjs';
import {
  enterMediaField,
  observeVideoLinks,
  videoLinksVerdict,
} from './scrape-native-media-actions.mjs';

const openUrl = 'http://127.0.0.1:4021/intake-walkthrough.mp4';
const copyUrl = 'http://127.0.0.1:4021/referral-walkthrough.mp4';

function controls({ openedUrl = openUrl, copiedUrl = copyUrl, failGateAt = 0, loadError } = {}) {
  const actions = [];
  let gateCalls = 0;
  const panel = { send: async (method, args) => actions.push(['send', method, args]) };
  const click = async (_panel, kind, target) => actions.push(['click', kind, target]);
  const resourceAction = (action) =>
    runNativeResourceAction(async () => {
      gateCalls++;
      if (gateCalls === failGateAt)
        throw new Error('NATIVE_RESOURCE_BOUNDARY_REFUSED:stale_health');
      actions.push(['gate', gateCalls]);
    }, action);
  const opened = {
    waitForLoadState: async () => {
      if (loadError) throw loadError;
    },
    url: () => openedUrl,
    close: async () => undefined,
  };
  const page = { context: () => ({ waitForEvent: async () => opened }) };
  const evaluate = async () => copiedUrl;
  return { actions, panel, click, resourceAction, page, evaluate };
}

test('media click and text insertion each require a fresh resource gate', async () => {
  const healthy = controls();
  await enterMediaField({ ...healthy, field: 'src', value: openUrl });
  assert.deepEqual(healthy.actions, [
    ['gate', 1],
    ['click', 'scrape-media-form-field', 'src'],
    ['gate', 2],
    ['send', 'Input.insertText', { text: openUrl }],
  ]);
  const refused = controls({ failGateAt: 2 });
  await assert.rejects(
    enterMediaField({ ...refused, field: 'alt', value: 'New patient intake' }),
    /NATIVE_RESOURCE_BOUNDARY_REFUSED:stale_health/,
  );
  assert.deepEqual(refused.actions, [
    ['gate', 1],
    ['click', 'scrape-media-form-field', 'alt'],
  ]);
});

test('video open and copy refuse the native run when resource health fails', async () => {
  for (const failGateAt of [1, 2]) {
    const deps = controls({ failGateAt });
    await assert.rejects(
      observeVideoLinks({ ...deps, urls: [openUrl, copyUrl] }),
      /NATIVE_RESOURCE_BOUNDARY_REFUSED:stale_health/,
    );
    assert.equal(deps.actions.filter(([kind]) => kind === 'click').length, failGateAt - 1);
  }
});

test('failed native link action aborts instead of becoming partial observation', async () => {
  for (const failedAction of ['scrape-media-open', 'scrape-media-copy']) {
    const deps = controls();
    deps.click = async (_panel, kind) => {
      if (kind === failedAction) throw new Error(`${kind}_action_failed`);
    };
    await assert.rejects(
      observeVideoLinks({ ...deps, urls: [openUrl, copyUrl] }),
      new RegExp(`${failedAction}_action_failed`),
    );
  }
});

test('observed URL and clipboard mismatches are failures, not limitations', async () => {
  const deps = controls({ openedUrl: copyUrl, copiedUrl: openUrl });
  const result = await observeVideoLinks({ ...deps, urls: [openUrl, copyUrl] });
  assert.deepEqual(result.limitations, []);
  assert.deepEqual(result.failures, [
    `video_open_url_mismatch:${copyUrl}`,
    `video_clipboard_url_mismatch:${openUrl}`,
  ]);
  assert.deepEqual(
    deps.actions.filter(([kind]) => kind === 'click'),
    [
      ['click', 'scrape-media-open', openUrl],
      ['click', 'scrape-media-copy', copyUrl],
    ],
  );
});

test('unavailable native observations remain partial with bounded diagnostics', async () => {
  const deps = controls();
  deps.page = {
    context: () => ({
      waitForEvent: async () => {
        throw new Error('page_observation_unavailable');
      },
    }),
  };
  deps.evaluate = async () => {
    throw new Error('clipboard_observation_unavailable');
  };
  const result = await observeVideoLinks({ ...deps, urls: [openUrl, copyUrl] });
  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.limitations, [
    'open_unavailable:page_observation_unavailable',
    'copy_unavailable:clipboard_observation_unavailable',
  ]);
});

test('observed failure keeps the T12 verdict failed even with an unavailable observation', () => {
  assert.deepEqual(
    videoLinksVerdict(
      { failures: ['video_open_url_mismatch:http://127.0.0.1:4021/wrong.mp4'], limitations: [] },
      { failures: [], limitations: ['copy_unavailable:clipboard_observation_unavailable'] },
    ),
    {
      status: 'failed',
      failures: ['video_open_url_mismatch:http://127.0.0.1:4021/wrong.mp4'],
      remaining: ['copy_unavailable:clipboard_observation_unavailable'],
    },
  );
  assert.equal(videoLinksVerdict({ failures: [], limitations: [] }).status, 'passed');
});

test('known wrong opened URL fails even when document loading times out', async () => {
  const deps = controls({ openedUrl: copyUrl, loadError: new Error('load_timeout') });
  const result = await observeVideoLinks({ ...deps, urls: [openUrl, copyUrl] });
  assert.equal(videoLinksVerdict(result).status, 'failed');
  assert.deepEqual(result.failures, [`video_open_url_mismatch:${copyUrl}`]);
  assert.equal(result.opened_url, copyUrl);
});

test('correct opened URL remains observable when document loading times out', async () => {
  const deps = controls({ loadError: new Error('load_timeout') });
  const result = await observeVideoLinks({ ...deps, urls: [openUrl, copyUrl] });
  assert.equal(result.opened_url, openUrl);
  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.limitations, ['open_load_unavailable:load_timeout']);
  assert.equal(videoLinksVerdict(result).status, 'partial');
});

test('unavailable opened URL stays partial when document loading times out', async () => {
  for (const openedUrl of [null, '', 'about:blank']) {
    const deps = controls({ openedUrl, loadError: new Error('load_timeout') });
    const result = await observeVideoLinks({ ...deps, urls: [openUrl, copyUrl] });
    assert.equal(videoLinksVerdict(result).status, 'partial');
    assert.deepEqual(result.failures, []);
    assert.deepEqual(result.limitations, [
      'open_load_unavailable:load_timeout',
      'open_unavailable:video_open_url_unavailable',
    ]);
  }
});
