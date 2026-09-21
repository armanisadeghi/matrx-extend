const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');

test('Firefox capture diagnostic is value-free and uses the public status projection', () => {
  const source = readFileSync(join(__dirname, 'read-only-auth-driver.mjs'), 'utf8');
  const start = source.indexOf('const diagnoseFixtureCapture');
  const end = source.indexOf('const readOwnedNetworkObserver', start);
  assert.ok(start >= 0 && end > start);
  const diagnostic = source.slice(start, end);
  assert.match(diagnostic, /credential-capture:status/);
  assert.match(diagnostic, /webNavigation\.getFrame/);
  assert.match(diagnostic, /captureLoginsEnabled/);
  assert.match(diagnostic, /JSON\.parse\(blob\)/);
  assert.match(diagnostic, /fixtureSelectedBeforeDiagnostic/);
  assert.match(diagnostic, /sessionSetAccessLevelAvailable/);
  assert.match(diagnostic, /originalHandle/);
  assert.doesNotMatch(diagnostic, /capture\.pending|password|username|authorization|headers|body/i);
});
