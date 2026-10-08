import assert from 'node:assert/strict';

function settingMatches(value, expected) {
  return value?.visible === expected && value?.stored === expected;
}

function documentMatches(observation, document) {
  return (
    observation?.ready === true &&
    observation?.activeUrl === document.url &&
    observation?.activeDocumentKey === document.documentKey
  );
}

function safeObservation(observation, document, marker) {
  const content =
    typeof observation?.pageFullContent === 'string' ? observation.pageFullContent : '';
  return {
    documentReady: observation?.ready === true,
    currentDocumentMatches: documentMatches(observation, document),
    pageFullContentAvailable: typeof observation?.pageFullContent === 'string',
    containsExpectedMarker: content.includes(marker),
    source: ['auto-background', 'manual', null].includes(observation?.scrapeSource)
      ? observation.scrapeSource
      : 'unknown',
    elapsedAfterNavigationMs:
      Number.isFinite(observation?.elapsedAfterNavigationMs) &&
      observation.elapsedAfterNavigationMs >= 0
        ? observation.elapsedAfterNavigationMs
        : null,
  };
}

/**
 * Verify T40's real page-load effect through the existing context preview.
 * Adapters must navigate a controlled HTTP(S) page and read Page content from
 * ContextRulesComposerChip's no-send preview. This helper has no manual-capture
 * entry point; passing off a capture-button result cannot satisfy it.
 */
export async function runAutoScrapePageLoadBehavior({
  baselineEnabled,
  readPreference,
  setPreferenceThroughUi,
  readActiveDocument,
  navigateFreshDocument,
  readPageFullContentFromContextPreview,
  waitFor,
  record,
  disabledObservationWindowMs = 1200,
}) {
  assert.equal(typeof baselineEnabled, 'boolean');
  assert.ok(Number.isFinite(disabledObservationWindowMs) && disabledObservationWindowMs >= 600);
  assert.equal(typeof readPreference, 'function');
  assert.equal(typeof setPreferenceThroughUi, 'function');
  assert.equal(typeof readActiveDocument, 'function');
  assert.equal(typeof navigateFreshDocument, 'function');
  assert.equal(typeof readPageFullContentFromContextPreview, 'function');
  assert.equal(typeof waitFor, 'function');
  assert.equal(typeof record, 'function');

  let failureStage = null;
  let priorMarker = null;
  let baselineRestored = false;
  const mark = (name, passed, evidence) => record(name, passed ? 'pass' : 'fail', evidence);
  const observePreference = async (expected, stage) => {
    const state = await readPreference();
    const passed = settingMatches(state, expected);
    mark(`${stage}: auto-scrape setting matches visible and stored value`, passed, {
      visible: state?.visible === expected,
      stored: state?.stored === expected,
    });
    assert.equal(passed, true, 'auto_scrape_setting_mismatch');
    return state;
  };
  const freshDocument = async (label, marker, previousDocument) => {
    const document = await navigateFreshDocument({ label, marker });
    const passed =
      typeof document?.url === 'string' &&
      /^https?:\/\//i.test(document.url) &&
      typeof document?.documentKey === 'string' &&
      document.documentKey.length > 0 &&
      document.documentKey !== previousDocument?.documentKey &&
      document?.marker === marker;
    mark(`${label}: opened a fresh controlled document`, passed, {
      freshDocument: passed,
      controlledMarkerPresent: document?.marker === marker,
    });
    assert.equal(passed, true, 'auto_scrape_fresh_document_unverified');
    return document;
  };

  try {
    failureStage = 'baseline';
    await observePreference(baselineEnabled, 'initial baseline');

    failureStage = 'enabled_setting';
    await setPreferenceThroughUi(true);
    await waitFor(
      'auto_scrape_enabled_visible_and_stored',
      () => readPreference(),
      (state) => settingMatches(state, true),
    );
    await observePreference(true, 'enabled');

    failureStage = 'enabled_fresh_page';
    const beforeEnabledPage = await readActiveDocument();
    const enabledMarker = 'MATRX_AUTO_SCRAPE_ON_UNIQUE_MARKER_7F4A';
    const enabledDocument = await freshDocument('enabled', enabledMarker, beforeEnabledPage);
    const enabledCapture = await waitFor(
      'auto_scrape_enabled_page_content_marker',
      () => readPageFullContentFromContextPreview(),
      (state) =>
        documentMatches(state, enabledDocument) &&
        state?.scrapeSource === 'auto-background' &&
        typeof state?.pageFullContent === 'string' &&
        state.pageFullContent.includes(enabledMarker),
    );
    const enabledEvidence = safeObservation(enabledCapture, enabledDocument, enabledMarker);
    mark('enabled: page-load capture includes the fresh document marker', true, enabledEvidence);
    priorMarker = enabledMarker;

    failureStage = 'disabled_setting';
    await setPreferenceThroughUi(false);
    await waitFor(
      'auto_scrape_disabled_visible_and_stored',
      () => readPreference(),
      (state) => settingMatches(state, false),
    );
    await observePreference(false, 'disabled');

    failureStage = 'disabled_fresh_page';
    const beforeDisabledPage = await readActiveDocument();
    const disabledMarker = 'MATRX_AUTO_SCRAPE_OFF_UNIQUE_MARKER_C2D9';
    const disabledDocument = await freshDocument('disabled', disabledMarker, beforeDisabledPage);
    const disabledObservation = await waitFor(
      'auto_scrape_disabled_fresh_page_settled',
      () => readPageFullContentFromContextPreview(),
      (state) =>
        documentMatches(state, disabledDocument) &&
        state?.elapsedAfterNavigationMs >= disabledObservationWindowMs,
    );
    const disabledEvidence = safeObservation(disabledObservation, disabledDocument, disabledMarker);
    disabledEvidence.previousMarkerAbsent = !String(
      disabledObservation?.pageFullContent ?? '',
    ).includes(priorMarker);
    const disabledCaptureAbsent =
      disabledEvidence.containsExpectedMarker === false &&
      disabledEvidence.previousMarkerAbsent === true &&
      disabledObservation?.scrapeSource !== 'auto-background';
    mark(
      'disabled: no page-load capture appears on the fresh document',
      disabledCaptureAbsent,
      disabledEvidence,
    );
    assert.equal(disabledCaptureAbsent, true, 'auto_scrape_disabled_page_was_captured');
    failureStage = null;
  } catch {
    // The observed page text is intentionally excluded from diagnostic output.
    mark('behavior: stage completed', false, { stage: failureStage });
  } finally {
    try {
      const current = await readPreference();
      if (!settingMatches(current, baselineEnabled)) await setPreferenceThroughUi(baselineEnabled);
      const restored = await waitFor(
        'auto_scrape_original_baseline_restored',
        () => readPreference(),
        (state) => settingMatches(state, baselineEnabled),
      );
      baselineRestored = settingMatches(restored, baselineEnabled);
      mark('cleanup: original auto-scrape setting restored', baselineRestored, {
        visible: restored?.visible === baselineEnabled,
        stored: restored?.stored === baselineEnabled,
      });
    } catch {
      failureStage ??= 'restore_baseline';
      let current = null;
      try {
        current = await readPreference();
      } catch {
        // Keep diagnostics bounded to the two boolean setting observations.
      }
      mark('cleanup: original auto-scrape setting restored', false, {
        visible: current?.visible === baselineEnabled,
        stored: current?.stored === baselineEnabled,
      });
    }
  }

  if (failureStage || !baselineRestored)
    throw new Error('auto_scrape_page_load_behavior_or_restore_failed');
  return { baselineRestored };
}
