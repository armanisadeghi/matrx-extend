import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { recordMemberAuthTopologyBoundary } from './member-foreground-diagnostic.mjs';

test('member auth boundaries persist the first hidden renderer and changed context before cleanup', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'member-auth-topology-'));
  const output = join(directory, 'report.json');
  let state = {
    targetId: 'panel-one',
    contextId: 'context-one',
    documentId: 'document-one',
    visibility: 'visible',
    windowId: 1,
    activeTab: 1,
  };
  const native = {
    panelTarget: { targetId: 'panel-one', url: 'chrome-extension://example/panel.html' },
    browserSession: {
      send: async (method) => {
        assert.equal(method, 'Target.getTargets');
        return {
          targetInfos: [
            { targetId: state.targetId, url: native.panelTarget.url },
            { targetId: 'other-page', url: 'https://private.example/?token=secret' },
          ],
        };
      },
    },
    attachWorker: async () => ({
      send: async (_method, args) => {
        assert.doesNotMatch(args.expression, /private\.example|token=secret/);
        return {
          result: {
            value: {
              contexts: [
                {
                  contextId: state.contextId,
                  documentId: state.documentId,
                  windowId: state.windowId,
                  tabId: state.activeTab,
                  exactPanel: true,
                },
              ],
              windows: [{ id: state.windowId, focused: true, state: 'normal' }],
              tabs: [{ id: state.activeTab, windowId: state.windowId, active: true }],
            },
          },
        };
      },
      detach: async () => {},
    }),
  };
  const panel = {
    send: async () => ({
      result: {
        value: {
          visibility: state.visibility,
          focused: state.visibility === 'visible',
          secret: 'do-not-persist',
        },
      },
    }),
  };
  const report = { status: 'unverified' };
  const save = (path, value) => writeFile(path, JSON.stringify(value));
  try {
    await recordMemberAuthTopologyBoundary({
      native,
      panel,
      phase: 'before_auth',
      report,
      output,
      writeReport: save,
    });
    state = {
      targetId: 'panel-two',
      contextId: 'context-two',
      documentId: 'document-two',
      visibility: 'hidden',
      windowId: 2,
      activeTab: 2,
    };
    await recordMemberAuthTopologyBoundary({
      native,
      panel,
      phase: 'after_auth',
      report,
      output,
      writeReport: save,
    });
    const persisted = JSON.parse(await readFile(output, 'utf8'));
    assert.deepEqual(
      persisted.auth_topology.map((row) => row.panel_visibility),
      ['visible', 'hidden'],
    );
    assert.deepEqual(
      persisted.auth_topology.map((row) => row.panel_target_ids),
      [['panel-one'], ['panel-two']],
    );
    assert.deepEqual(
      persisted.auth_topology.map((row) => row.panel_contexts[0].document_id),
      ['document-one', 'document-two'],
    );
    assert.deepEqual(
      persisted.auth_topology.map((row) => row.windows[0].id),
      [1, 2],
    );
    assert.doesNotMatch(JSON.stringify(persisted), /token=secret|private\.example|do-not-persist/);

    // A run that starts hidden must still flush its first observation before a later failure.
    const hiddenReport = { status: 'unverified' };
    await recordMemberAuthTopologyBoundary({
      native,
      panel,
      phase: 'before_member_tab_create',
      report: hiddenReport,
      output,
      writeReport: save,
    });
    assert.equal(
      JSON.parse(await readFile(output, 'utf8')).auth_topology[0].panel_visibility,
      'hidden',
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
