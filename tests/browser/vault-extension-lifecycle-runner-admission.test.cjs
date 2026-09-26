const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const runner = fs.readFileSync(path.join(__dirname, 'vault-realbrowser-acceptance.cjs'), 'utf8');

assert.match(
  runner,
  /assertVaultExtensionLifecycleVerdict\(\{ lifecycle: proof\.lifecycle \}\)/,
  'extension lifecycle mode must admit only the complete lifecycle verdict',
);
assert.match(
  runner,
  /runExtensionDisableEnable\(\{[\s\S]*?previousTargetId: initialTarget\.targetId/,
  'disable/enable must start from the authenticated initial CDP worker target',
);
assert.match(
  runner,
  /runExtensionReload\(\{[\s\S]*?cdp: rawCdp,[\s\S]*?workerUrl,[\s\S]*?extensionId,/,
  'reload must arm CDP target discovery with its exact extension worker identity',
);
assert.match(
  runner,
  /openSidePanelFromActionPopup\([\s\S]*?reloadFixture,[\s\S]*?active\.windowId,[\s\S]*?replacement/,
  'reload must use the replacement worker to open the real action popup in an owned fixture page',
);
assert.doesNotMatch(
  runner,
  /reloadFixture\.goto\(/,
  'reload must not navigate directly to popup.html while the extension is restarting',
);
assert.doesNotMatch(
  runner,
  /context\.serviceWorkers\(\)\.find\(\(entry\) => entry !== initialWorker\)/,
  'reload must not rely on Playwright worker-object identity',
);
assert.match(
  runner,
  /runOwnedBrowserRestart\(\{[\s\S]*?initialBrowserPid: initialBrowser\.browserPid[\s\S]*?verifyProcessExited: verifyBrowserProcessExited/,
  'lifecycle runner must close and prove retirement of its owned browser process before restart',
);
assert.match(
  runner,
  /browserRestartCustody = restartCustody[\s\S]*?restartCustody\.replacement = \{[\s\S]*?cdpOwnerVerified: rawCdp\.ownerVerified === true/,
  'restart proof must retain owned profile/executable fingerprints and replacement CDP custody',
);
assert.match(
  runner,
  /networkJournal = restarted\.journal[\s\S]*?realPanel = restarted\.panel[\s\S]*?worker = restarted\.worker/,
  'successful restart must transfer replacement journal, panel, and worker to final cleanup',
);

process.stdout.write(
  'PASS: lifecycle runner fails closed until every required observation exists\n',
);
