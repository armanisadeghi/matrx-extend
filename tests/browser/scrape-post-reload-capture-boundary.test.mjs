import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Window } from 'happy-dom';
import {
  captureTimeoutDiagnostic,
  createPostReloadCaptureBoundary,
  ownedEditedBadgeExpression,
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
      ...(showBusy && {
        branch: 'already_captured',
        discard_dialog_visible: false,
        ready: true,
        article_selected: true,
        visible: true,
        fixture_title_matches: true,
        fixture_text_present: true,
      }),
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

test('post reload capture confirms the visible unsaved-edits dialog before accepting article content', async () => {
  const f = fixture();
  const actions = [];
  const dialog = f.window.document.createElement('div');
  dialog.setAttribute('role', 'alertdialog');
  dialog.innerHTML =
    '<h2 data-slot="alert-dialog-title">Discard unsaved edits?</h2><button data-slot="alert-dialog-action">Re-capture</button>';
  const click = async (_panel, kind, label, onPhase) => {
    actions.push(`${kind}:${label}`);
    onPhase?.('release_returned');
    if (kind === 'title') {
      f.button.click();
      f.window.document.body.append(dialog);
    } else if (kind === 'scrape-recapture-dialog') {
      assert.equal(label, 'Re-capture');
      dialog.querySelector('button').click();
      dialog.remove();
      f.article.dataset.selected = 'Article';
      f.article.dataset.visible = 'true';
      f.article.dataset.title = 'Harbor Dental referral hours';
      f.article.textContent = 'Referral coordinators answer weekday calls.';
    }
  };
  await runPostReloadCaptureBoundary({
    panel: {},
    evaluate: f.evaluate,
    click,
    resourceAction: (action) => action(),
    waitFor: (label, read, accept, _timeout, diagnostic) =>
      waitFor(label, read, accept, 0, diagnostic),
    scrapeState: async () => ({
      ...(await f.scrapeState()),
      empty: f.article.dataset.visible !== 'true',
      title: 'Harbor Dental referral hours',
    }),
    boundary: f.boundary,
  });
  assert.deepEqual(actions, [`title:${title}`, 'scrape-recapture-dialog:Re-capture']);
  assert.equal(f.boundary.click_events, 1);
  assert.equal(f.boundary.branch, 'discard_confirmation');
  assert.equal(f.boundary.discard_dialog_visible, true);
  assert.equal(f.boundary.trusted_confirmation_returned, true);
  assert.equal(f.boundary.article_selected, true);
  assert.equal(f.boundary.fixture_title_matches, true);
  assert.equal(f.boundary.fixture_text_present, true);
  assert.equal(f.clickListenerCount(), 0);
});

test('owned edited badge and confirmation branch persist only bounded evidence', async () => {
  const f = fixture();
  f.window.document
    .querySelector('#scrape-pane')
    .insertAdjacentHTML(
      'beforeend',
      '<div role="tablist"><button role="tab" aria-selected="true" aria-controls="owned-article">Article</button></div>' +
        '<div id="owned-article" data-state="active"><span>edited</span><span>PRIVATE_PATIENT_VALUE</span></div>',
    );
  const edited = await f.evaluate({}, ownedEditedBadgeExpression);
  assert.equal(edited, true);
  const directory = await mkdtemp(join(tmpdir(), 'scrape-confirmation-receipt-'));
  try {
    const boundary = createPostReloadCaptureBoundary(edited);
    const dialog = f.window.document.createElement('div');
    dialog.setAttribute('role', 'alertdialog');
    dialog.innerHTML =
      '<h2 data-slot="alert-dialog-title">Discard unsaved edits?</h2>' +
      '<button data-slot="alert-dialog-action">Re-capture</button>';
    await runPostReloadCaptureBoundary({
      panel: {},
      evaluate: f.evaluate,
      click: async (_panel, kind, _label, phase) => {
        phase?.('release_returned');
        if (kind === 'title') {
          f.button.click();
          f.window.document.body.append(dialog);
        } else {
          dialog.remove();
          f.article.dataset.selected = 'Article';
          f.article.dataset.visible = 'true';
          f.article.dataset.title = 'Harbor Dental referral hours';
          f.article.textContent =
            'Referral coordinators answer weekday calls. PRIVATE_PATIENT_VALUE';
        }
      },
      resourceAction: (action) => action(),
      waitFor: (label, read, accept, _timeout, diagnostic) =>
        waitFor(label, read, accept, 0, diagnostic),
      scrapeState: async () => ({
        ...(await f.scrapeState()),
        empty: f.article.dataset.visible !== 'true',
        title: 'Harbor Dental referral hours',
      }),
      boundary,
    });
    const path = join(directory, 'native.json');
    await writeFile(path, `${JSON.stringify({ post_reload_capture_boundary: boundary })}\n`);
    const persisted = JSON.parse(await readFile(path, 'utf8')).post_reload_capture_boundary;
    assert.equal(persisted.owned_edited_badge_visible, true);
    assert.equal(persisted.branch, 'discard_confirmation');
    assert.equal(persisted.discard_dialog_visible, true);
    assert.equal(persisted.trusted_confirmation_returned, true);
    assert.equal(persisted.article_selected, true);
    assert.equal(persisted.visible, true);
    assert.equal(persisted.fixture_title_matches, true);
    assert.equal(persisted.fixture_text_present, true);
    assert.doesNotMatch(JSON.stringify(persisted), /PRIVATE_|resultText|media|account/);
    f.window.document.querySelector('#owned-article span').remove();
    assert.equal(await f.evaluate({}, ownedEditedBadgeExpression), false);
    const alreadyCaptured = createPostReloadCaptureBoundary(false);
    await runPostReloadCaptureBoundary({
      panel: {},
      evaluate: f.evaluate,
      click: async (_panel, _kind, _label, phase) => {
        phase?.('release_returned');
        f.button.click();
      },
      resourceAction: (action) => action(),
      waitFor: (label, read, accept, _timeout, diagnostic) =>
        waitFor(label, read, accept, 0, diagnostic),
      scrapeState: f.scrapeState,
      boundary: alreadyCaptured,
    });
    const alreadyPath = join(directory, 'already-captured.json');
    await writeFile(alreadyPath, JSON.stringify({ post_reload_capture_boundary: alreadyCaptured }));
    const alternate = JSON.parse(await readFile(alreadyPath, 'utf8')).post_reload_capture_boundary;
    assert.equal(alternate.branch, 'already_captured');
    assert.equal(alternate.discard_dialog_visible, false);
    assert.equal(alternate.trusted_confirmation_returned, false);
    assert.equal(alternate.fixture_text_present, true);
    assert.doesNotMatch(JSON.stringify(alternate), /PRIVATE_|resultText|media|account/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('post reload capture does not confirm a dialog for another page', async () => {
  const f = fixture();
  const dialog = f.window.document.createElement('div');
  dialog.setAttribute('role', 'alertdialog');
  dialog.innerHTML =
    '<h2 data-slot="alert-dialog-title">Discard unsaved edits?</h2><button data-slot="alert-dialog-action">Re-capture</button>';
  const actions = [];
  await assert.rejects(
    () =>
      runPostReloadCaptureBoundary({
        panel: {},
        evaluate: f.evaluate,
        click: async (_panel, kind) => {
          actions.push(kind);
          if (kind === 'title') {
            f.button.click();
            f.window.document.body.append(dialog);
          }
        },
        resourceAction: (action) => action(),
        waitFor: (label, read, accept, _timeout, diagnostic) =>
          waitFor(label, read, accept, 0, diagnostic),
        scrapeState: async () => ({
          ...(await f.scrapeState()),
          empty: true,
          title: 'Another page',
        }),
        boundary: f.boundary,
      }),
    /scrape_post_reload_referrals_captured_not_observed/,
  );
  assert.deepEqual(actions, ['title']);
  assert.equal(f.clickListenerCount(), 0);
});
