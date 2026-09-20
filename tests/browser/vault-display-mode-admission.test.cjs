/* Display admission must fail before the runner can create a profile, launch
 * Chrome, or load its authenticated environment.  This test intentionally
 * invokes only invalid configurations. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const runner = path.join(__dirname, 'vault-realbrowser-acceptance.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-display-admission-'));

try {
  const rejectBeforeCustody = (name, expectedCode, env) => {
    const stateRoot = path.join(root, name, 'state');
    const result = spawnSync(process.execPath, [runner], {
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        MATRX_REALBROWSER_VAULT_CANARY: 'RUN_UNDER_REVIEW',
        MATRX_VAULT_CANARY_STATE_ROOT: stateRoot,
        ...env,
      },
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.notEqual(result.status, 0, `${name} unexpectedly ran`);
    assert.match(`${result.stderr}${result.stdout}`, new RegExp(expectedCode));
    assert.equal(fs.existsSync(stateRoot), false, `${name} created durable run state`);
  };

  rejectBeforeCustody('missing', 'canary_display_mode_required', {});
  rejectBeforeCustody('unknown', 'canary_display_mode_invalid', { MATRX_VAULT_CANARY_DISPLAY: 'BACKGROUND' });
  rejectBeforeCustody('headless-placement', 'headless_refuses_window_placement', {
    MATRX_VAULT_CANARY_DISPLAY: 'HEADLESS_NO_CLIPBOARD',
    MATRX_VAULT_CANARY_GENERATOR: 'RUN_GENERATOR_TRANSPORT',
    MATRX_VAULT_CANARY_ADMISSION: 'RUN_READ_ONLY_ADMISSION',
    MATRX_VAULT_CANARY_WINDOW_PLACEMENT: '/tmp/not-read-before-refusal.json',
  });
  rejectBeforeCustody('headless-generator', 'headless_requires_generator_transport', {
    MATRX_VAULT_CANARY_DISPLAY: 'HEADLESS_NO_CLIPBOARD',
    MATRX_VAULT_CANARY_ADMISSION: 'RUN_READ_ONLY_ADMISSION',
  });
  rejectBeforeCustody('headless-admission', 'headless_requires_read_only_admission', {
    MATRX_VAULT_CANARY_DISPLAY: 'HEADLESS_NO_CLIPBOARD',
    MATRX_VAULT_CANARY_GENERATOR: 'RUN_GENERATOR_TRANSPORT',
  });
  rejectBeforeCustody('headed-foreground', 'headed_canary_requires_foreground_allow', {
    MATRX_VAULT_CANARY_DISPLAY: 'HEADED',
  });
  process.stdout.write('PASS: display modes refuse before profile/browser/auth custody\n');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
