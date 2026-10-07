import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { Window } from 'happy-dom';
import { runNativeResourceAction } from './native-resource-boundary.mjs';
import {
  enterMediaField,
  observeCopyFeedback,
  observeScrapeLinks,
  observeVideoLinks,
  videoLinksVerdict,
  waitForMediaCopyTarget,
} from './scrape-native-media-actions.mjs';
import { click as nativeClick, evaluate as panelEvaluate } from './settings-panel-driver.mjs';

const openUrl = 'http://127.0.0.1:4021/intake-walkthrough.mp4';
const copyUrl = 'http://127.0.0.1:4021/referral-walkthrough.mp4';

function controls({
  openedUrl = openUrl,
  copiedUrl = copyUrl,
  feedback = 'copied',
  readCode = null,
  failGateAt = 0,
  loadError,
} = {}) {
  const actions = [];
  let gateCalls = 0;
  let reads = 0;
  const panel = {
    send: async (method, args) => {
      if (method === 'Runtime.evaluate') {
        actions.push(['read']);
        if (args.expression.includes('permissions.query')) return { result: { value: 'prompt' } };
        reads++;
        return {
          result: {
            value:
              readCode && reads === 1
                ? { ok: false, code: readCode, focused: true, visible: true }
                : { ok: true, same: copiedUrl === copyUrl, focused: true, visible: true },
          },
        };
      }
      actions.push(['send', method, args]);
    },
  };
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
  const evaluate = async (_panel, expression) =>
    expression.includes('copy_target_readiness')
      ? { selected: true, rowCount: 1, targetCount: 1 }
      : feedback;
  const browserSession = {
    send: async (method, args) => actions.push(['permission', method, args.setting]),
  };
  const panelUrl = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/sidepanel.html';
  return { actions, panel, click, resourceAction, page, evaluate, browserSession, panelUrl };
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

test('the action probe receives field and open/copy boundaries without replacing resource gates', async () => {
  const deps = controls();
  const observed = [];
  const observeAction = async (kind, target, action) => {
    observed.push([kind, target]);
    return action();
  };
  await enterMediaField({ ...deps, field: 'src', value: openUrl, observeAction });
  await observeVideoLinks({ ...deps, urls: [openUrl, copyUrl], observeAction });
  assert.deepEqual(observed, [
    ['scrape-media-form-field', 'src'],
    ['scrape-media-field-insert', 'src'],
    ['scrape-media-open', openUrl],
    ['scrape-media-copy', copyUrl],
  ]);
  assert.equal(deps.actions.filter(([kind]) => kind === 'gate').length, 4);
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
    'video_clipboard_url_mismatch',
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
  deps.evaluate = async (_panel, expression) => {
    if (expression.includes('copy_target_readiness'))
      return { selected: true, rowCount: 1, targetCount: 1 };
    throw new Error('clipboard_observation_unavailable');
  };
  const result = await observeVideoLinks({ ...deps, urls: [openUrl, copyUrl] });
  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.limitations, [
    'open_unavailable:page_observation_unavailable',
    'video_copy_feedback_unobserved',
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

test('native Scrape link open and clipboard copy preserve the exact destination', async () => {
  const deps = controls({ openedUrl: openUrl, copiedUrl: copyUrl });
  const observed = await observeScrapeLinks({ ...deps, urls: [openUrl, copyUrl] });
  assert.deepEqual(observed, {
    opened_url: openUrl,
    copy_feedback: 'copied',
    clipboard_equal: true,
    clipboard_read: { ok: true, same: true, focused: true, visible: true },
    clipboard_observation: {},
    limitations: [],
    failures: [],
  });
  const wrong = controls({ openedUrl: copyUrl, copiedUrl: openUrl });
  const mismatch = await observeScrapeLinks({ ...wrong, urls: [openUrl, copyUrl] });
  assert.deepEqual(mismatch.failures, [
    `link_open_url_mismatch:${copyUrl}`,
    'link_clipboard_url_mismatch',
  ]);
  const refused = controls({ failGateAt: 2 });
  await assert.rejects(
    observeScrapeLinks({ ...refused, urls: [openUrl, copyUrl] }),
    /NATIVE_RESOURCE_BOUNDARY_REFUSED:stale_health/,
  );
  assert.deepEqual(
    refused.actions.filter(([kind]) => kind === 'click'),
    [['click', 'scrape-media-open', openUrl]],
  );
});

test('native link copy waits for its selected row after the opened tab restores Scrape', async () => {
  for (const observe of [observeScrapeLinks, observeVideoLinks]) {
    const deps = controls();
    const window = new Window();
    window.document.body.innerHTML = `<button role="tab" title="Scrape" data-state="active" aria-controls="pane">Scrape</button>
      <section id="pane" role="tabpanel" data-state="active"><div role="tablist"><button role="tab" aria-selected="true" aria-controls="links">Links</button><button role="tab" aria-selected="false" aria-controls="video">Video</button></div>
        <div id="links"><div><a href="${copyUrl}">Target</a><button title="Copy URL"><svg class="text-emerald-500"></svg></button></div></div>
        <div id="video"><div><a href="${copyUrl}">Target</a><button title="Copy video URL"><svg class="text-emerald-500"></svg></button></div></div></section>`;
    const selected = observe === observeScrapeLinks ? 'Links' : 'Video';
    const tabs = [...window.document.querySelectorAll('section [role="tab"]')];
    const select = (name) => {
      for (const tab of tabs) tab.setAttribute('aria-selected', String(tab.textContent === name));
    };
    select(selected);
    let readinessSamples = 0;
    deps.evaluate = async (_panel, expression) => {
      if (expression.includes('copy_target_readiness')) {
        readinessSamples++;
        if (readinessSamples === 2) select(selected);
      }
      return window.eval(expression);
    };
    deps.click = async (_panel, kind, target) => {
      deps.actions.push(['click', kind, target]);
      if (kind === 'scrape-media-open') select('Article');
      if (
        kind === 'scrape-media-copy' &&
        window.document.querySelector('section [role="tab"][aria-selected="true"]')?.textContent !==
          selected
      )
        throw new Error('pointer_target_not_unique');
    };
    const result = await observe({ ...deps, urls: [openUrl, copyUrl] });
    assert.equal(result.copy_feedback, 'copied');
    assert.equal(readinessSamples, 2);
    assert.deepEqual(
      deps.actions.filter(([kind]) => kind === 'click'),
      [
        ['click', 'scrape-media-open', openUrl],
        ['click', 'scrape-media-copy', copyUrl],
      ],
    );
  }
});

test('copy readiness requires the exact selected row, not a visible sibling', async () => {
  const window = new Window();
  window.document.body.innerHTML = `<button role="tab" title="Scrape" data-state="active" aria-controls="pane">Scrape</button>
    <section id="pane" role="tabpanel" data-state="active"><div role="tablist"><button role="tab" aria-selected="true" aria-controls="links">Links</button></div>
      <div id="links"><div><a href="${openUrl}">Sibling</a><button title="Copy URL"></button></div></div></section>`;
  await assert.rejects(
    waitForMediaCopyTarget(
      null,
      copyUrl,
      async (_panel, expression) => window.eval(expression),
      'Links',
      20,
    ),
    /scrape_media_copy_target_ready_not_observed/,
  );
  window.document.querySelector('a').href = copyUrl;
  window.document.querySelector('[role="tablist"] [role="tab"]').textContent = 'Video';
  await assert.rejects(
    waitForMediaCopyTarget(
      null,
      copyUrl,
      async (_panel, expression) => window.eval(expression),
      'Links',
      20,
    ),
    /scrape_media_copy_target_ready_not_observed/,
  );
  window.document.querySelector('[role="tablist"] [role="tab"]').textContent = 'Links';
  window.document
    .querySelector('#links div')
    .insertAdjacentHTML('beforeend', '<button title="Copy duplicate"></button>');
  await assert.rejects(
    waitForMediaCopyTarget(
      null,
      copyUrl,
      async (_panel, expression) => window.eval(expression),
      'Links',
      20,
    ),
    /scrape_media_copy_target_ready_not_observed/,
  );
});

test('native Copy target agrees with readiness for title and tooltip-migrated title', async () => {
  for (const attribute of ['title', 'data-matrx-title']) {
    const window = new Window();
    window.document.body.innerHTML = `<button role="tab" title="Scrape" data-state="active" aria-controls="pane">Scrape</button>
      <section id="pane" role="tabpanel" data-state="active"><div role="tablist"><button role="tab" aria-selected="true" aria-controls="links">Links</button></div>
        <div id="links"><div><a href="${openUrl}">Sibling</a><button title="Copy URL"></button></div>
          <div><a href="${copyUrl}">Target</a><button ${attribute}="Copy URL"></button></div></div></section>`;
    const target = window.document.querySelectorAll('#links button')[1];
    const rect = {
      x: 20,
      y: 20,
      left: 20,
      top: 20,
      right: 120,
      bottom: 40,
      width: 100,
      height: 20,
    };
    window.HTMLElement.prototype.getBoundingClientRect = () => rect;
    window.HTMLElement.prototype.scrollIntoView = () => {};
    window.HTMLElement.prototype.getAnimations = () => [];
    window.document.elementFromPoint = () => target;
    const events = [];
    const panel = {
      send: async (method, args) => {
        if (method === 'Input.dispatchMouseEvent') {
          events.push(args.type);
          return {};
        }
        assert.equal(method, 'Runtime.evaluate');
        return {
          result: {
            value: runInNewContext(args.expression, {
              document: window.document,
              getComputedStyle: () => ({
                display: 'block',
                visibility: 'visible',
                overflowX: 'visible',
                overflowY: 'visible',
                position: 'static',
                pointerEvents: 'auto',
              }),
              innerWidth: 360,
              innerHeight: 454,
            }),
          },
        };
      },
    };
    const ready = await waitForMediaCopyTarget(panel, copyUrl, panelEvaluate, 'Links', 20);
    assert.deepEqual({ ...ready }, { selected: true, rowCount: 1, targetCount: 1 });
    await nativeClick(panel, 'scrape-media-copy', copyUrl);
    assert.deepEqual(events, ['mousePressed', 'mouseReleased']);
  }
});

test('failed Copy feedback is a product failure and never gains read permission', async () => {
  const deps = controls({ feedback: 'failed', readCode: 'NotAllowedError' });
  const result = await observeVideoLinks({ ...deps, urls: [openUrl, copyUrl] });
  assert.deepEqual(result.failures, ['video_copy_write_failed']);
  assert.equal(result.clipboard_equal, null);
  assert.equal(
    deps.actions.some(([kind]) => kind === 'read' || kind === 'permission'),
    false,
  );
});

test('pending Copy feedback stays unresolved and cannot pass by clipboard readback', async () => {
  const deps = controls({ feedback: 'unobserved' });
  const result = await observeVideoLinks({ ...deps, urls: [openUrl, copyUrl] });
  assert.deepEqual(result.limitations, ['video_copy_feedback_unobserved']);
  assert.equal(
    deps.actions.some(([kind]) => kind === 'read' || kind === 'permission'),
    false,
  );
});

test('focused visible denied read after Check uses scoped permission and restores it', async () => {
  const deps = controls({ readCode: 'NotAllowedError' });
  const result = await observeVideoLinks({ ...deps, urls: [openUrl, copyUrl] });
  assert.equal(result.clipboard_equal, true);
  assert.equal(result.clipboard_read.code, 'NotAllowedError');
  assert.equal(result.clipboard_observation.clipboardObservationPermissionRestored, true);
  assert.deepEqual(
    deps.actions.filter(([kind]) => kind === 'permission'),
    [
      ['permission', 'Browser.setPermission', 'granted'],
      ['permission', 'Browser.setPermission', 'prompt'],
    ],
  );
});

test('denied read without a safe grant remains partial even after Check', async () => {
  const deps = controls({ readCode: 'SecurityError' });
  const result = await observeVideoLinks({ ...deps, urls: [openUrl, copyUrl] });
  assert.deepEqual(result.limitations, ['video_clipboard_read_SecurityError']);
  assert.equal(result.clipboard_equal, null);
  assert.equal(
    deps.actions.some(([kind]) => kind === 'permission'),
    false,
  );
});

test('failed permission restoration aborts before a later product action', async () => {
  const deps = controls({ readCode: 'NotAllowedError' });
  let permission = 'prompt';
  deps.browserSession.send = async (_method, args) => {
    if (args.setting === 'prompt') throw new Error('private transport detail');
    permission = args.setting;
  };
  let laterProductAction = false;
  await assert.rejects(
    async () => {
      await observeVideoLinks({ ...deps, urls: [openUrl, copyUrl] });
      laterProductAction = true;
    },
    (error) => error.message === 'clipboard_observation_permission_restore_unconfirmed',
  );
  assert.equal(laterProductAction, false);
  assert.equal(permission, 'granted');
});

test('Copy feedback observes hovered title in the exact active row', async () => {
  const window = new Window();
  window.document.body.innerHTML = `<button role="tab" title="Scrape" data-state="active" aria-controls="pane">Scrape</button>
    <section id="pane" role="tabpanel" data-state="active"><div role="tablist"><button role="tab" aria-selected="true" aria-controls="video">Video</button></div>
      <div id="video"><div><a href="${openUrl}">Other</a><button title="Copy other"><svg class="text-red-500"></svg></button></div>
        <div><a href="${copyUrl}">Target</a><button data-matrx-title="Copy video URL"><svg class="text-emerald-500"></svg></button></div></div></section>`;
  const feedback = await observeCopyFeedback(null, copyUrl, async (_panel, expression) =>
    window.eval(expression),
  );
  assert.equal(feedback, 'copied');
});

test('Copy feedback reads the owned row icon rather than a sibling row', async () => {
  for (const [icon, expected] of [
    ['svg.text-emerald-500', 'copied'],
    ['svg.text-red-500', 'failed'],
    [null, 'pending'],
  ]) {
    const button = { querySelector: (selector) => (selector === icon ? {} : null) };
    const anchor = { href: copyUrl, parentElement: { querySelectorAll: () => [button] } };
    const sibling = {
      href: openUrl,
      parentElement: { querySelectorAll: () => [{ querySelector: () => ({}) }] },
    };
    const content = { querySelectorAll: () => [sibling, anchor] };
    const subtab = { getAttribute: () => 'content' };
    const pane = { matches: () => true, querySelector: () => subtab };
    const topTab = { title: 'Scrape', getAttribute: () => 'pane' };
    const document = {
      querySelectorAll: () => [topTab],
      getElementById: (id) => (id === 'pane' ? pane : content),
    };
    const actual = await observeCopyFeedback(null, copyUrl, async (_panel, expression) =>
      runInNewContext(expression, { document }),
    );
    assert.equal(actual, expected);
  }
});
