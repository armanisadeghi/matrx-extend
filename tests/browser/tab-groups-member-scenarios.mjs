import assert from 'node:assert/strict';
import { verifyTabGroupsCreateObservation } from '../../scripts/hosted-tab-groups-route.mjs';
import { tabGroupsFailureCode } from './tab-groups-member-failure.mjs';

const sorted = (rows) => [...rows].sort((a, b) => a.id - b.id);
const sortedIds = (ids) => [...ids].sort((a, b) => a - b);

// Compare stable Chrome state only: loading/selection changes are not group mutations.
export function stableTabGroupSnapshot(snapshot, excludedTabIds = [], excludedGroupIds = []) {
  return {
    tabs: sorted(snapshot.tabs.filter((tab) => !excludedTabIds.includes(tab.id))).map((tab) => ({
      id: tab.id,
      windowId: tab.windowId,
      groupId: tab.groupId,
      url: tab.url,
    })),
    groups: sorted(snapshot.groups.filter((group) => !excludedGroupIds.includes(group.id))).map(
      (group) => ({
        id: group.id,
        windowId: group.windowId,
        title: group.title,
        color: group.color,
        collapsed: group.collapsed,
      }),
    ),
  };
}

export function verifyTabGroupState({ snapshot, readback, baseline, ids, windowId, groups }) {
  const groupIds = groups.map((group) => group.id);
  const isolation =
    JSON.stringify(stableTabGroupSnapshot(snapshot, ids, groupIds)) ===
    JSON.stringify(stableTabGroupSnapshot(baseline, ids));
  const ownedTabsMatch = ids.every((id) => {
    const matches = snapshot.tabs.filter((tab) => tab.id === id);
    const expected = groups.find((group) => group.tabIds.includes(id));
    return (
      matches.length === 1 &&
      matches[0].windowId === windowId &&
      matches[0].groupId === (expected?.id ?? -1)
    );
  });
  const chromeMatches = groups.every((expected) => {
    const matches = snapshot.groups.filter((group) => group.id === expected.id);
    const group = matches[0];
    return (
      matches.length === 1 &&
      group.windowId === windowId &&
      group.title === expected.title &&
      group.color === expected.color &&
      group.collapsed === expected.collapsed &&
      JSON.stringify(
        sortedIds(snapshot.tabs.filter((tab) => tab.groupId === group.id).map((tab) => tab.id)),
      ) === JSON.stringify(sortedIds(expected.tabIds))
    );
  });
  const nativeList = sorted(snapshot.groups).map((group) => ({
    id: group.id,
    title: group.title,
    color: group.color,
    collapsed: group.collapsed,
    window_id: group.windowId,
    tab_ids: sortedIds(
      snapshot.tabs.filter((tab) => tab.groupId === group.id).map((tab) => tab.id),
    ),
  }));
  const canonicalList = Array.isArray(readback?.groups)
    ? sorted(readback.groups).map((group) => ({
        id: group.id,
        title: group.title,
        color: group.color,
        collapsed: group.collapsed,
        window_id: group.window_id,
        tab_ids: Array.isArray(group.tab_ids) ? sortedIds(group.tab_ids) : null,
      }))
    : null;
  const canonicalMatches =
    readback?.count === nativeList.length &&
    JSON.stringify(canonicalList) === JSON.stringify(nativeList);
  return {
    non_owned_unchanged: isolation,
    owned_tabs_match: ownedTabsMatch,
    chrome_groups_match: chromeMatches,
    canonical_readback_matches: canonicalMatches,
    passed: isolation && ownedTabsMatch && chromeMatches && canonicalMatches,
  };
}

// runTool must use the rendered manual runner; observeChrome must read the real Chrome APIs.
// Injecting those external boundaries enables source guards, never native product evidence.
export async function runTabGroupsMemberScenarios({
  report,
  ids,
  windowId,
  title,
  color,
  runTool,
  observeChrome,
  onGroupCreated = () => {},
  onBaseline = () => {},
}) {
  assert.ok(
    ids.length === 5 && new Set(ids).size === 5 && ids.every(Number.isSafeInteger),
    'tab_groups_five_owned_tabs_required',
  );
  const baseline = await observeChrome();
  onBaseline(baseline);
  assert.ok(
    ids.every((id) => {
      const matches = baseline.tabs.filter((tab) => tab.id === id);
      return matches.length === 1 && matches[0].windowId === windowId && matches[0].groupId === -1;
    }),
    'tab_groups_owned_fixture_not_ready',
  );
  report.fixture.baseline_counts = { tabs: baseline.tabs.length, groups: baseline.groups.length };
  const groups = [];
  report.branches = {};
  const branch = async (name, args, apply) => {
    report.stage = name === 'create_true' ? 'tab_groups_create' : `tab_groups_${name}`;
    const entry = {
      status: 'unverified',
      action: args.action,
      collapsed_requested: args.collapsed ?? null,
    };
    report.branches[name] = entry;
    try {
      const result = await runTool('tab_groups', args);
      entry.result_ok =
        args.action === 'list' ? Array.isArray(result?.groups) : result?.ok === true;
      if (name === 'create_true') {
        report.fixture_group_id = Number.isSafeInteger(result?.group_id) ? result.group_id : null;
        report.create = {
          ok: result?.ok === true,
          group_id_observed: report.fixture_group_id !== null,
          collapsed_requested: true,
        };
      }
      if (args.action !== 'list')
        assert.equal(
          result?.ok,
          true,
          name === 'create_true' ? 'tab_groups_create_refused' : 'tab_groups_operation_refused',
        );
      if (args.action === 'create') {
        assert.ok(
          Number.isSafeInteger(result?.group_id) && result.group_id >= 0,
          'tab_groups_create_group_id_missing',
        );
        // Register for cleanup before any subsequent assertion/readback can fail.
        onGroupCreated(result.group_id);
        entry.group_id = result.group_id;
        assert.ok(
          !baseline.groups.some((group) => group.id === result.group_id) &&
            !groups.some((group) => group.id === result.group_id),
          'tab_groups_created_group_not_owned',
        );
      }
      apply(result);
      const snapshot = await observeChrome();
      entry.chrome = stableTabGroupSnapshot(
        snapshot,
        baseline.tabs.filter((tab) => !ids.includes(tab.id)).map((tab) => tab.id),
        baseline.groups.map((group) => group.id),
      );
      report.stage =
        name === 'create_true' ? 'tab_groups_get_tab_groups' : `tab_groups_${name}_get_tab_groups`;
      const readback = await runTool('get_tab_groups', {});
      entry.proof = verifyTabGroupState({ snapshot, readback, baseline, ids, windowId, groups });
      if (args.action === 'list') {
        entry.canonical_list_proof = verifyTabGroupState({
          snapshot,
          readback: result,
          baseline,
          ids,
          windowId,
          groups,
        });
        assert.equal(
          entry.canonical_list_proof.passed,
          true,
          'tab_groups_list_native_readback_mismatch',
        );
      }
      if (name === 'create_true') {
        const group = snapshot.groups.find((item) => item.id === result.group_id);
        report.fixture_group_id = result.group_id;
        report.create = {
          ...verifyTabGroupsCreateObservation({
            createResult: result,
            chromeGroup: group,
            chromeTabIds: snapshot.tabs
              .filter((tab) => tab.groupId === result.group_id)
              .map((tab) => tab.id),
            readback,
            expectedTabIds: ids.slice(0, 2),
            expectedWindowId: windowId,
            expectedTitle: title,
            expectedColor: color,
          }),
          collapsed_requested: true,
        };
        report.readback = {
          list_count: readback?.count ?? null,
          group_match: report.create.readback_matches,
        };
        assert.equal(
          report.create.passed,
          true,
          'tab_groups_create_collapsed_native_readback_mismatch',
        );
      }
      assert.equal(entry.proof.passed, true, 'tab_groups_operation_native_readback_mismatch');
      entry.status = 'passed';
    } catch (error) {
      entry.status = 'failed';
      entry.failure_stage = report.stage;
      entry.failure_code = tabGroupsFailureCode(error, report);
      throw error;
    }
  };
  await branch(
    'create_true',
    { action: 'create', tab_ids: ids.slice(0, 2), title, color, collapsed: true },
    (result) =>
      groups.push({ id: result.group_id, title, color, collapsed: true, tabIds: ids.slice(0, 2) }),
  );
  const expandedTitle = `${title} expanded`;
  await branch(
    'create_false',
    {
      action: 'create',
      tab_ids: ids.slice(2, 4),
      title: expandedTitle,
      color: 'orange',
      collapsed: false,
    },
    (result) =>
      groups.push({
        id: result.group_id,
        title: expandedTitle,
        color: 'orange',
        collapsed: false,
        tabIds: ids.slice(2, 4),
      }),
  );
  const group = groups[1];
  const updatedTitle = `${title} revised`;
  await branch(
    'update_true',
    { action: 'update', group_id: group.id, title: updatedTitle, color: 'purple', collapsed: true },
    () => Object.assign(group, { title: updatedTitle, color: 'purple', collapsed: true }),
  );
  await branch('update_false', { action: 'update', group_id: group.id, collapsed: false }, () => {
    group.collapsed = false;
  });
  await branch('add', { action: 'add', group_id: group.id, tab_ids: [ids[4]] }, () => {
    group.tabIds = ids.slice(2);
  });
  await branch('remove', { action: 'remove', tab_ids: [ids[4]] }, () => {
    group.tabIds = ids.slice(2, 4);
  });
  await branch('list', { action: 'list' }, () => {});
  return { baseline, groupIds: groups.map((item) => item.id) };
}
