import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { evaluate } from './settings-panel-driver.mjs';
import { preserveFailureDuringCleanup } from './settings-probe-cleanup.mjs';

// Only this lifecycle can brand fixture uncertainty. Public error fields confer no authority.
const integrityFailures = new WeakMap();
export function settingsFixtureIntegrityFailure(error) {
  const value =
    error !== null && (typeof error === 'object' || typeof error === 'function')
      ? integrityFailures.get(error)
      : null;
  return value ? { ...value } : null;
}

// This function executes entirely in the extension. No source value leaves the browser.
async function fixtureStoragePhase(backupKey, owner, phase) {
  const sourceKey = 'matrx.settings.v1';
  const local = chrome.storage.local;
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const digest = async (payload) =>
    Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload))),
    )
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  try {
    if (phase === 'capture') {
      const existing = await local.get(backupKey);
      if (Object.hasOwn(existing, backupKey)) return { ok: false };
      const source = await local.get(sourceKey);
      const present = Object.hasOwn(source, sourceKey);
      const payload = JSON.stringify({ present, ...(present && { raw: source[sourceKey] }) });
      // Unsupported Chrome values must fail before the first source mutation.
      const decoded = JSON.parse(payload);
      if (present && (!Object.hasOwn(decoded, 'raw') || !equal(decoded.raw, source[sourceKey])))
        return { ok: false };
      const envelope = { schema: 1, sourceKey, owner, payload, seal: await digest(payload) };
      await local.set({ [backupKey]: envelope });
      const readback = await local.get([backupKey, sourceKey]);
      return {
        ok:
          equal(readback[backupKey], envelope) &&
          Object.hasOwn(readback, sourceKey) === present &&
          (!present || equal(readback[sourceKey], decoded.raw)),
      };
    }
    const entries = await local.get(backupKey);
    const envelope = entries[backupKey];
    if (phase === 'inspect' && !Object.hasOwn(entries, backupKey))
      return { ok: true, backupPresent: false, backupOwned: false, snapshotRetained: false };
    if (
      !envelope ||
      envelope.schema !== 1 ||
      envelope.sourceKey !== sourceKey ||
      envelope.owner !== owner ||
      typeof envelope.payload !== 'string' ||
      envelope.seal !== (await digest(envelope.payload))
    )
      return phase === 'inspect'
        ? {
            ok: true,
            backupPresent: Object.hasOwn(entries, backupKey),
            backupOwned: false,
            snapshotRetained: false,
          }
        : { ok: false };
    const saved = JSON.parse(envelope.payload);
    if (typeof saved.present !== 'boolean' || (saved.present && !Object.hasOwn(saved, 'raw')))
      return { ok: false };
    if (phase === 'inspect')
      return { ok: true, backupPresent: true, backupOwned: true, snapshotRetained: true };
    if (phase === 'restore') {
      if (saved.present) await local.set({ [sourceKey]: saved.raw });
      else await local.remove(sourceKey);
      return { ok: true };
    }
    if (phase === 'verify') {
      const current = await local.get(sourceKey);
      return {
        ok:
          Object.hasOwn(current, sourceKey) === saved.present &&
          (!saved.present || equal(current[sourceKey], saved.raw)),
      };
    }
    if (phase === 'absent') {
      await local.remove(sourceKey);
      const current = await local.get(sourceKey);
      return { ok: !Object.hasOwn(current, sourceKey) };
    }
    if (phase === 'dispose') {
      await local.remove(backupKey);
      return { ok: !Object.hasOwn(await local.get(backupKey), backupKey) };
    }
    return { ok: false };
  } catch {
    return { ok: false };
  }
}

// Native callers inherit the harness's exclusive, command-line-verified disposable profile.
// Awaited storage + document replacement + after-reload equality is not a global write drain.
export async function withExactSettingsFixture({
  getPanel,
  reloadSettings,
  execute,
  onRestored = () => {},
  driver = { evaluate },
}) {
  const backupKey = `matrx.qa.settingsFixture.${randomUUID()}`;
  const owner = randomUUID();
  let phase = 'capture';
  let integrity = null;
  const receipt = {
    phase,
    ownershipEstablished: false,
    restoredAfterReload: false,
    snapshotRetained: null,
    documentReplaced: false,
  };
  const fail = () => {
    integrity ??= { phase };
    throw new Error('settings_fixture_integrity_failed');
  };
  const storage = async (operation) => {
    let result;
    try {
      result = await driver.evaluate(
        getPanel(),
        `(${fixtureStoragePhase.toString()})(${JSON.stringify(backupKey)},${JSON.stringify(owner)},${JSON.stringify(operation)})`,
      );
    } catch {
      fail();
    }
    if (result?.ok !== true) fail();
  };
  const reload = async () => {
    try {
      await reloadSettings(getPanel());
    } catch {
      fail();
    }
  };
  try {
    await storage('capture');
    receipt.ownershipEstablished = true;
    receipt.snapshotRetained = true;
    return await preserveFailureDuringCleanup(
      () =>
        execute({
          removeSource: () => {
            phase = 'ownership';
            return storage('absent');
          },
        }),
      async () => {
        phase = 'retire_before_restore';
        await reload();
        receipt.documentReplaced = true;
        phase = 'restore';
        await storage('restore');
        phase = 'reload_after_restore';
        await reload();
        phase = 'verify';
        await storage('verify');
        try {
          await onRestored();
        } catch {
          fail();
        }
        receipt.restoredAfterReload = true;
        phase = 'dispose';
        // A transport loss during removal cannot prove whether the backup remains.
        receipt.snapshotRetained = null;
        await storage('dispose');
        receipt.snapshotRetained = false;
      },
    );
  } catch (error) {
    if (integrity) {
      let finalSnapshot = { backupPresent: null, backupOwned: null, snapshotRetained: null };
      try {
        const inspected = await driver.evaluate(
          getPanel(),
          `(${fixtureStoragePhase.toString()})(${JSON.stringify(backupKey)},${JSON.stringify(owner)},"inspect")`,
        );
        if (
          inspected?.ok === true &&
          ['backupPresent', 'backupOwned', 'snapshotRetained'].every(
            (key) => typeof inspected[key] === 'boolean',
          )
        ) {
          finalSnapshot = {
            backupPresent: inspected.backupPresent,
            backupOwned: inspected.backupOwned,
            snapshotRetained: inspected.snapshotRetained,
          };
        }
      } catch {}
      integrityFailures.set(error, {
        ...receipt,
        ...finalSnapshot,
        phase: integrity.phase,
        cleanupPhase: phase,
      });
    }
    throw error;
  }
}

// Own the absent-container reproduction independently of preceding preference cases.
export async function runWithAbsentScrapeModeBaseline({
  getPanel,
  reloadSettings,
  settings,
  openSection,
  observe,
  record,
  execute,
  matches,
  driver = { evaluate },
}) {
  await settings(getPanel());
  await openSection(getPanel(), 'Scrape');
  const original = await observe(getPanel());
  const labels = { capture: 'Capture', 'scroll-capture': 'Scroll & capture' };
  const originalMode = original.mode?.stored;
  assert.equal(
    matches(
      { ...original.mode, active: original.active, sectionOpen: original.sectionOpen },
      originalMode,
      labels[originalMode],
    ),
    true,
    'scrape_mode_original_ui_storage_disagree',
  );
  return withExactSettingsFixture({
    getPanel,
    reloadSettings,
    driver,
    onRestored: async () => {
      await settings(getPanel());
      await openSection(getPanel(), 'Scrape');
      const restored = await observe(getPanel());
      assert.equal(
        matches(
          { ...restored.mode, active: restored.active, sectionOpen: restored.sectionOpen },
          originalMode,
          labels[originalMode],
        ),
        true,
        'scrape_mode_original_ui_not_restored',
      );
      record('pre-T67 Settings container restored after panel reload', 'pass', {
        exactBaselineRestored: true,
        originalModeRestored: true,
      });
    },
    execute: async ({ removeSource }) => {
      await removeSource();
      await reloadSettings(getPanel());
      await settings(getPanel());
      await openSection(getPanel(), 'Scrape');
      const initial = await observe(getPanel());
      const absent =
        initial.storagePresent === false &&
        initial.mode?.storedPresent === false &&
        matches(
          { ...initial.mode, active: initial.active, sectionOpen: initial.sectionOpen },
          'capture',
          'Capture',
        );
      record('initial absent Settings container observed', absent ? 'pass' : 'fail', initial);
      assert.equal(absent, true, 'scrape_mode_absent_container_setup_failed');
      await execute(initial);
    },
  });
}
