import assert from 'node:assert/strict';
import test from 'node:test';
import { runOwnedPanelReopen } from './native-panel-reopen-boundary.mjs';
import { createOwnedExtensionReloadController } from './native-sidepanel-qa-harness.mjs';

test('T93 close/reopen requires both retirement boundaries and a distinct visible reacquired panel', async () => {
  const events = [];
  const make = (overrides = {}) => ({
    identify: async () => ({ targetId: 'old', contextId: 'old-context' }),
    close: async () => {
      events.push('close');
      return true;
    },
    retired: async () => {
      events.push('retired');
      return { targetRetired: true, contextRetired: true };
    },
    open: async () => {
      events.push('open');
      return true;
    },
    acquire: async () => {
      events.push('acquire');
      return { panel: { targetId: 'new' }, contextId: 'new-context', visible: true };
    },
    ...overrides,
  });
  const result = await runOwnedPanelReopen(make());
  assert.equal(result.panel.targetId, 'new');
  assert.deepEqual(events, ['close', 'retired', 'open', 'acquire']);
  for (const retirement of [
    { targetRetired: false, contextRetired: true },
    { targetRetired: true, contextRetired: false },
  ]) {
    events.length = 0;
    await assert.rejects(
      runOwnedPanelReopen(make({ retired: async () => retirement })),
      /native_panel_reopen_failed:retirement/,
    );
    assert.deepEqual(events, ['close']);
  }
  for (const replacement of [
    { panel: { targetId: 'old' }, contextId: 'new-context', visible: true },
    { panel: { targetId: 'new' }, contextId: 'old-context', visible: true },
    { panel: { targetId: 'new' }, contextId: 'new-context', visible: false },
    { contextId: 'new-context', visible: true },
  ])
    await assert.rejects(
      runOwnedPanelReopen(make({ acquire: async () => replacement })),
      /native_panel_reopen_failed:reacquire/,
    );
  await assert.rejects(runOwnedPanelReopen(make({ close: async () => false })), /failed:close/);
  await assert.rejects(
    runOwnedPanelReopen(make({ open: async () => false })),
    /failed:trusted_open/,
  );
});

const provenReplacement = (targetId) => ({
  management_reload_clicked: true,
  old_targets_retired: true,
  worker_replaced: true,
  panel_replaced: true,
  replacement_panel_target_id: targetId,
  retirement_evidence: { timeline: { final_predicate: true } },
  panel: { targetId },
});

test('EXT-D-0186 each real extension reload receives the immediately previous replacement panel target', async () => {
  const inputs = [];
  const controller = createOwnedExtensionReloadController('panel-initial', async (oldPanelId) => {
    inputs.push(oldPanelId);
    return provenReplacement(`panel-replacement-${inputs.length}`);
  });

  const first = await controller.reload();
  const second = await controller.reload();

  assert.deepEqual(inputs, ['panel-initial', 'panel-replacement-1']);
  assert.equal(first.panel.targetId, 'panel-replacement-1');
  assert.equal(second.panel.targetId, 'panel-replacement-2');
});

test('EXT-D-0186 panel-only reload cannot advance the extension lifecycle target', async () => {
  const inputs = [];
  const controller = createOwnedExtensionReloadController('panel-initial', async (oldPanelId) => {
    inputs.push(oldPanelId);
    return { panel: { targetId: 'panel-document-reload-only' } };
  });

  await assert.rejects(controller.reload(), /native_extension_replacement_panel_unverified/);
  await assert.rejects(controller.reload(), /native_extension_replacement_panel_unverified/);
  assert.deepEqual(inputs, ['panel-initial', 'panel-initial']);
});

test('EXT-D-0186 cleanup can adopt only a current acquired panel before another full restart', async () => {
  const inputs = [];
  const controller = createOwnedExtensionReloadController('panel-initial', async (oldPanelId) => {
    inputs.push(oldPanelId);
    return provenReplacement(`panel-replacement-${inputs.length}`);
  });
  controller.adoptLivePanel({ targetId: 'panel-reacquired-from-live-extension' });

  await controller.reload();

  assert.deepEqual(inputs, ['panel-reacquired-from-live-extension']);
});
