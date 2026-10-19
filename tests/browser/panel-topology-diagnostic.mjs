import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareHostedReleaseArtifact } from '../../scripts/hosted-release-artifact.mjs';
import { attachTargetSession, runNativeSidepanelQa } from './native-sidepanel-qa-harness.mjs';

// No authentication or model calls. Compare native panel identity across two owned tabs.
const artifactDir = process.env.MATRX_TOPOLOGY_ARTIFACT_DIR;
const sourceSha = process.env.MATRX_TOPOLOGY_SOURCE_SHA;
assert.ok(artifactDir, 'MATRX_TOPOLOGY_ARTIFACT_DIR required');
assert.match(sourceSha ?? '', /^[a-f0-9]{40}$/);
const output = await mkdtemp(join(tmpdir(), 'matrx-panel-topology-'));
const prepared = await prepareHostedReleaseArtifact(artifactDir, output, sourceSha, 'member-chat');
const receipt = JSON.parse(await readFile(prepared.relocatedReceipt, 'utf8'));
const report = {
  scope: 'native topology diagnostic; no product acceptance',
  sourceSha,
  version: receipt.version,
  treeSha256: receipt.treeSha256,
  phases: [],
};
const save = () =>
  writeFile(join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
try {
  await runNativeSidepanelQa({
    headed: process.env.MATRX_TOPOLOGY_HEADED === '1',
    extensionDir: prepared.extensionDir,
    releaseReceiptPath: prepared.relocatedReceipt,
    expectedRelease: receipt,
    artifactRoot: output,
    onBrowserLaunchObservation: (value) => {
      report.displayMode = value;
    },
    exercisePanel: async (native) => {
      const { page, browserSession: cdp, panelTarget } = native;
      const snapshot = async (phase) => {
        const targets = (await cdp.send('Target.getTargets')).targetInfos;
        const panelUrl = new URL(panelTarget.url);
        const extensionOrigin = `${panelUrl.protocol}//${panelUrl.host}/`;
        const workerTarget = targets.find(
          (t) => t.type === 'service_worker' && t.url.startsWith(extensionOrigin),
        );
        assert.ok(workerTarget, 'owned extension worker must exist');
        const worker = await attachTargetSession(cdp, workerTarget.targetId);
        let state;
        try {
          state = await worker.send('Runtime.evaluate', {
            expression: `(async () => ({
            contexts: await chrome.runtime.getContexts({contextTypes:['SIDE_PANEL']}),
            windows: (await chrome.windows.getAll()).map(w=>({id:w.id,focused:w.focused,type:w.type})),
            tabs: (await chrome.tabs.query({})).map(t=>({id:t.id,windowId:t.windowId,active:t.active,url:t.url}))
          }))()`,
            awaitPromise: true,
            returnByValue: true,
          });
          assert.equal(state.exceptionDetails, undefined, 'topology query must succeed');
        } finally {
          await worker.detach();
        }
        const panels = [];
        for (const target of targets.filter((t) => t.url === panelTarget.url)) {
          const session = await attachTargetSession(cdp, target.targetId);
          try {
            const renderer = await session.send('Runtime.evaluate', {
              expression:
                '({visibility:document.visibilityState,focused:document.hasFocus(),url:document.URL})',
              returnByValue: true,
            });
            panels.push({
              targetId: target.targetId,
              original: target.targetId === panelTarget.targetId,
              renderer: renderer.result?.value,
            });
          } finally {
            await session.detach();
          }
        }
        report.phases.push({ phase, topology: state.result.value, panels });
        await save();
      };
      await snapshot('initial');
      const second = await page.context().newPage();
      try {
        await second.goto(page.url(), { waitUntil: 'domcontentloaded' });
        await snapshot('second_tab_loaded');
        const popupPromise = page.context().waitForEvent('page');
        await second.evaluate(() =>
          window.open(location.href, 'owned-topology-popup', 'popup,width=600,height=600'),
        );
        const popup = await popupPromise;
        await popup.waitForLoadState('domcontentloaded');
        await snapshot('popup_loaded');
        await popup.close();
        await snapshot('popup_closed');
        await native.reopenPanel({ page: second });
        await snapshot('second_tab_reopened');
        await page.bringToFront();
        await snapshot('original_tab_foreground');
      } finally {
        await second.close();
      }
    },
  });
  report.completed = true;
} catch (error) {
  report.completed = false;
  report.error = String(error.message);
  process.exitCode = 1;
} finally {
  await save();
  console.log(`PANEL_TOPOLOGY_REPORT ${join(output, 'report.json')}`);
}
