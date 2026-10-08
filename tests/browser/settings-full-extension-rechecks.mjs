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
    result.error = String(error?.message ?? error);
    record('full extension reload recheck completed', 'fail', result.error);
  }

  return result;
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
  restorePreferenceBaseline,
  runSectionsCase,
  runAutoScrapeCase,
  runAutoScrapeModeCase,
}) {
  for (const preference of preferences.filter((item) => ['T04', 'T10'].includes(item.caseId))) {
    const item = cases.find((candidate) => candidate.id.endsWith(preference.caseId));
    await runFullExtensionRecheck(item, async (record) => {
      const before = await observePreference(panel, preference);
      const baseline = preferenceBaseline(before, preference);
      record(
        `pre-run ${preference.label} matches saved baseline`,
        baseline.matched ? 'pass' : 'fail',
        baseline,
      );

      let preferenceError;
      let restoreError;
      try {
        await runPreferenceCase(
          panel,
          reloadSettings,
          preference,
          (name, observation, passed) => record(name, passed ? 'pass' : 'fail', observation),
          async ({ value, label }) => {
            if (preference.caseId !== 'T10') return;
            const chat = await observeNewChatDefault(panel, value, label);
            record(
              `new chat inherits ${label}`,
              chat.modeLabel === label && chat.modeIcon === value ? 'pass' : 'fail',
              chat,
            );
            await settings(panel);
            await openSection(panel, preference.section);
          },
        );
      } catch (error) {
        preferenceError = error;
      } finally {
        if (baseline.value) {
          try {
            await restorePreferenceBaseline(
              panel,
              preference,
              baseline,
              (name, observation, passed) => record(name, passed ? 'pass' : 'fail', observation),
            );
          } catch (error) {
            restoreError = error;
            record(
              `original ${preference.label} preference restoration verified`,
              'fail',
              String(error?.message ?? error),
            );
          }
        } else {
          restoreError = new Error(`${preference.caseId}_full_extension_baseline_unavailable`);
          record(
            `original ${preference.label} preference restoration verified`,
            'fail',
            String(restoreError.message),
          );
        }
      }
      if (preferenceError || restoreError)
        throw new Error(
          [preferenceError, restoreError]
            .filter(Boolean)
            .map((error) => String(error?.message ?? error))
            .join('; '),
        );
    });
  }

  for (const [id, runner] of [
    ['T28', runSectionsCase],
    ['T40', runAutoScrapeCase],
    ['T67', runAutoScrapeModeCase],
  ]) {
    const item = cases.find((candidate) => candidate.id.endsWith(id));
    await runFullExtensionRecheck(item, async (record, result) => {
      await runner(panel, reloadSettings, (phase, action, observation, passed) =>
        record(`${phase}: ${action}`, passed ? 'pass' : 'fail', observation),
      );
      if (id === 'T40')
        result.downstreamCapture = {
          status: 'unverified',
          evidence: 'A page-load/background capture was not exercised.',
        };
      if (id === 'T67')
        result.downstreamCapture = {
          status: 'unverified',
          evidence: 'The selected capture mode was checked; downstream capture was not exercised.',
        };
    });
  }
}
