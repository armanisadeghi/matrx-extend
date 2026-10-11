import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { withOwnedTabCleanup } from './tab-groups-member-failure.mjs';
import {
  runTabGroupsMemberScenarios,
  verifyTabGroupState,
} from './tab-groups-member-scenarios.mjs';

// SUT owns sequencing, expected state, report retention and native/list comparison.
// Only its Chrome snapshot and rendered-tool execution boundaries are simulated here.
function externalBrowser({ offset = 0, breakAt, breakMode = 'no_op' } = {}) {
  const ids = [41, 42, 43, 44, 45].map((id) => id + offset);
  const windowId = 7 + offset;
  const snapshot = {
    tabs: [
      ...ids.map((id) => ({ id, windowId, groupId: -1, url: `http://owned.test/${id}` })),
      { id: 10, windowId, groupId: 3, url: 'http://northline.test/orders' },
      { id: 11, windowId: 8 + offset, groupId: 4, url: 'http://northline.test/delivery' },
    ],
    groups: [
      { id: 3, windowId, title: 'Orders', color: 'blue', collapsed: false },
      { id: 4, windowId: 8 + offset, title: 'Delivery', color: 'green', collapsed: true },
    ],
  };
  const calls = [];
  const list = () => ({
    count: snapshot.groups.length,
    groups: snapshot.groups.map((group) => ({
      id: group.id,
      window_id: group.windowId,
      title: group.title,
      color: group.color,
      collapsed: group.collapsed,
      tab_ids: snapshot.tabs.filter((tab) => tab.groupId === group.id).map((tab) => tab.id),
    })),
  });
  let creation = 0;
  let update = 0;
  const runTool = async (name, args) => {
    const label =
      name === 'get_tab_groups'
        ? name
        : args.action === 'create'
          ? `create_${++creation === 1 ? 'true' : 'false'}`
          : args.action === 'update'
            ? `update_${++update === 1 ? 'true' : 'false'}`
            : args.action;
    calls.push({ name, args: structuredClone(args), label });
    const broken = label === breakAt;
    if (broken && breakMode === 'throw') throw new Error('panel transport details must not leak');
    if (name === 'get_tab_groups' || args.action === 'list') {
      const result = list();
      if (broken) result.groups[2].collapsed = !result.groups[2].collapsed;
      return result;
    }
    if (args.action === 'create') {
      const id = 90 + creation + offset;
      snapshot.groups.push({
        id,
        windowId,
        title: args.title,
        color: args.color,
        collapsed: broken ? !args.collapsed : args.collapsed,
      });
      for (const tab of snapshot.tabs) if (args.tab_ids.includes(tab.id)) tab.groupId = id;
      return { ok: true, group_id: id };
    }
    if (broken && breakMode === 'no_op') return { ok: true };
    if (args.action === 'update')
      Object.assign(
        snapshot.groups.find((group) => group.id === args.group_id),
        Object.fromEntries(
          ['title', 'color', 'collapsed']
            .filter((key) => key in args)
            .map((key) => [key, args[key]]),
        ),
      );
    if (args.action === 'add' || args.action === 'remove') {
      for (const tab of snapshot.tabs)
        if (args.tab_ids.includes(tab.id)) tab.groupId = args.action === 'add' ? args.group_id : -1;
    }
    if (broken && breakMode === 'non_owned_tab')
      snapshot.tabs.find((tab) => tab.id === 11).groupId = args.group_id;
    if (broken && breakMode === 'non_owned_group')
      snapshot.groups.find((group) => group.id === 4).collapsed = false;
    if (broken && breakMode === 'wrong_window')
      snapshot.tabs.find((tab) => tab.id === ids[2]).windowId++;
    return { ok: true };
  };
  return {
    ids,
    windowId,
    snapshot,
    calls,
    runTool,
    observeChrome: async () => structuredClone(snapshot),
  };
}

async function run(browser, report = { fixture: {} }) {
  const created = [];
  const result = await runTabGroupsMemberScenarios({
    ...browser,
    report,
    title: 'Northline catalog',
    color: 'cyan',
    onGroupCreated: (id) => created.push(id),
  });
  return { report, created, result };
}

for (const offset of [0, 200]) {
  test(`all branches require actual snapshots and get_tab_groups after each operation (${offset})`, async () => {
    const browser = externalBrowser({ offset });
    const { report, created } = await run(browser);
    assert.deepEqual(Object.keys(report.branches), [
      'create_true',
      'create_false',
      'update_true',
      'update_false',
      'add',
      'remove',
      'list',
    ]);
    assert.deepEqual(
      Object.values(report.branches).map((entry) => entry.status),
      Array(7).fill('passed'),
    );
    assert.deepEqual(
      browser.calls.map((call) => call.label),
      [
        'create_true',
        'get_tab_groups',
        'create_false',
        'get_tab_groups',
        'update_true',
        'get_tab_groups',
        'update_false',
        'get_tab_groups',
        'add',
        'get_tab_groups',
        'remove',
        'get_tab_groups',
        'list',
        'get_tab_groups',
      ],
    );
    assert.deepEqual(created, [91 + offset, 92 + offset]);
    assert.equal(report.create.passed, true);
    assert.equal(report.create.collapsed_requested, true);
    assert.equal(report.branches.create_false.chrome.groups[1].collapsed, false);
    assert.equal(report.branches.update_true.chrome.groups[1].collapsed, true);
    assert.equal(report.branches.update_false.chrome.groups[1].collapsed, false);
    assert.equal(report.branches.add.chrome.tabs[4].groupId, 92 + offset);
    assert.equal(report.branches.remove.chrome.tabs[4].groupId, -1);
    assert.deepEqual(browser.snapshot.groups.slice(2), [
      {
        id: 91 + offset,
        windowId: 7 + offset,
        title: 'Northline catalog',
        color: 'cyan',
        collapsed: true,
      },
      {
        id: 92 + offset,
        windowId: 7 + offset,
        title: 'Northline catalog revised',
        color: 'purple',
        collapsed: false,
      },
    ]);
  });
}

for (const branch of [
  'create_true',
  'create_false',
  'update_true',
  'update_false',
  'add',
  'remove',
  'list',
]) {
  test(`${branch} cannot pass on a successful response with incorrect Chrome or canonical state`, async () => {
    const report = { fixture: {} };
    await assert.rejects(
      run(externalBrowser({ breakAt: branch }), report),
      /native_readback_mismatch/,
    );
    assert.equal(report.branches[branch].status, 'failed');
    assert.equal(Object.values(report.branches).at(-1).status, 'failed');
    if (branch !== 'create_true') assert.equal(report.branches.create_true.status, 'passed');
  });
}

for (const breakMode of ['non_owned_tab', 'non_owned_group', 'wrong_window']) {
  test(`add refuses ${breakMode} even when native and canonical group outputs agree`, async () => {
    const report = { fixture: {} };
    await assert.rejects(
      run(externalBrowser({ breakAt: 'add', breakMode }), report),
      /native_readback_mismatch/,
    );
    assert.equal(report.branches.add.status, 'failed');
    assert.equal(report.branches.create_false.status, 'passed');
  });
}

test('later read failure preserves true/false observations and first failure through failed cleanup', async () => {
  const report = { fixture: {} };
  const browser = externalBrowser({ breakAt: 'update_false', breakMode: 'throw' });
  const cleaned = [];
  await assert.rejects(
    withOwnedTabCleanup(
      report,
      () => run(browser, report),
      async () => {
        cleaned.push(...browser.ids);
        throw new Error('tab_groups_owned_tab_cleanup_unverified');
      },
    ),
    /panel transport/,
  );
  assert.deepEqual(cleaned, [41, 42, 43, 44, 45]);
  assert.equal(report.failure_stage, 'tab_groups_update_false');
  assert.equal(report.failure_code, 'tab_groups_update_false_failed');
  assert.equal(report.branches.update_false.failure_code, 'tab_groups_update_false_failed');
  assert.equal(report.branches.create_true.status, 'passed');
  assert.equal(report.branches.create_false.status, 'passed');
  assert.equal(report.branches.update_true.status, 'passed');
  assert.equal(report.branches.update_false.status, 'failed');
  assert.equal(report.cleanup_failure_code, 'tab_groups_owned_tab_cleanup_unverified');
  assert.equal(JSON.stringify(report).includes('transport details'), false);
});

test('oracle refuses empty, missing and duplicate canonical group observations', async () => {
  const browser = externalBrowser();
  const baseline = await browser.observeChrome();
  const valid = {
    snapshot: baseline,
    baseline,
    ids: browser.ids,
    windowId: browser.windowId,
    groups: [],
  };
  const canonical = {
    count: 2,
    groups: [
      { id: 3, window_id: 7, title: 'Orders', color: 'blue', collapsed: false, tab_ids: [10] },
      { id: 4, window_id: 8, title: 'Delivery', color: 'green', collapsed: true, tab_ids: [11] },
    ],
  };
  assert.equal(verifyTabGroupState({ ...valid, readback: canonical }).passed, true);
  for (const readback of [
    null,
    { count: 0, groups: [] },
    { ...canonical, count: 4 },
    { count: 2, groups: [canonical.groups[0], canonical.groups[0]] },
  ]) {
    assert.equal(verifyTabGroupState({ ...valid, readback }).passed, false);
  }
});

test('native driver binds real Chrome reads and manual UI runs to the scenario guard', async () => {
  const source = await readFile(
    new URL('./tab-groups-member-native-acceptance.mjs', import.meta.url),
    'utf8',
  );
  // Structural binding guard only. Hosted native execution remains required for product proof.
  assert.match(
    source,
    /runTool: \(name, args\) => resourceAction\(\(\) => runCanonicalTool\(panel, name, args\)\)/,
  );
  assert.match(source, /observeChrome: \(\) => resourceAction\(\(\) => observeChrome\(panel\)\)/);
  assert.match(source, /chrome\.tabGroups\.query\(\{\}\),chrome\.tabs\.query\(\{\}\)/);
  assert.match(source, /removeOwnedTabs\(panel, ids, report\.fixture_group_ids\)/);
  assert.match(source, /stableTabGroupSnapshot\(baseline, ids\)/);
});

test('refuses a fixture moved to another window or already grouped before any tool runs', async () => {
  for (const change of [
    (browser) => {
      browser.snapshot.tabs[0].windowId = 99;
    },
    (browser) => {
      browser.snapshot.tabs[0].groupId = 3;
    },
    (browser) => {
      browser.snapshot.tabs.pop();
      browser.snapshot.tabs.shift();
    },
  ]) {
    const browser = externalBrowser();
    change(browser);
    await assert.rejects(run(browser), /owned_fixture_not_ready/);
    assert.deepEqual(browser.calls, []);
  }
});

test('original true-create refusal retains its original stage, code and partial result', async () => {
  const browser = externalBrowser();
  const report = { fixture: {} };
  browser.runTool = async () => ({ ok: false });
  await assert.rejects(
    withOwnedTabCleanup(
      report,
      () => run(browser, report),
      async () => {},
    ),
    /tab_groups_create_refused/,
  );
  assert.equal(report.failure_stage, 'tab_groups_create');
  assert.equal(report.failure_code, 'tab_groups_create_refused');
  assert.deepEqual(report.create, {
    ok: false,
    group_id_observed: false,
    collapsed_requested: true,
  });
});
