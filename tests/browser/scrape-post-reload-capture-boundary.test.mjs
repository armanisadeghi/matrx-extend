import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import {
  captureTimeoutDiagnostic,
  runPostReloadCaptureBoundary,
} from './scrape-post-reload-capture-boundary.mjs';
import { waitFor } from './settings-panel-driver.mjs';

const title = 'Capture the page exactly as it is right now';

function fixture() {
  const window = new Window();
  let clickListeners = 0;
  const add = window.document.addEventListener.bind(window.document);
  const remove = window.document.removeEventListener.bind(window.document);
  window.document.addEventListener = (kind, listener, options) => {
    if (kind === 'click') clickListeners++;
    return add(kind, listener, options);
  };
  window.document.removeEventListener = (kind, listener, options) => {
    if (kind === 'click') clickListeners--;
    return remove(kind, listener, options);
  };
  window.document.body.innerHTML = `<button role="tab" title="Scrape" data-state="active"
    aria-controls="scrape-pane">Scrape</button>
    <section id="scrape-pane" role="tabpanel" data-state="active">
      <button title="${title}">Capture</button><article></article>
    </section>`;
  window.HTMLElement.prototype.getBoundingClientRect = () => ({
    width: 100,
    height: 30,
    left: 0,
    top: 0,
    right: 100,
    bottom: 30,
  });
  const button = window.document.querySelector('#scrape-pane button');
  const article = window.document.querySelector('article');
  const boundary = { pointer_phase: null, click_events: null, busy_observed: null };
  const evaluate = async (_panel, expression) => window.eval(expression);
  const scrapeState = async () => ({
    ready: true,
    selected: article.dataset.selected ?? null,
    visible: article.dataset.visible === 'true',
    title: article.dataset.title ?? null,
    resultText: article.textContent,
    media: { imageGroups: { large: ['https://private.invalid/image?token=secret'] } },
  });
  return {
    window,
    button,
    article,
    boundary,
    evaluate,
    scrapeState,
    clickListenerCount: () => clickListeners,
  };
}

for (const [name, dispatchClick, showBusy, expectedClicks, expectedBusy] of [
  ['missing pointer input', false, false, 0, false],
  ['delivered click without busy', true, false, 1, false],
  ['delivered click with busy', true, true, 1, true],
]) {
  test(`post reload capture distinguishes ${name}`, async () => {
    const f = fixture();
    const click = async (_panel, _kind, _title, onPhase) => {
      onPhase('pointer_dispatched');
      if (dispatchClick) f.button.click();
      if (showBusy) {
        f.button.disabled = true;
        f.button.textContent = 'Capturing…';
        await new Promise((resolve) => setTimeout(resolve, 0));
        f.article.dataset.selected = 'Article';
        f.article.dataset.visible = 'true';
        f.article.dataset.title = 'Harbor Dental referral hours';
        f.article.textContent = 'Referral coordinators answer weekday calls.';
      }
    };
    const boundedWait = (label, read, accept, timeout, diagnostic) => {
      assert.equal(timeout, 30000);
      return waitFor(label, read, accept, 0, diagnostic);
    };
    const run = () =>
      runPostReloadCaptureBoundary({
        panel: {},
        evaluate: f.evaluate,
        click,
        resourceAction: (action) => action(),
        waitFor: boundedWait,
        scrapeState: f.scrapeState,
        boundary: f.boundary,
      });
    if (showBusy) await run();
    else await assert.rejects(run, /scrape_post_reload_referrals_captured_not_observed/);
    assert.deepEqual(f.boundary, {
      pointer_phase: 'pointer_dispatched',
      click_events: expectedClicks,
      busy_observed: expectedBusy,
    });
    assert.equal(f.clickListenerCount(), 0, 'capture click listener must be removed');
    // A second run in the same document must count only its own click.
    if (dispatchClick) {
      f.button.disabled = false;
      f.button.textContent = 'Capture';
      await (showBusy ? run() : assert.rejects(run));
      assert.equal(f.boundary.click_events, 1);
    }
  });
}

test('capture timeout diagnostic excludes page and account content', async () => {
  const state = {
    ready: true,
    selected: 'Article',
    visible: true,
    title: 'Harbor Dental referral hours',
    resultText: 'Private patient referral secret; authorization Bearer secret',
    media: { imageGroups: ['https://private.invalid/image?token=secret'] },
    account: { email: 'private@clinic.invalid' },
  };
  await assert.rejects(
    () =>
      waitFor(
        'capture',
        async () => state,
        () => false,
        0,
        captureTimeoutDiagnostic,
      ),
    (error) => {
      assert.match(error.message, /fixture_text_present":false/);
      assert.doesNotMatch(error.message, /secret|Bearer|private@|https:|patient/i);
      return true;
    },
  );
});

test('failed capture retains scalar boundary and excludes rendered content', async () => {
  const f = fixture();
  f.article.dataset.selected = 'Article';
  f.article.dataset.visible = 'true';
  f.article.dataset.title = 'Harbor Dental referral hours';
  f.article.textContent = 'Private patient referral secret; authorization Bearer secret';
  const run = () =>
    runPostReloadCaptureBoundary({
      panel: {},
      evaluate: f.evaluate,
      click: async (_panel, _kind, _title, onPhase) => {
        onPhase('pointer_dispatched');
        f.button.click();
      },
      resourceAction: (action) => action(),
      waitFor: (label, read, accept, timeout, diagnostic) => {
        assert.equal(timeout, 30000);
        return waitFor(label, read, accept, 0, diagnostic);
      },
      scrapeState: f.scrapeState,
      boundary: f.boundary,
    });
  await assert.rejects(run, (error) => {
    assert.doesNotMatch(error.message, /secret|Bearer|private@|https:|patient/i);
    return true;
  });
  assert.deepEqual(f.boundary, {
    pointer_phase: 'pointer_dispatched',
    click_events: 1,
    busy_observed: false,
  });
  assert.equal(f.clickListenerCount(), 0, 'capture click listener must be removed');
});

test('click listener is disposed when arming busy observation throws', async () => {
  const f = fixture();
  const evaluate = async (panel, expression) => {
    if (expression.includes('new MutationObserver(sample)')) {
      await f.evaluate(panel, expression);
      throw new Error('busy_arm_failed');
    }
    return f.evaluate(panel, expression);
  };
  await assert.rejects(
    () =>
      runPostReloadCaptureBoundary({
        panel: {},
        evaluate,
        click: async () => assert.fail('click should not start'),
        resourceAction: (action) => action(),
        waitFor,
        scrapeState: f.scrapeState,
        boundary: f.boundary,
      }),
    /busy_arm_failed/,
  );
  f.button.click();
  assert.deepEqual(f.boundary, {
    pointer_phase: null,
    click_events: 0,
    busy_observed: null,
  });
  assert.equal(f.window.eval('globalThis.__scrapePostReloadClickProbe'), undefined);
  assert.equal(f.clickListenerCount(), 0, 'capture click listener must be removed');
  assert.equal(f.window.eval('globalThis.__scrapeBusyObserver'), undefined);
});
