const assert = require('node:assert/strict');
const {
  lifecycleButtonExpression,
  windowSwitchUiCleared,
} = require('./vault-generator-acceptance.cjs');
const noSectionDocument = { querySelector: () => null };
assert.equal(
  new Function('document', `return ${lifecycleButtonExpression('Generate')}`)(noSectionDocument),
  undefined,
);
assert.equal(windowSwitchUiCleared({ sectionPresent: false }), true);
assert.equal(windowSwitchUiCleared(undefined), false);
const cleared = {
  sectionPresent: true,
  codePresent: false,
  revealPresent: false,
  hidePresent: false,
  offerPresent: false,
  copyPresent: false,
  usePresent: false,
  regeneratePresent: false,
  actionLabel: 'generate',
  actionReady: true,
};
assert.equal(windowSwitchUiCleared(cleared), true);
for (const key of [
  'codePresent',
  'revealPresent',
  'hidePresent',
  'offerPresent',
  'copyPresent',
  'usePresent',
  'regeneratePresent',
]) {
  assert.equal(
    windowSwitchUiCleared({ ...cleared, [key]: true }),
    false,
    `retained ${key} accepted`,
  );
}
assert.equal(windowSwitchUiCleared({ ...cleared, actionReady: false }), false);
assert.equal(windowSwitchUiCleared({ ...cleared, actionLabel: 'regenerate' }), false);
process.stdout.write(
  'PASS: null section is safe and retained candidate controls cannot pass clearing\n',
);
