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
