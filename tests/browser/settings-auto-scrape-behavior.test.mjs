import assert from 'node:assert/strict';
import test from 'node:test';

import { runAutoScrapePageLoadBehavior } from './settings-auto-scrape-behavior.mjs';

function adapter({
  baseline = false,
  captureEnabled = true,
  captureDisabled = false,
  failRestore = false,
} = {}) {
  const state = {
    baseline,
    visible: baseline,
    stored: baseline,
    document: { url: 'https://controlled.test/before', documentKey: 'doc-before' },
    preview: null,
    nextId: 0,
    records: [],
  };

  const readPreference = async () => ({ visible: state.visible, stored: state.stored });
  const setPreferenceThroughUi = async (value) => {
    state.visible = value;
    if (!(failRestore && value === baseline && state.stored !== baseline)) state.stored = value;
  };
  const readActiveDocument = async () => ({ ...state.document });
  const navigateFreshDocument = async ({ label, marker }) => {
    state.nextId += 1;
    state.document = {
      url: `https://controlled.test/${label}-${state.nextId}`,
      documentKey: `doc-${state.nextId}`,
    };
    state.preview = {
      ready: true,
      activeUrl: state.document.url,
      activeDocumentKey: state.document.documentKey,
      scrapeSource: state.visible && captureEnabled ? 'auto-background' : null,
      pageFullContent:
        (state.visible && captureEnabled) || (!state.visible && captureDisabled)
          ? `controlled content ${marker}`
          : '',
      elapsedAfterNavigationMs: 1200,
    };
    return { ...state.document, marker };
  };
  const readPageFullContentFromContextPreview = async () => ({ ...state.preview });
  const waitFor = async (_name, read, predicate) => {
    const result = await read();
    assert.equal(predicate(result), true, `adapter did not satisfy ${_name}`);
    return result;
  };
  const record = (name, status, evidence) => state.records.push({ name, status, evidence });

  return {
    state,
    run: () =>
      runAutoScrapePageLoadBehavior({
        baselineEnabled: baseline,
        readPreference,
        setPreferenceThroughUi,
        readActiveDocument,
        navigateFreshDocument,
        readPageFullContentFromContextPreview,
        waitFor,
        record,
      }),
  };
}

test('page-load capture ON includes a unique fresh-page marker; OFF omits it and restores baseline', async () => {
  const testCase = adapter({ baseline: false });
  await testCase.run();

  assert.equal(testCase.state.visible, false);
  assert.equal(testCase.state.stored, false);
  assert.ok(
    testCase.state.records.some(
      ({ name, status, evidence }) =>
        name === 'enabled: page-load capture includes the fresh document marker' &&
        status === 'pass' &&
        evidence.source === 'auto-background' &&
        evidence.containsExpectedMarker,
    ),
  );
  assert.ok(
    testCase.state.records.some(
      ({ name, status, evidence }) =>
        name === 'disabled: no page-load capture appears on the fresh document' &&
        status === 'pass' &&
        evidence.containsExpectedMarker === false,
    ),
  );
  assert.ok(
    testCase.state.records.every((entry) => !JSON.stringify(entry).includes('controlled content')),
  );
});

test('the guard rejects a missing automatic capture even when the setting is enabled', async () => {
  const testCase = adapter({ baseline: true, captureEnabled: false });
  await assert.rejects(testCase.run(), /auto_scrape_page_load_behavior_or_restore_failed/);
  assert.equal(testCase.state.visible, true);
  assert.equal(testCase.state.stored, true);
  assert.ok(
    testCase.state.records.some(
      ({ name, status }) => name.includes('cleanup:') && status === 'pass',
    ),
  );
});

test('the guard rejects capture while disabled and still restores the original setting', async () => {
  const testCase = adapter({ baseline: true, captureDisabled: true });
  await assert.rejects(testCase.run(), /auto_scrape_page_load_behavior_or_restore_failed/);
  assert.equal(testCase.state.visible, true);
  assert.equal(testCase.state.stored, true);
  assert.ok(
    testCase.state.records.some(
      ({ name, status }) =>
        name === 'disabled: no page-load capture appears on the fresh document' &&
        status === 'fail',
    ),
  );
});

test('storage drift during baseline restoration fails cleanup instead of claiming success', async () => {
  const testCase = adapter({ baseline: false, failRestore: true });
  await assert.rejects(testCase.run(), /auto_scrape_page_load_behavior_or_restore_failed/);
  assert.equal(testCase.state.visible, false);
  assert.equal(testCase.state.stored, true);
  assert.ok(
    testCase.state.records.some(
      ({ name, status, evidence }) =>
        name === 'cleanup: original auto-scrape setting restored' &&
        status === 'fail' &&
        evidence.visible === true &&
        evidence.stored === false,
    ),
  );
});
