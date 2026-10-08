import { runGuestChoicesAcrossExtensionRestarts } from './settings-guest-extension-rechecks.mjs';
import { AUTO_SCRAPE_MODE_FAILURE_STAGES } from './settings-guest-scrape-controls.mjs';
import {
  observeGuestAutoScrapeMode,
  scrapeModeMatches,
} from './settings-guest-scrape-controls.mjs';

export const FULL_EXTENSION_RECHECK_IDS = ['T04', 'T10', 'T28', 'T40', 'T67'];

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
      record('full extension reload recheck completed', 'fail', {
        category: result.error,
        stage: result.failureStage,
        kind: result.failureKind,
        ...(result.originalFailureStage && { originalStage: result.originalFailureStage }),
      });
    } else {
      result.error =
        error?.safeCategory === 'full_extension_preference_or_restore_failed'
          ? error.safeCategory
          : 'full_extension_recheck_exception';
      record('full extension reload recheck completed', 'fail', result.error);
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
          status: 'fail',
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
}) {
  let activePanel = panel;
  try {
    for (const preference of preferences.filter((item) => ['T04', 'T10'].includes(item.caseId))) {
      const item = cases.find((candidate) => candidate.id.endsWith(preference.caseId));
      await runFullExtensionRecheck(item, async (record) => {
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
        } catch {
          throw Object.assign(new Error('full_extension_preference_or_restore_failed'), {
            safeCategory: 'full_extension_preference_or_restore_failed',
          });
        }
      });
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
