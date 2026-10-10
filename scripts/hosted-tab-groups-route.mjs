import assert from 'node:assert/strict';

export function hostedTabGroupsRoute(acceptanceCase, prepared) {
  assert.equal(acceptanceCase, 'tab-groups-member', 'hosted_tab_groups_case_refused');
  assert.equal(prepared?.kind, 'ci_development_test', 'hosted_tab_groups_ci_artifact_required');
  assert.match(prepared.sourceSha ?? '', /^[a-f0-9]{40}$/, 'hosted_tab_groups_source_required');
  assert.match(String(prepared.runId ?? ''), /^[1-9][0-9]*$/, 'hosted_tab_groups_run_required');
  assert.match(
    String(prepared.artifactId ?? ''),
    /^[1-9][0-9]*$/,
    'hosted_tab_groups_artifact_required',
  );
  assert.ok(prepared.extensionDir?.startsWith('/'), 'hosted_tab_groups_extension_required');
  assert.ok(prepared.relocatedReceipt?.startsWith('/'), 'hosted_tab_groups_receipt_required');
  return {
    driver: 'tests/browser/tab-groups-member-native-acceptance.mjs',
    env: {
      MATRX_TAB_GROUPS_EXTENSION_DIR: prepared.extensionDir,
      MATRX_TAB_GROUPS_RECEIPT: prepared.relocatedReceipt,
      MATRX_TAB_GROUPS_SOURCE_SHA: prepared.sourceSha,
      MATRX_TAB_GROUPS_CI_RUN_ID: String(prepared.runId),
      MATRX_TAB_GROUPS_CI_ARTIFACT_ID: String(prepared.artifactId),
    },
  };
}

export function allHandlersTriggerSelected(summary) {
  return summary?.count === 1 && summary.selected === true;
}

const safeIds = (ids) =>
  Array.isArray(ids) &&
  ids.length === 2 &&
  ids.every(Number.isSafeInteger) &&
  new Set(ids).size === 2;

export function verifyTabGroupsCreateObservation({
  createResult,
  chromeGroup,
  chromeTabIds,
  readback,
  expectedTabIds,
  expectedWindowId,
  expectedTitle,
  expectedColor,
}) {
  const groupId = Number.isSafeInteger(createResult?.group_id) ? createResult.group_id : null;
  const expectedIdsValid = safeIds(expectedTabIds);
  const exactIds = (ids) =>
    safeIds(ids) &&
    expectedIdsValid &&
    [...ids].sort((a, b) => a - b).join(',') ===
      [...expectedTabIds].sort((a, b) => a - b).join(',');
  const chromeMatches =
    createResult?.ok === true &&
    groupId !== null &&
    chromeGroup?.id === groupId &&
    chromeGroup?.collapsed === true &&
    chromeGroup?.title === expectedTitle &&
    chromeGroup?.color === expectedColor &&
    chromeGroup?.windowId === expectedWindowId &&
    exactIds(chromeTabIds);
  const reportedGroup = Array.isArray(readback?.groups)
    ? readback.groups.find((group) => group.id === groupId)
    : null;
  const readbackMatches =
    readback?.count === readback?.groups?.length &&
    readback?.count >= 1 &&
    reportedGroup?.collapsed === true &&
    reportedGroup?.title === expectedTitle &&
    reportedGroup?.color === expectedColor &&
    reportedGroup?.window_id === expectedWindowId &&
    exactIds(reportedGroup?.tab_ids);
  return {
    create_ok: createResult?.ok === true,
    group_id_observed: groupId !== null,
    chrome_group_matches: chromeMatches,
    chrome_collapsed: chromeGroup?.collapsed === true,
    chrome_membership_matches: exactIds(chromeTabIds),
    readback_matches: readbackMatches,
    passed: chromeMatches && readbackMatches,
  };
}
