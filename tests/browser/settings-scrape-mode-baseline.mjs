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
  return value ? { ...value, ...(value.capture && { capture: { ...value.capture } }) } : null;
}

const CAPTURE_STAGES = new Set([
  'backup_read',
  'source_read',
  'source_validation',
  'backup_write',
  'readback',
  'comparison',
  'unavailable',
]);
function safeCaptureDiagnostic(value) {
  const stage = value?.stage;
  const outcome = value?.outcome;
  const bool = (key) => {
    const candidate = value?.[key];
    return typeof candidate === 'boolean' ? candidate : null;
  };
  return {
    stage: CAPTURE_STAGES.has(stage) ? stage : 'unavailable',
    outcome: ['matched', 'mismatch', 'unsupported', 'collision', 'exception_unavailable'].includes(
      outcome,
    )
      ? outcome
      : 'exception_unavailable',
    envelopeMatches: bool('envelopeMatches'),
    sourcePresenceMatches: bool('sourcePresenceMatches'),
    sourceValueMatches: bool('sourceValueMatches'),
    sourceSupported: bool('sourceSupported'),
  };
}

// This function executes entirely in the extension. No source value leaves the browser.
async function fixtureStoragePhase(backupKey, owner, phase) {
  const sourceKey = 'matrx.settings.v1';
  const local = chrome.storage.local;
  const plainRecord = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    if (prototype === null) return true;
    const recordConstructor = Object.getOwnPropertyDescriptor(prototype, 'constructor')?.value;
    return (
      Object.getPrototypeOf(prototype) === null &&
      typeof recordConstructor === 'function' &&
      recordConstructor.prototype === prototype &&
      Function.prototype.toString.call(recordConstructor) ===
        Function.prototype.toString.call(Object)
    );
  };
  const ownFields = (value, keys) =>
    plainRecord(value) &&
    Reflect.ownKeys(value).length === keys.length &&
    keys.every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value');
    });
  const nativeArray = (value) => {
    const prototype = Object.getPrototypeOf(value);
    if (!prototype || !Array.isArray(prototype)) return false;
    const arrayConstructor = Object.getOwnPropertyDescriptor(prototype, 'constructor')?.value;
    return (
      typeof arrayConstructor === 'function' &&
      arrayConstructor.prototype === prototype &&
      Function.prototype.toString.call(arrayConstructor) === Function.prototype.toString.call(Array)
    );
  };
  const jsonValue = (value, ancestors = new Set()) => {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
    if (typeof value === 'number') return Number.isFinite(value) && !Object.is(value, -0);
    if (typeof value !== 'object' || ancestors.has(value)) return false;
    const array = Array.isArray(value);
    if (array && !nativeArray(value)) return false;
    if (!array && !plainRecord(value)) return false;
    const keys = Reflect.ownKeys(value);
    if (array) {
      if (keys.length !== value.length + 1 || !keys.includes('length')) return false;
      for (let index = 0; index < value.length; index++)
        if (!Object.hasOwn(value, String(index))) return false;
    }
    ancestors.add(value);
    for (const key of keys) {
      if (array && key === 'length') continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        typeof key !== 'string' ||
        descriptor?.enumerable !== true ||
        !Object.hasOwn(descriptor, 'value') ||
        !jsonValue(descriptor.value, ancestors)
      ) {
        ancestors.delete(value);
        return false;
      }
    }
    ancestors.delete(value);
    return true;
  };
  // Strings stay opaque; only JSON record field order is immaterial.
  const equal = (a, b) => {
    if (Object.is(a, b)) return true;
    if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a))
      return a.length === b.length && a.every((value, index) => equal(value, b[index]));
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every((key) => Object.hasOwn(b, key) && equal(a[key], b[key]))
    );
  };
  const envelopeFields = ['schema', 'sourceKey', 'owner', 'payload', 'seal'];
  const digest = async (payload) =>
    Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload))),
    )
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  const validEnvelope = async (envelope) =>
    ownFields(envelope, envelopeFields) &&
    envelope.schema === 1 &&
    envelope.sourceKey === sourceKey &&
    envelope.owner === owner &&
    typeof envelope.payload === 'string' &&
    envelope.seal === (await digest(envelope.payload));
  const capture = {
    stage: 'backup_read',
    outcome: 'exception_unavailable',
    envelopeMatches: null,
    sourcePresenceMatches: null,
    sourceValueMatches: null,
    sourceSupported: null,
  };
  try {
    if (phase === 'capture') {
      const existing = await local.get(backupKey);
      if (Object.hasOwn(existing, backupKey))
        return { ok: false, capture: { ...capture, outcome: 'collision' } };
      capture.stage = 'source_read';
      const source = await local.get(sourceKey);
      const present = Object.hasOwn(source, sourceKey);
      capture.stage = 'source_validation';
      capture.sourceSupported = !present || jsonValue(source[sourceKey]);
      if (!capture.sourceSupported)
        return { ok: false, capture: { ...capture, outcome: 'unsupported' } };
      const payload = JSON.stringify({ present, ...(present && { raw: source[sourceKey] }) });
      const decoded = JSON.parse(payload);
      const envelope = { schema: 1, sourceKey, owner, payload, seal: await digest(payload) };
      capture.stage = 'backup_write';
      await local.set({ [backupKey]: envelope });
      capture.stage = 'readback';
      const readback = await local.get([backupKey, sourceKey]);
      capture.stage = 'comparison';
      capture.envelopeMatches =
        (await validEnvelope(readback[backupKey])) &&
        envelopeFields.every((field) => readback[backupKey][field] === envelope[field]);
      capture.sourcePresenceMatches = Object.hasOwn(readback, sourceKey) === present;
      capture.sourceValueMatches =
        !present ||
        (Object.hasOwn(readback, sourceKey) &&
          jsonValue(readback[sourceKey]) &&
          equal(readback[sourceKey], decoded.raw));
      const ok =
        capture.envelopeMatches && capture.sourcePresenceMatches && capture.sourceValueMatches;
      return { ok, capture: { ...capture, outcome: ok ? 'matched' : 'mismatch' } };
    }
    const entries = await local.get(backupKey);
    const envelope = entries[backupKey];
    if (phase === 'inspect' && !Object.hasOwn(entries, backupKey))
      return { ok: true, backupPresent: false, backupOwned: false, snapshotRetained: false };
    if (!envelope || envelope.owner !== owner || !(await validEnvelope(envelope)))
      return phase === 'inspect'
        ? {
            ok: true,
            backupPresent: Object.hasOwn(entries, backupKey),
            backupOwned: false,
            snapshotRetained: false,
          }
        : { ok: false };
    const saved = JSON.parse(envelope.payload);
    if (
      typeof saved.present !== 'boolean' ||
      !ownFields(saved, saved.present ? ['present', 'raw'] : ['present']) ||
      (saved.present && !jsonValue(saved.raw))
    )
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
          (!saved.present ||
            (jsonValue(current[sourceKey]) && equal(current[sourceKey], saved.raw))),
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
    return phase === 'capture' ? { ok: false, capture } : { ok: false };
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
    if (operation === 'capture') receipt.capture = safeCaptureDiagnostic(null);
    let result;
    try {
      result = await driver.evaluate(
        getPanel(),
        `(${fixtureStoragePhase.toString()})(${JSON.stringify(backupKey)},${JSON.stringify(owner)},${JSON.stringify(operation)})`,
      );
    } catch {
      fail();
    }
    let ok;
    try {
      if (operation === 'capture') receipt.capture = safeCaptureDiagnostic(result?.capture);
      ok = result?.ok === true;
    } catch {
      if (operation === 'capture') receipt.capture = safeCaptureDiagnostic(null);
      fail();
    }
    if (!ok) fail();
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
