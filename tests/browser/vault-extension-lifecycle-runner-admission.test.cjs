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
  /waitForReplacementExtensionWorkerTarget\(\{[\s\S]*?previousTargetId: enabledTarget\.targetId/,
  'reload must wait for a distinct CDP worker target rather than a Playwright facade',
);
assert.doesNotMatch(
  runner,
  /context\.serviceWorkers\(\)\.find\(\(entry\) => entry !== initialWorker\)/,
  'reload must not rely on Playwright worker-object identity',
);

process.stdout.write(
  'PASS: lifecycle runner fails closed until every required observation exists\n',
);
