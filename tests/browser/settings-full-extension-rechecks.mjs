import { safeTransportFailureClass } from './profile-reload-capture.mjs';
import {
  GUEST_EXTENSION_RECHECK_FAILURE_STAGES,
  GUEST_POST_REPLACEMENT_STAGES,
  detachPanelUnlessRetired,
  runGuestChoicesAcrossExtensionRestarts,
} from './settings-guest-extension-rechecks.mjs';
import {
  preferenceBaselineMatches,
  restoreGuestPreferenceBaseline,
  runGuestModeRefusalCase,
  safePreferenceBaselineRestoration,
} from './settings-guest-preference-batch.mjs';
import { AUTO_SCRAPE_MODE_FAILURE_STAGES, SECTIONS } from './settings-guest-scrape-controls.mjs';
import {
  observeGuestAutoScrapeMode,
  scrapeModeMatches,
} from './settings-guest-scrape-controls.mjs';
import { runWithAbsentScrapeModeBaseline } from './settings-scrape-mode-baseline.mjs';

export const FULL_EXTENSION_RECHECK_IDS = ['T04', 'T10', 'T28', 'T40', 'T67'];

const SAFE_ERROR_NAMES = new Set([
  'AssertionError',
  'Error',
  'RangeError',
  'TimeoutError',
  'TypeError',
]);
const SAFE_ERROR_CODES = new Set([
  'ECONNRESET',
  'EPIPE',
  'ETIMEDOUT',
  'ERR_ASSERTION',
  'ERR_INVALID_STATE',
  'ERR_TIMED_OUT',
  'T10_shadow_baseline_unobserved',
  'T10_shadow_baseline_mismatch_before_capture',
  'case_entry_baseline_restorer_required',
]);

const MODE_STORES = ['settings', 'chat', 'pilot'];
const MODE_FIELDS = [
  'storagePresent',
  'fieldPresent',
  'parseStatus',
  'mode',
  'fingerprint',
  'count',
];
const comparisonCategory = (a, b) =>
  a === undefined || b === undefined ? 'missing' : a === b ? 'equal' : 'unequal';

// Diagnostics inspect only the samples already handed to the authoritative comparator.
function modeComparisonReceipt(observed, baseline, stage) {
  const footprint = observed?.shadowFootprint;
  const original = baseline?.observation?.shadowFootprint;
  const valid = (value) =>
    value?.status === 'observed' &&
    Array.isArray(value.stores) &&
    value.stores.length === 3 &&
    value.stores.every(
      (entry, index) =>
        entry.store === MODE_STORES[index] &&
        ['valid', 'absent'].includes(entry.parseStatus) &&
        typeof entry.storagePresent === 'boolean' &&
        typeof entry.fieldPresent === 'boolean',
    );
  const observedValid = valid(footprint);
  const baselineValid = valid(original);
  const predicates = {
    visible: observed?.activeSettings === true,
    count: observed?.count === 1,
    selection: observed?.selected === 'Act without asking',
    baselineValue: baseline?.value === 'act',
    observedValid,
    baselineValid,
  };
  let serialization = 'unavailable';
  try {
    if (observedValid && baselineValid)
      serialization = JSON.stringify(footprint) === JSON.stringify(original) ? 'equal' : 'unequal';
  } catch {
    /* Diagnostic must never replace the comparison failure. */
  }
  const stores = MODE_STORES.map((store, index) => {
    const left = footprint?.stores?.[index];
    const right = original?.stores?.[index];
    const fields = {};
    for (const field of MODE_FIELDS)
      fields[field] = comparisonCategory(left?.[field], right?.[field]);
    const shape = (entry) => ({
      status: ['valid', 'absent', 'invalid', 'unavailable'].includes(entry?.parseStatus)
        ? entry.parseStatus
        : 'missing',
      storage: typeof entry?.storagePresent === 'boolean' ? entry.storagePresent : null,
      field: typeof entry?.fieldPresent === 'boolean' ? entry.fieldPresent : null,
    });
    return {
      store,
      identity: left?.store === store && right?.store === store ? 'valid' : 'invalid',
      observed: shape(left),
      baseline: shape(right),
      ...fields,
    };
  });
  const firstFalse =
    Object.keys(predicates).find((key) => !predicates[key]) ??
    (serialization === 'unequal'
      ? 'serialization'
      : serialization === 'unavailable'
        ? 'unavailable'
        : 'none');
  const residual =
    serialization === 'unequal' &&
    stores.every(
      (entry) =>
        entry.identity === 'valid' && MODE_FIELDS.every((field) => entry[field] === 'equal'),
    );
  return { stage, predicates, firstFalse, serialization, residual, stores };
}

// Project again at publication; never trust properties attached to an exception.
function safeModeComparison(error) {
  try {
    const value = error?.safeModeComparison;
    const stage = value?.stage;
    if (!['initial', 'final'].includes(stage)) return null;
    const predicateNames = [
      'visible',
      'count',
      'selection',
      'baselineValue',
      'observedValid',
      'baselineValid',
    ];
    const sourcePredicates = value.predicates;
    const predicates = Object.fromEntries(
      predicateNames.map((name) => [name, sourcePredicates?.[name] === true]),
    );
    const first = value.firstFalse;
    const serial = value.serialization;
    const residual = value.residual;
    const sourceStores = value.stores;
    const categories = ['equal', 'unequal', 'missing'];
    const shape = (entry) => {
      const status = entry?.status;
      const storage = entry?.storage;
      const field = entry?.field;
      return {
        status: ['valid', 'absent', 'invalid', 'unavailable'].includes(status) ? status : 'missing',
        storage: typeof storage === 'boolean' ? storage : null,
        field: typeof field === 'boolean' ? field : null,
      };
    };
    return {
      stage,
      predicates,
      firstFalse: [...predicateNames, 'serialization', 'unavailable', 'none'].includes(first)
        ? first
        : 'unavailable',
      serialization: ['equal', 'unequal', 'unavailable'].includes(serial) ? serial : 'unavailable',
      residual: residual === true,
      stores: MODE_STORES.map((store, index) => {
        const source = sourceStores?.[index];
        const identity = source?.identity;
        const observed = source?.observed;
        const baseline = source?.baseline;
        const fields = Object.fromEntries(
          MODE_FIELDS.map((field) => {
            const candidate = source?.[field];
            return [field, categories.includes(candidate) ? candidate : 'missing'];
          }),
        );
        return {
          store,
          identity: identity === 'valid' ? 'valid' : 'invalid',
          observed: shape(observed),
          baseline: shape(baseline),
          ...fields,
        };
      }),
    };
  } catch {
    return null;
  }
}

export function safeUnexpectedError(error, caseId = '') {
  try {
    const rawName = error?.name;
    const rawCode = error?.code;
    const rawMessage = SAFE_ERROR_CODES.has(rawCode) ? undefined : error?.message;
    const rawStack = error?.stack;
    const name = SAFE_ERROR_NAMES.has(rawName) ? rawName : 'OtherError';
    const code = SAFE_ERROR_CODES.has(rawCode)
      ? rawCode
      : SAFE_ERROR_CODES.has(rawMessage)
        ? rawMessage
        : 'other';
    const stack = typeof rawStack === 'string' ? rawStack.split('\n') : [];
    let source = null;
    for (const frame of stack) {
      const match = frame.match(/\/tests\/browser\/([A-Za-z0-9._-]+\.mjs):(\d+):(\d+)\)?$/);
      if (!match || !match[1].startsWith('settings-')) continue;
      source = { file: match[1], line: Number(match[2]), column: Number(match[3]) };
      break;
    }
    const result = {
      name,
      code,
      source: source ?? { file: 'unavailable', line: null, column: null },
    };
    const modeComparison = safeModeComparison(error);
    if (modeComparison) result.modeComparison = modeComparison;
    const restoration = safePreferenceBaselineRestoration(error?.safeBaselineRestoration);
    if (restoration) result.baselineRestoration = restoration;
    if (caseId.endsWith('T28') && error?.safeSectionCensus) {
      const census = error.safeSectionCensus;
      result.sectionCensus = {
        active: census.active === true,
        count: Number.isInteger(census.count) ? census.count : null,
        headings: Array.isArray(census.headings)
          ? census.headings.filter((name) => SECTIONS.includes(name))
          : [],
        unrecognizedHeadingCount: Number.isInteger(census.unrecognizedHeadingCount)
          ? census.unrecognizedHeadingCount
          : null,
        expandedControlCount: Number.isInteger(census.expandedControlCount)
          ? census.expandedControlCount
          : null,
        nonSectionExpandedControlCount: Number.isInteger(census.nonSectionExpandedControlCount)
          ? census.nonSectionExpandedControlCount
          : null,
      };
    }
    if (caseId.endsWith('T40') && AUTO_SCRAPE_WAIT_LABELS.has(error?.waitLabel)) {
      const sample = error.waitDiagnostic ?? {};
      result.wait = {
        label: error.waitLabel,
        sample: {
          active: sample.active === true,
          sectionOpen: sample.sectionOpen === true,
          controlCount: Number.isInteger(sample.controlCount) ? sample.controlCount : null,
          visibleMatches: sample.visibleMatches === true,
          storedMatches: sample.storedMatches === true,
        },
      };
    }
    if (caseId.endsWith('T40') && error?.safeLastAutoScrapeObservation) {
      const sample = error.safeLastAutoScrapeObservation;
      result.lastSafeObservation = {
        active: sample.active === true,
        sectionOpen: sample.sectionOpen === true,
        controlCount: Number.isInteger(sample.controlCount) ? sample.controlCount : null,
        visibleMatches: sample.visibleMatches === true,
        storedMatches: sample.storedMatches === true,
      };
    }
    return result;
  } catch {
    return {
      name: 'OtherError',
      code: 'diagnostic_unavailable',
      source: { file: 'unavailable', line: null, column: null },
    };
  }
}

const AUTO_SCRAPE_WAIT_LABELS = new Set([
  'auto_scrape_true_warm',
  'auto_scrape_false_warm',
  'auto_scrape_baseline_restored',
]);

function safeGuestFailureDiagnostics(error) {
  const safeStage = (stage) =>
    stage === 'not_failed' || GUEST_EXTENSION_RECHECK_FAILURE_STAGES.includes(stage)
      ? stage
      : 'unavailable';
  const safeTransport = (value) => safeTransportFailureClass(() => value);
  const safeStages = (stages) =>
    Array.isArray(stages)
      ? stages
          .filter(
            (entry) =>
              entry &&
              GUEST_POST_REPLACEMENT_STAGES.includes(entry.stage) &&
              ['started', 'completed', 'failed'].includes(entry.outcome),
          )
          .map((entry) => ({
            stage: entry.stage,
            outcome: entry.outcome,
            observation:
              entry.observation && typeof entry.observation === 'object'
                ? {
                    settingsActive:
                      typeof entry.observation.settingsActive === 'boolean'
                        ? entry.observation.settingsActive
                        : null,
                    sectionOpen:
                      typeof entry.observation.sectionOpen === 'boolean'
                        ? entry.observation.sectionOpen
                        : null,
                    selectedMatches: entry.observation.selectedMatches === true,
                    storedMatches: entry.observation.storedMatches === true,
                    preferenceMatches: entry.observation.preferenceMatches === true,
                  }
                : null,
          }))
      : [];
  return {
    baselineRestoration: safePreferenceBaselineRestoration(error?.safeBaselineRestoration),
    firstChoiceFailureStage: safeStage(error?.safeFirstChoiceFailureStage),
    restorationFailureStage: safeStage(error?.safeRestorationFailureStage),
    firstChoiceTransportClass: safeTransport(error?.safeFirstChoiceTransportClass),
    restorationTransportClass: safeTransport(error?.safeRestorationTransportClass),
    firstChoicePostReplacementStages: safeStages(error?.safeFirstChoicePostReplacementStages),
    restorationPostReplacementStages: safeStages(error?.safeRestorationPostReplacementStages),
    ...(error?.safeLastModeObservation && {
      lastModeObservation: {
        settingsActive: error.safeLastModeObservation.settingsActive === true,
        controlUnique: error.safeLastModeObservation.controlUnique === true,
        actSelected: error.safeLastModeObservation.actSelected === true,
        refusalVisible: error.safeLastModeObservation.refusalVisible === true,
      },
    }),
  };
}

const statusFrom = (criteria) =>
  criteria.some((entry) => entry.status === 'fail')
    ? 'fail'
    : criteria.length > 0 && criteria.every((entry) => entry.status === 'pass')
      ? 'pass'
      : 'unverified';

export function initializeFullExtensionRechecks(cases) {
  for (const id of FULL_EXTENSION_RECHECK_IDS) {
    const item = cases.find((candidate) => candidate.id.endsWith(id));
    if (item) item.fullExtensionReload = { status: 'missing', criteria: [] };
  }
}

export function snapshotPanelDocumentReload(item) {
  item.panelDocumentReload = {
    status: statusFrom(item.criteria),
    criteria: item.criteria.map(({ name, status, evidence }) => ({ name, status, evidence })),
  };
}

export async function runFullExtensionRecheck(item, execute) {
  const result = { status: 'missing', criteria: [] };
  item.fullExtensionReload = result;
  const record = (name, status, evidence) => {
    const entry = { name, status, evidence };
    result.criteria.push(entry);
    item.steps.push({ phase: 'full_extension_reload', action: name, observation: evidence });
    item.criteria.push({ name: `full extension reload: ${name}`, status, evidence });
  };

  try {
    await execute(record, result);
    result.status = statusFrom(result.criteria);
    if (result.status !== 'pass') result.error = 'full_extension_recheck_not_all_passed';
  } catch (error) {
    result.status = 'fail';
    const t67Failure =
      item.id.endsWith('T67') &&
      error?.safeCategory === 'auto_scrape_mode_recheck_failed' &&
      AUTO_SCRAPE_MODE_FAILURE_STAGES.includes(error.safeStage) &&
      ['case', 'restore', 'case_and_restore'].includes(error.safeFailureKind);
    if (t67Failure) {
      result.error = error.safeCategory;
      result.failureStage = error.safeStage;
      result.failureKind = error.safeFailureKind;
      if (AUTO_SCRAPE_MODE_FAILURE_STAGES.includes(error.safeOriginalStage))
        result.originalFailureStage = error.safeOriginalStage;
      Object.assign(result, safeGuestFailureDiagnostics(error));
      record('full extension reload recheck completed', 'fail', {
        category: result.error,
        stage: result.failureStage,
        kind: result.failureKind,
        ...safeGuestFailureDiagnostics(error),
        ...(result.originalFailureStage && { originalStage: result.originalFailureStage }),
      });
    } else if (error?.safeCategory === 'full_extension_preference_or_restore_failed') {
      result.error = error.safeCategory;
      Object.assign(result, safeGuestFailureDiagnostics(error));
      record('full extension reload recheck completed', 'fail', {
        category: result.error,
        ...safeGuestFailureDiagnostics(error),
      });
    } else {
      result.error =
        error?.safeCategory === 'full_extension_preference_or_restore_failed'
          ? error.safeCategory
          : 'full_extension_recheck_exception';
      if (result.error === 'full_extension_recheck_exception')
        result.exception = safeUnexpectedError(error, item.id);
      record(
        'full extension reload recheck completed',
        'fail',
        result.error === 'full_extension_recheck_exception'
          ? { category: result.error, ...result.exception }
          : result.error,
      );
    }
  }

  return result;
}

export async function captureGuestPreferenceBaselines({
  panel,
  preferences,
  settings,
  openSection,
  observePreference,
  preferenceBaseline,
  caseEntryBaselines = {},
  restorePreferenceBaseline,
  onStage = () => {},
}) {
  const stage = (value) => {
    try {
      const pending = onStage(value);
      if (pending && typeof pending.then === 'function') Promise.resolve(pending).catch(() => {});
    } catch {
      /* diagnostic only */
    }
  };
  const baselines = { ...caseEntryBaselines };
  stage('initial_settings');
  await settings(panel);
  const mode = preferences.find((item) => item.caseId === 'T10');
  const verifyWarmMode = async (pass) => {
    if (!mode) return;
    stage(`${pass}_mode_baseline`);
    if (caseEntryBaselines.T10?.matched !== true) throw new Error('T10_shadow_baseline_unobserved');
    stage(`${pass}_mode_open`);
    await openSection(panel, mode.section);
    stage(`${pass}_mode_observe`);
    const observed = await observePreference(panel, mode);
    stage(`${pass}_mode_compare`);
    if (!preferenceBaselineMatches(observed, mode, caseEntryBaselines.T10)) {
      const error = new Error('T10_shadow_baseline_mismatch_before_capture');
      try {
        error.safeModeComparison = modeComparisonReceipt(observed, caseEntryBaselines.T10, pass);
      } catch {
        /* best effort */
      }
      throw error;
    }
  };
  // Check BEFORE any Theme cleanup can remove the whole settings container.
  await verifyWarmMode('initial');
  // Theme may own the whole Settings container. T10 is never restored or
  // recaptured: compare the same warm expectation on both sides of cleanup.
  for (const preference of preferences.filter(
    (item) => item.caseId !== 'T10' && caseEntryBaselines[item.caseId],
  )) {
    stage('restore_preference');
    if (typeof restorePreferenceBaseline !== 'function')
      throw new Error('case_entry_baseline_restorer_required');
    await restorePreferenceBaseline(panel, preference, baselines[preference.caseId]);
  }
  await verifyWarmMode('final');
  for (const preference of preferences.filter((item) => item.caseId === 'T04')) {
    if (baselines[preference.caseId]) continue;
    stage('capture_preference_open');
    await openSection(panel, preference.section);
    stage('capture_preference_observe');
    baselines[preference.caseId] = preferenceBaseline(
      await observePreference(panel, preference),
      preference,
    );
  }
  return baselines;
}

export function enforceFullExtensionRechecks(cases) {
  for (const id of FULL_EXTENSION_RECHECK_IDS) {
    const item = cases.find((candidate) => candidate.id.endsWith(id));
    if (!item) continue;
    if (item.fullExtensionReload?.status !== 'pass') {
      if (!item.criteria.some((entry) => entry.name === 'full extension reload recheck required')) {
        const evidence = {
          status: item.fullExtensionReload?.status ?? 'missing',
          error: item.fullExtensionReload?.error ?? 'full_extension_recheck_missing',
        };
        item.criteria.push({
          name: 'full extension reload recheck required',
          status: item.fullExtensionReload?.status === 'unverified' ? 'unverified' : 'fail',
          evidence,
        });
      }
    }

    item.status = statusFrom(item.criteria);
  }
}

export async function rerunGuestSettingsAfterExtensionReload({
  panel,
  cases,
  preferences,
  reloadSettings,
  settings,
  openSection,
  observeNewChatDefault,
  runPreferenceCase,
  observePreference,
  preferenceBaseline,
  preExtensionBaselines,
  runSectionsCase,
  runAutoScrapeCase,
  reloadExtension,
  acquireLivePanel,
  preferenceMatches,
  choiceDriver,
  observeAutoScrapeMode = observeGuestAutoScrapeMode,
  transportFailureClass = () => 'unavailable',
}) {
  let activePanel = panel;
  let panelRecoveryFailed = false;
  const mode = preferences.find((item) => item.caseId === 'T10');
  const modeBaseline = preExtensionBaselines?.T10
    ? structuredClone(preExtensionBaselines.T10)
    : undefined;
  const verifyModeBeforeCleanup = async (target) => {
    if (!mode) return;
    if (modeBaseline?.matched !== true) throw new Error('T10_shadow_baseline_unobserved');
    await openSection(target, mode.section);
    const observed = await observePreference(target, mode);
    if (!preferenceBaselineMatches(observed, mode, modeBaseline))
      throw new Error('T10_shadow_baseline_mismatch');
  };
  const settingsBeforeTheme = async (target) => {
    await settings(target);
    await verifyModeBeforeCleanup(target);
  };
  try {
    for (const preference of preferences.filter((item) => ['T04', 'T10'].includes(item.caseId))) {
      // The caller already replaced the extension. Observe that generation before
      // any sibling choice/cleanup, and again before a later reload can mask it.
      try {
        await verifyModeBeforeCleanup(activePanel);
      } catch {
        const error = Object.assign(new Error('T10_shadow_baseline_unverified'), {
          safeCategory: 'full_extension_preference_or_restore_failed',
          safeFirstChoiceFailureStage: 'initial_baseline_observation',
        });
        await runFullExtensionRecheck(
          cases.find((candidate) => candidate.id.endsWith('T10')),
          async () => {
            throw error;
          },
        );
        return;
      }
      const item = cases.find((candidate) => candidate.id.endsWith(preference.caseId));
      if (preference.caseId === 'T10') {
        await runFullExtensionRecheck(item, async (record) => {
          let stage = 'choice_extension_reload';
          let lastModeObservation = null;
          const postReplacementStages = [];
          const onStage = (name, outcome, observation) => {
            stage = name;
            const safeObservation =
              observation &&
              typeof observation === 'object' &&
              ('activeSettings' in observation || 'count' in observation)
                ? {
                    settingsActive: observation.activeSettings === true,
                    controlUnique: observation.count === 1,
                    actSelected: observation.selected === 'Act without asking',
                    refusalVisible: observation.saveRefusal === true,
                  }
                : null;
            if (safeObservation) lastModeObservation = safeObservation;
            if (GUEST_POST_REPLACEMENT_STAGES.includes(name))
              postReplacementStages.push({ stage: name, outcome, observation: safeObservation });
          };
          const at = async (name, action) => {
            onStage(name, 'started');
            try {
              const value = await action();
              onStage(name, 'completed', value);
              return value;
            } catch (error) {
              onStage(name, 'failed');
              throw error;
            }
          };
          try {
            if (modeBaseline?.matched !== true) throw new Error('T10_shadow_baseline_unobserved');
            const previousPanel = activePanel;
            const replacement = await at('choice_extension_reload', reloadExtension);
            stage = 'choice_replacement_validation';
            const nextPanel = replacement.panel;
            if (
              !replacement.management_reload_clicked ||
              !replacement.old_targets_retired ||
              !replacement.worker_replaced ||
              !replacement.panel_replaced ||
              replacement.retirement_evidence?.timeline?.final_predicate !== true ||
              typeof nextPanel?.targetId !== 'string' ||
              nextPanel.targetId === previousPanel?.targetId
            )
              throw new Error('T10_extension_replacement_unverified');
            activePanel = nextPanel;
            await at('choice_detach_previous_panel', () =>
              detachPanelUnlessRetired(previousPanel, replacement.old_targets_retired),
            );
            record('Extension worker and panel replaced before guest mode check', 'pass', {
              managementReloadClicked: true,
              oldTargetsRetired: true,
              workerReplaced: true,
              panelReplaced: true,
              replacementTargetChanged: true,
            });
            await at('choice_settings_reopen', () => settings(activePanel));
            await runGuestModeRefusalCase(
              activePanel,
              reloadSettings,
              preference,
              (name, observation, passed) => record(name, passed ? 'pass' : 'fail', observation),
              async ({ panel: target }) => {
                const chat = await observeNewChatDefault(target, 'act', 'Act without asking');
                const passed =
                  chat?.modeLabel === 'Act without asking' && chat?.permissionMode === 'act';
                record(
                  'New guest chat retains Act after extension reload',
                  passed ? 'pass' : 'fail',
                  chat,
                );
                await settings(target);
              },
              choiceDriver ? { ...choiceDriver, openSection } : undefined,
              onStage,
              modeBaseline,
            );
          } catch (error) {
            const failure = error instanceof Error ? error : new Error('guest_mode_recheck_failed');
            failure.safeCategory = 'full_extension_preference_or_restore_failed';
            failure.safeFirstChoiceFailureStage = stage;
            failure.safeFirstChoiceTransportClass = safeTransportFailureClass(() =>
              transportFailureClass(error),
            );
            failure.safeFirstChoicePostReplacementStages = postReplacementStages;
            failure.safeLastModeObservation = lastModeObservation;
            try {
              activePanel = await acquireLivePanel();
            } catch {
              panelRecoveryFailed = true;
              failure.safeRestorationFailureStage = 'restore_acquire_panel';
              failure.safeRestorationTransportClass = safeTransportFailureClass(() =>
                transportFailureClass(error),
              );
            }
            throw failure;
          }
        });
        if (panelRecoveryFailed) break;
        continue;
      }
      const result = await runFullExtensionRecheck(item, async (record) => {
        const before = await observePreference(activePanel, preference);
        const baseline = preExtensionBaselines?.[preference.caseId];
        const baselineMatched =
          baseline?.matched === true && preferenceBaselineMatches(before, preference, baseline);
        record(
          `pre-run ${preference.label} matches saved baseline`,
          baselineMatched ? 'pass' : 'fail',
          {
            before,
            expectedValue: baseline?.value ?? null,
            expectedLabel: baseline?.label ?? null,
            expectedStoredPresent: baseline?.storedPresent ?? null,
            expectedStoragePresent: baseline?.storagePresent ?? null,
          },
        );

        try {
          activePanel = await runGuestChoicesAcrossExtensionRestarts({
            panel: activePanel,
            section: preference.section,
            controlLabel: preference.label,
            choices: preference.choices,
            baseline,
            settings: settingsBeforeTheme,
            openSection,
            read: (target) => observePreference(target, preference),
            matches: (state, value, label) => preferenceMatches(state, preference, value, label),
            matchesBaseline: (state) => preferenceBaselineMatches(state, preference, baseline),
            ...(baseline?.storedPresent === false && {
              restoreBaseline: async (target) => {
                await verifyModeBeforeCleanup(target);
                const restored = await restoreGuestPreferenceBaseline(
                  target,
                  preference,
                  baseline,
                  (name, observation, passed) =>
                    record(name, passed ? 'pass' : 'fail', observation),
                  ...(choiceDriver ? [{ ...choiceDriver, openSection }] : []),
                );
                await verifyModeBeforeCleanup(target);
                return restored;
              },
            }),
            reloadExtension,
            acquireLivePanel,
            onPanelChanged: (target) => {
              activePanel = target;
            },
            record,
            transportFailureClass,
            ...(choiceDriver && { driver: choiceDriver }),
          });
        } catch (caughtError) {
          const error = Object.assign(new Error('full_extension_preference_or_restore_failed'), {
            safeCategory: 'full_extension_preference_or_restore_failed',
          });
          error.safeBaselineRestoration = caughtError?.safeBaselineRestoration;
          error.safeFirstChoiceFailureStage = caughtError?.safeFirstChoiceFailureStage;
          error.safeRestorationFailureStage = caughtError?.safeRestorationFailureStage;
          error.safeFirstChoiceTransportClass = caughtError?.safeFirstChoiceTransportClass;
          error.safeRestorationTransportClass = caughtError?.safeRestorationTransportClass;
          error.safeFirstChoicePostReplacementStages =
            caughtError?.safeFirstChoicePostReplacementStages;
          error.safeRestorationPostReplacementStages =
            caughtError?.safeRestorationPostReplacementStages;
          throw error;
        }
      });
      if (result.restorationFailureStage === 'restore_acquire_panel') {
        panelRecoveryFailed = true;
        break;
      }
    }

    if (panelRecoveryFailed) {
      for (const id of FULL_EXTENSION_RECHECK_IDS) {
        const item = cases.find((candidate) => candidate.id.endsWith(id));
        if (!item || item.fullExtensionReload?.status !== 'missing') continue;
        const evidence = {
          status: 'unverified',
          error: 'previous_panel_recovery_failed',
        };
        item.fullExtensionReload = {
          status: 'unverified',
          error: evidence.error,
          criteria: [
            {
              name: 'recheck skipped after panel recovery failed',
              status: 'unverified',
              evidence,
            },
          ],
        };
        item.steps.push({
          phase: 'full_extension_reload',
          action: 'recheck skipped after panel recovery failed',
          observation: evidence,
        });
      }
      return activePanel;
    }

    for (const [id, runner] of [
      ['T28', runSectionsCase],
      ['T40', runAutoScrapeCase],
    ]) {
      const item = cases.find((candidate) => candidate.id.endsWith(id));
      await runFullExtensionRecheck(item, async (record, result) => {
        // A preceding case may have visited Chat or failed before its own return path.
        // Reenter the verified Settings tab for each independent recheck.
        await settings(activePanel);
        record('Settings tab reopened for this recheck', 'pass', {
          panelTargetPresent: typeof activePanel?.targetId === 'string',
          settingsReopened: true,
        });
        await runner(activePanel, reloadSettings, (phase, action, observation, passed) =>
          record(`${phase}: ${action}`, passed ? 'pass' : 'fail', observation),
        );
        if (id === 'T40')
          result.downstreamCapture = {
            status: 'unverified',
            evidence: 'A page-load/background capture was not exercised.',
          };
      });
    }

    const modeCase = cases.find((candidate) => candidate.id.endsWith('T67'));
    await runFullExtensionRecheck(modeCase, async (record, result) => {
      await runWithAbsentScrapeModeBaseline({
        getPanel: () => activePanel,
        reloadSettings,
        settings,
        openSection,
        observe: observeAutoScrapeMode,
        record,
        ...(choiceDriver && { driver: choiceDriver }),
        execute: async (initial) => {
          const labels = { capture: 'Capture', 'scroll-capture': 'Scroll & capture' };
          await runGuestChoicesAcrossExtensionRestarts({
            panel: activePanel,
            section: 'Scrape',
            controlLabel: 'Auto-scrape mode',
            choices: [
              ['capture', 'Capture'],
              ['scroll-capture', 'Scroll & capture'],
            ],
            baseline: {
              value: initial.mode?.stored,
              label: labels[initial.mode?.stored] ?? null,
            },
            settings,
            openSection,
            read: async (target) => {
              const state = await observeAutoScrapeMode(target);
              return { ...state.mode, active: state.active, sectionOpen: state.sectionOpen };
            },
            matches: (state, value, label) => scrapeModeMatches(state, value, label),
            reloadExtension,
            acquireLivePanel,
            onPanelChanged: (target) => {
              activePanel = target;
            },
            record,
            failureCategory: 'auto_scrape_mode_recheck_failed',
            safeStages: AUTO_SCRAPE_MODE_FAILURE_STAGES,
            transportFailureClass,
            ...(choiceDriver && { driver: choiceDriver }),
          });
        },
      });
      result.downstreamCapture = {
        status: 'unverified',
        evidence: 'The selected capture mode was checked; downstream capture was not exercised.',
      };
    });
  } finally {
    if (activePanel !== panel) await activePanel.detach?.();
  }
}
