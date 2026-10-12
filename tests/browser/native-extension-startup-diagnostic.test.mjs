import assert from 'node:assert/strict';
import test from 'node:test';
import { extensionStartupDiagnostic } from './native-extension-startup-diagnostic.mjs';
const extensionId = 'cihdmkcdjjckfhjpgoedmgfpoljebaml';
// This guards the missing-worker boundary: absent and disabled must never be conflated.
test('distinguishes absent, disabled, enabled without worker and unavailable registration', () => {
  const statuses = [{}, { [extensionId]: { state: 0 } }, { [extensionId]: { state: 1 } }].map(
    (registry) => extensionStartupDiagnostic({ extensionId, registries: [registry, {}] }).status,
  );
  assert.deepEqual(statuses, ['absent', 'disabled', 'present_without_worker']);
  assert.equal(extensionStartupDiagnostic({ extensionId }).status, 'unknown');
});
test('uses only exact expected extension targets and never outputs their URLs', () => {
  const targetInfos = [
    { type: 'page', url: `chrome-extension://${extensionId}/sidepanel.html?token=private` },
    { type: 'service_worker', url: 'chrome-extension://different/background.js' },
  ];
  const observation = extensionStartupDiagnostic({ extensionId, targetInfos });
  assert.equal(observation.status, 'present_without_worker');
  assert.equal(observation.expectedTargetCount, 1);
  assert.equal(observation.expectedWorkerCount, 0);
  assert.equal(JSON.stringify(observation).includes('private'), false);
  assert.equal(
    extensionStartupDiagnostic({
      extensionId,
      targetInfos: [
        { type: 'service_worker', url: `chrome-extension://${extensionId}/background.js` },
      ],
    }).status,
    'worker_observed',
  );
});
test('allowlists load failure signatures without attributing browser-wide errors to the expected ID', () => {
  const result = extensionStartupDiagnostic({
    extensionId,
    stderr:
      '--load-extension is not allowed in Google Chrome; Failed to load extension /private/secret; Manifest file is missing',
  });
  assert.equal(result.status, 'unknown');
  assert.equal(result.loadFailureReported, true);
  assert.equal(extensionStartupDiagnostic({ extensionId }).loadFailureReported, false);
  assert.deepEqual(result.stderrFlags, {
    loadExtensionSwitchRejected: true,
    extensionLoadFailed: true,
    manifestInvalid: true,
  });
  assert.equal(JSON.stringify(result).includes('secret'), false);
  assert.deepEqual(extensionStartupDiagnostic({ extensionId }).stderrFlags, {
    loadExtensionSwitchRejected: false,
    extensionLoadFailed: false,
    manifestInvalid: false,
  });
});

test('missing worker still exhausts the unchanged wait loop and throws the original failure', async () => {
  // Execute the real wait function with only CDP and time replaced; no browser starts.
  const { readFile } = await import('node:fs/promises');
  const { runInNewContext } = await import('node:vm');
  const source = await readFile(
    new URL('./native-sidepanel-qa-harness.mjs', import.meta.url),
    'utf8',
  );
  const requireSource = source.slice(
    source.indexOf('function requireExpectedExtension('),
    source.indexOf('function requireSpawnedProfileOwner('),
  );
  const waitSource = source.slice(
    source.indexOf('async function waitForExpectedExtension('),
    source.indexOf('async function reloadManagementState('),
  );
  let queries = 0;
  let waits = 0;
  const targets = [{ type: 'page', url: `chrome-extension://${extensionId}/sidepanel.html` }];
  const invoke = runInNewContext(`${requireSource}\n${waitSource}\nwaitForExpectedExtension`, {
    ATTEMPTS: 150,
    WAIT_MS: 100,
    extensionStartupDiagnostic,
    wait: async (ms) => {
      assert.equal(ms, 100);
      waits += 1;
    },
  });
  await assert.rejects(
    invoke(
      {
        send: async (method) => {
          assert.equal(method, 'Target.getTargets');
          queries += 1;
          return { targetInfos: targets };
        },
      },
      extensionId,
    ),
    (error) => {
      assert.equal(error.message, 'native_sidepanel_expected_extension_missing');
      assert.equal(
        extensionStartupDiagnostic({
          extensionId,
          targetObservation: error.extensionStartupObservation,
        }).status,
        'present_without_worker',
      );
      return true;
    },
  );
  assert.equal(queries, 150);
  assert.equal(waits, 150);
});

test('reads only bounded valid owned-profile registries and leaves partial files unknown', async () => {
  const { mkdir, mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { readExtensionStartupRegistries } = await import(
    './native-extension-startup-diagnostic.mjs'
  );
  const profile = await mkdtemp(join(tmpdir(), 'extension-startup-diagnostic-'));
  try {
    await mkdir(join(profile, 'Default'));
    const preferences = join(profile, 'Default', 'Preferences');
    const secure = join(profile, 'Default', 'Secure Preferences');
    await writeFile(preferences, JSON.stringify({ extensions: { settings: {} } }));
    await writeFile(
      secure,
      JSON.stringify({ extensions: { settings: { [extensionId]: { state: 0 } } } }),
    );
    assert.equal(
      extensionStartupDiagnostic({
        extensionId,
        registries: await readExtensionStartupRegistries(profile),
      }).status,
      'disabled',
    );
    await writeFile(preferences, '{"extensions":');
    await writeFile(secure, ' '.repeat(1024 * 1024 + 1));
    assert.equal(
      extensionStartupDiagnostic({
        extensionId,
        registries: await readExtensionStartupRegistries(profile),
      }).status,
      'unknown',
    );
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
});

test('actual startup failure boundary emits safe classification and preserves the original error if its sink fails', async () => {
  const { readFile } = await import('node:fs/promises');
  const { runInNewContext } = await import('node:vm');
  const source = await readFile(
    new URL('./native-sidepanel-qa-harness.mjs', import.meta.url),
    'utf8',
  );
  const boundary = source.slice(
    source.indexOf('    let extensionWorker;'),
    source.indexOf("    onStage('spawn_owner');"),
  );
  for (const sinkFails of [false, true]) {
    const failure = new Error('native_sidepanel_expected_extension_missing');
    failure.extensionStartupObservation = extensionStartupDiagnostic({ extensionId });
    const lines = [];
    const invoke = runInNewContext(`(async () => { ${boundary} })`, {
      cdp: {},
      expectedExtensionId: extensionId,
      profile: '/owned',
      chromeStderr: 'private stderr',
      onStage: () => {},
      waitForExpectedExtension: async () => {
        throw failure;
      },
      extensionStartupDiagnostic,
      readExtensionStartupRegistries: async () => [{ [extensionId]: { state: 0 } }],
      browserDiagnosticFlags: () => ({ hadStderr: true }),
      process: {
        stderr: {
          write: (line) => {
            if (sinkFails) throw new Error('private sink error');
            lines.push(line);
          },
        },
      },
    });
    await assert.rejects(invoke(), (error) => error === failure);
    if (!sinkFails) {
      assert.equal(lines.length, 1);
      const report = JSON.parse(lines[0].slice('BROWSER_EXTENSION_FAILURE '.length));
      assert.equal(report.extensionStartup.status, 'disabled');
      assert.equal(lines[0].includes('private'), false);
      assert.equal(lines[0].includes('/owned'), false);
    }
  }
});

test('one readable empty registry cannot prove absence while positive evidence remains usable', async () => {
  const { mkdir, mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { readExtensionStartupRegistries } = await import(
    './native-extension-startup-diagnostic.mjs'
  );
  const profile = await mkdtemp(join(tmpdir(), 'extension-partial-registry-'));
  try {
    await mkdir(join(profile, 'Default'));
    for (const filename of ['Preferences', 'Secure Preferences']) {
      const file = join(profile, 'Default', filename);
      await writeFile(file, JSON.stringify({ extensions: { settings: {} } }));
      const observation = extensionStartupDiagnostic({
        extensionId,
        registries: await readExtensionStartupRegistries(profile),
      });
      assert.equal(observation.status, 'unknown', `${filename} alone cannot prove absence`);
      assert.equal(observation.registered, null, 'partial registry cannot prove unregistered');
      for (const [state, expected] of [
        [0, 'disabled'],
        [1, 'present_without_worker'],
      ]) {
        await writeFile(
          file,
          JSON.stringify({ extensions: { settings: { [extensionId]: { state } } } }),
        );
        const positive = extensionStartupDiagnostic({
          extensionId,
          registries: await readExtensionStartupRegistries(profile),
        });
        assert.equal(positive.status, expected);
        assert.equal(positive.registered, true);
      }
      await rm(file);
    }
    for (const filename of ['Preferences', 'Secure Preferences']) {
      await writeFile(
        join(profile, 'Default', filename),
        JSON.stringify({ extensions: { settings: {} } }),
      );
    }
    const complete = extensionStartupDiagnostic({
      extensionId,
      registries: await readExtensionStartupRegistries(profile),
    });
    assert.equal(complete.status, 'absent');
    assert.equal(complete.registered, false);
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
});
