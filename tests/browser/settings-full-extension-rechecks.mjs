import { safeTransportFailureClass } from './profile-reload-capture.mjs';
import {
  GUEST_EXTENSION_RECHECK_FAILURE_STAGES,
  runGuestChoicesAcrossExtensionRestarts,
} from './settings-guest-extension-rechecks.mjs';
import { AUTO_SCRAPE_MODE_FAILURE_STAGES } from './settings-guest-scrape-controls.mjs';
import {
  observeGuestAutoScrapeMode,
  scrapeModeMatches,
} from './settings-guest-scrape-controls.mjs';

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
]);

function safeUnexpectedError(error) {
  const name = SAFE_ERROR_NAMES.has(error?.name) ? error.name : 'OtherError';
  const code = SAFE_ERROR_CODES.has(error?.code) ? error.code : 'other';
  const stack = typeof error?.stack === 'string' ? error.stack.split('\n') : [];
  let source = null;
  for (const frame of stack) {
    const match = frame.match(/\/tests\/browser\/([A-Za-z0-9._-]+\.mjs):(\d+):(\d+)\)?$/);
    if (!match || !match[1].startsWith('settings-')) continue;
    source = { file: match[1], line: Number(match[2]), column: Number(match[3]) };
    break;
  }
  return { name, code, source: source ?? { file: 'unavailable', line: null, column: null } };
}

function safeGuestFailureDiagnostics(error) {
  const safeStage = (stage) =>
    stage === 'not_failed' || GUEST_EXTENSION_RECHECK_FAILURE_STAGES.includes(stage)
      ? stage
      : 'unavailable';
  const safeTransport = (value) => safeTransportFailureClass(() => value);
  return {
    firstChoiceFailureStage: safeStage(error?.safeFirstChoiceFailureStage),
    restorationFailureStage: safeStage(error?.safeRestorationFailureStage),
    firstChoiceTransportClass: safeTransport(error?.safeFirstChoiceTransportClass),
    restorationTransportClass: safeTransport(error?.safeRestorationTransportClass),
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
        result.exception = safeUnexpectedError(error);
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
}) {
  const baselines = {};
  await settings(panel);
  for (const preference of preferences.filter((item) => ['T04', 'T10'].includes(item.caseId))) {
    await openSection(panel, preference.section);
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
  try {
    for (const preference of preferences.filter((item) => ['T04', 'T10'].includes(item.caseId))) {
      const item = cases.find((candidate) => candidate.id.endsWith(preference.caseId));
      const result = await runFullExtensionRecheck(item, async (record) => {
        const before = await observePreference(activePanel, preference);
        const observed = preferenceBaseline(before, preference);
        const baseline = preExtensionBaselines?.[preference.caseId];
        const baselineMatched =
          baseline?.matched === true &&
          observed.matched === true &&
          observed.value === baseline.value;
        record(
          `pre-run ${preference.label} matches saved baseline`,
          baselineMatched ? 'pass' : 'fail',
          {
            before,
            expectedValue: baseline?.value ?? null,
            expectedLabel: baseline?.label ?? null,
          },
        );

        try {
          activePanel = await runGuestChoicesAcrossExtensionRestarts({
            panel: activePanel,
            section: preference.section,
            controlLabel: preference.label,
            choices: preference.choices,
            baseline,
            settings,
            openSection,
            read: (target) => observePreference(target, preference),
            matches: (state, value, label) => preferenceMatches(state, preference, value, label),
            reloadExtension,
            acquireLivePanel,
            onPanelChanged: (target) => {
              activePanel = target;
            },
            record,
            transportFailureClass,
            ...(choiceDriver && { driver: choiceDriver }),
            ...(preference.caseId === 'T10' && {
              afterReload: async ({ panel: target, value, label }) => {
                const chat = await observeNewChatDefault(target, value, label);
                record(
                  `new chat inherits ${label} after extension reload`,
                  chat.modeLabel === label && chat.modeIcon === value ? 'pass' : 'fail',
                  chat,
                );
                await settings(target);
                await openSection(target, preference.section);
              },
            }),
          });
        } catch (caughtError) {
          const error = Object.assign(new Error('full_extension_preference_or_restore_failed'), {
            safeCategory: 'full_extension_preference_or_restore_failed',
          });
          error.safeFirstChoiceFailureStage = caughtError?.safeFirstChoiceFailureStage;
          error.safeRestorationFailureStage = caughtError?.safeRestorationFailureStage;
          error.safeFirstChoiceTransportClass = caughtError?.safeFirstChoiceTransportClass;
          error.safeRestorationTransportClass = caughtError?.safeRestorationTransportClass;
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
      const initial = await observeAutoScrapeMode(activePanel);
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
      result.downstreamCapture = {
        status: 'unverified',
        evidence: 'The selected capture mode was checked; downstream capture was not exercised.',
      };
    });
  } finally {
    if (activePanel !== panel) await activePanel.detach?.();
  }
}
