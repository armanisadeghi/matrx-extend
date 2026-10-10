import assert from 'node:assert/strict';
import test from 'node:test';
import {
  allHandlersTriggerSelected,
  hostedTabGroupsRoute,
  verifyTabGroupsCreateObservation,
} from './hosted-tab-groups-route.mjs';

const prepared = {
  kind: 'ci_development_test',
  sourceSha: 'a'.repeat(40),
  runId: 12345,
  artifactId: 67890,
  extensionDir: '/tmp/ci-artifact/chrome-mv3',
  relocatedReceipt: '/tmp/ci-artifact/local-dev-receipt.json',
};

test('only the exact member case binds a verified development artifact to the tab-groups driver', () => {
  assert.deepEqual(hostedTabGroupsRoute('tab-groups-member', prepared), {
    driver: 'tests/browser/tab-groups-member-native-acceptance.mjs',
    env: {
      MATRX_TAB_GROUPS_EXTENSION_DIR: prepared.extensionDir,
      MATRX_TAB_GROUPS_RECEIPT: prepared.relocatedReceipt,
      MATRX_TAB_GROUPS_SOURCE_SHA: prepared.sourceSha,
      MATRX_TAB_GROUPS_CI_RUN_ID: '12345',
      MATRX_TAB_GROUPS_CI_ARTIFACT_ID: '67890',
    },
  });
  assert.throws(() => hostedTabGroupsRoute('guest-chat', prepared), /case_refused/);
  assert.throws(
    () => hostedTabGroupsRoute('tab-groups-member', { ...prepared, kind: 'published_store_zip' }),
    /ci_artifact_required/,
  );
  assert.throws(
    () => hostedTabGroupsRoute('tab-groups-member', { ...prepared, artifactId: 'latest' }),
    /artifact_required/,
  );
});

test('All handlers selection requires the unique post-click trigger state', () => {
  assert.equal(allHandlersTriggerSelected({ count: 1, selected: true }), true);
  for (const summary of [
    { count: 0, selected: false },
    { count: 2, selected: true },
    { count: 1, selected: false },
    null,
  ]) {
    assert.equal(allHandlersTriggerSelected(summary), false);
  }
});

test('create proof requires the returned group, native collapsed state, exact members, and canonical readback', () => {
  const expectedTabIds = [4102, 4103];
  const createResult = { ok: true, group_id: 92 };
  const chromeGroup = {
    id: 92,
    collapsed: true,
    title: 'Matrx D148 Northline catalog',
    color: 'cyan',
    windowId: 7,
  };
  const readback = {
    count: 1,
    groups: [
      {
        id: 92,
        collapsed: true,
        title: 'Matrx D148 Northline catalog',
        color: 'cyan',
        window_id: 7,
        tab_ids: [4103, 4102],
      },
    ],
  };
  const input = {
    createResult,
    chromeGroup,
    chromeTabIds: expectedTabIds,
    readback,
    expectedTabIds,
    expectedWindowId: 7,
    expectedTitle: 'Matrx D148 Northline catalog',
    expectedColor: 'cyan',
  };
  assert.equal(verifyTabGroupsCreateObservation(input).passed, true);

  for (const broken of [
    { ...input, chromeGroup: { ...chromeGroup, collapsed: false } },
    { ...input, chromeGroup: { ...chromeGroup, id: 93 } },
    { ...input, chromeGroup: { ...chromeGroup, title: 'Unexpected title' } },
    { ...input, chromeGroup: { ...chromeGroup, color: 'blue' } },
    { ...input, chromeGroup: { ...chromeGroup, windowId: 8 } },
    { ...input, chromeTabIds: [4102] },
    { ...input, readback: { ...readback, groups: [{ ...readback.groups[0], id: 93 }] } },
    { ...input, readback: { ...readback, groups: [{ ...readback.groups[0], collapsed: false }] } },
    {
      ...input,
      readback: { ...readback, groups: [{ ...readback.groups[0], title: 'Unexpected title' }] },
    },
    { ...input, readback: { ...readback, groups: [{ ...readback.groups[0], color: 'blue' }] } },
    { ...input, readback: { ...readback, groups: [{ ...readback.groups[0], window_id: 8 }] } },
    {
      ...input,
      readback: { ...readback, groups: [{ ...readback.groups[0], tab_ids: [4102, 4199] }] },
    },
    { ...input, createResult: { ok: false, group_id: 92 } },
    { ...input, readback: { count: 2, groups: readback.groups } },
  ]) {
    assert.equal(verifyTabGroupsCreateObservation(broken).passed, false);
  }
});
