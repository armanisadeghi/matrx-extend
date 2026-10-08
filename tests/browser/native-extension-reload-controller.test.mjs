import assert from 'node:assert/strict';
import test from 'node:test';
import { createOwnedExtensionReloadController } from './native-sidepanel-qa-harness.mjs';

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
