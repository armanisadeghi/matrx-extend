'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const runner = fs.readFileSync(path.join(__dirname, 'vault-realbrowser-acceptance.cjs'), 'utf8');
const match = runner.match(
  /async function openSidePanelFromActionPopup[\s\S]*?\n}\nasync function chooseAuthorizedOrganization/,
);
assert.ok(match, 'action_popup_reopen_helper_missing');
const functionSource = match[0].replace(/\nasync function chooseAuthorizedOrganization$/, '');

const extensionId = 'abcdefghijklmnopabcdefghijklmnop';
let targetLookup = 0;
const cdp = {
  send: async (method) => {
    if (method !== 'Target.getTargets') return {};
    targetLookup += 1;
    if (targetLookup === 1) return { targetInfos: [] };
    if (targetLookup === 2)
      return {
        targetInfos: [
          { targetId: 'popup', type: 'page', url: `chrome-extension://${extensionId}/popup.html` },
        ],
      };
    return {
      targetInfos: [
        { targetId: 'panel', type: 'page', url: `chrome-extension://${extensionId}/sidepanel.html` },
      ],
    };
  },
  detach: async () => {},
};
const popup = {
  send: async (method) => {
    if (method === 'Runtime.evaluate')
      return {
        result: { value: { control: true, x: 1, y: 1, width: 8, height: 8, visible: true, hit: true } },
      };
    return {};
  },
  dispose: () => {},
};
const panel = { send: async () => ({}), dispose: () => {}, onEvent: () => () => {} };
const staleWorker = { evaluate: async () => { throw new Error('stale_worker_must_not_be_used'); } };
let replacementCalls = 0;
const replacementWorker = {
  evaluate: async (fn) => {
    replacementCalls += 1;
    return fn.toString().includes('openPopup')
      ? { outcome: 'requested' }
      : [
          {
            documentUrl: `chrome-extension://${extensionId}/sidepanel.html`,
            tabId: -1,
          },
        ];
  },
};
const sandbox = {
  Buffer,
  URL,
  assert: (value, code) => {
    if (!value) throw new Error(code);
  },
  attachPanelSession: async (_cdp, targetId) => (targetId === 'popup' ? popup : panel),
  context: { newCDPSession: async () => cdp },
  fs: { writeFile: async () => {} },
  wait: async () => {},
  worker: staleWorker,
};
vm.createContext(sandbox);
new vm.Script(`${functionSource}; globalThis.openPanel = openSidePanelFromActionPopup;`).runInContext(sandbox);

(async () => {
  const opened = await sandbox.openPanel(extensionId, {}, 7, replacementWorker);
  assert.equal(opened.opened, true);
  assert.equal(opened.panel.targetId, 'panel');
  assert.equal(replacementCalls, 2, 'the replacement worker must open and observe the panel');
  process.stdout.write('PASS: action-popup panel reopening uses its explicit replacement worker facade\n');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
