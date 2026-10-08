import assert from 'node:assert/strict';

// Faults at browser API boundaries in the disposable Chrome profile only.
// The product module, WebCrypto, Web Locks, and persisted storage remain real.
export function auditFaultSource(mode) {
  return `(() => {
    if (window.__auditNativeFault) throw new Error('audit_fault_already_installed');
    const area = chrome.storage.local;
    const original = { get: area.get, set: area.set, writeText: navigator.clipboard.writeText };
    const native = { get: original.get.bind(area), set: original.set.bind(area),
      writeText: original.writeText.bind(navigator.clipboard) };
    const active = 'matrx.audit.deviceKey', history = 'matrx.audit.publicKeyHistory';
    const state = { mode: ${JSON.stringify(mode)}, activeWrites: 0, historyWrites: 0,
      activeReads: 0, clipboardWrites: 0, clipboardSucceeded: 0,
      faulted: 0, release: null, lastClipboardText: null };
    const includes = (keys, key) => keys === key || (Array.isArray(keys) && keys.includes(key)) ||
      (keys && typeof keys === 'object' && Object.hasOwn(keys, key));
    const get = (keys) => {
      if (includes(keys, active)) {
        state.activeReads++;
        if ((state.mode === 'read-once' && state.faulted === 0) ||
          (state.mode === 'after-active-read' && state.activeWrites > 0 && state.faulted === 0) ||
          (state.mode === 'unknown-write' && state.activeWrites > 0 && state.faulted === 1)) {
          state.faulted++;
          return Promise.reject(new Error('controlled read refusal'));
        }
      }
      return native.get(keys);
    };
    const set = (items) => {
      if (Object.hasOwn(items, history)) {
        state.historyWrites++;
        if (state.mode === 'reject-history' && state.faulted === 0) {
          state.faulted++;
          return Promise.reject(new Error('controlled history refusal'));
        }
      }
      if (Object.hasOwn(items, active)) {
        state.activeWrites++;
        if (state.mode === 'unknown-write' && state.faulted === 0) {
          return native.set(items).then(() => {
            state.faulted++;
            throw new Error('controlled post-write refusal');
          });
        }
        if (state.mode === 'hold-active' && state.activeWrites === 1) {
          return new Promise((resolve, reject) => {
            let released = false;
            state.release = () => {
              if (released) return;
              released = true;
              native.set(items).then(resolve, reject);
            };
          });
        }
      }
      return native.set(items);
    };
    const writeText = (value) => {
      state.clipboardWrites++;
      if (state.mode === 'clipboard-once' && state.faulted === 0) {
        state.faulted++;
        return Promise.reject(new Error('controlled clipboard refusal'));
      }
      return native.writeText(value).then(() => {
        state.clipboardSucceeded++;
        state.lastClipboardText = value;
      });
    };
    area.get = get; area.set = set; navigator.clipboard.writeText = writeText;
    if (area.get !== get || area.set !== set || navigator.clipboard.writeText !== writeText) {
      area.get = original.get; area.set = original.set;
      navigator.clipboard.writeText = original.writeText;
      return false;
    }
    window.__auditNativeFault = {
      state: () => ({ mode: state.mode, activeWrites: state.activeWrites,
        historyWrites: state.historyWrites, activeReads: state.activeReads,
        clipboardWrites: state.clipboardWrites, clipboardSucceeded: state.clipboardSucceeded,
        faulted: state.faulted,
        held: typeof state.release === 'function' }),
      disarm: () => { state.mode = 'off'; },
      copiedPublicJwk: async () => {
        const activeKey = (await native.get(active))[active];
        let copied;
        try { copied = JSON.parse(state.lastClipboardText); } catch { return false; }
        const publicJwk = activeKey?.publicKeyJwk;
        if (!publicJwk || !copied || typeof copied !== 'object') return false;
        const sameJson = (left, right) => {
          if (left === right) return true;
          if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
          if (Array.isArray(left) !== Array.isArray(right)) return false;
          if (Array.isArray(left)) return left.length === right.length && left.every((value, i) => sameJson(value, right[i]));
          const keys = Object.keys(left);
          return keys.length === Object.keys(right).length &&
            keys.every((key) => Object.hasOwn(right, key) && sameJson(left[key], right[key]));
        };
        return sameJson(copied, publicJwk) &&
          ['d', 'p', 'q', 'dp', 'dq', 'qi'].every((key) => !Object.hasOwn(copied, key));
      },
      release: () => state.release?.(),
      restore: () => {
        state.release?.();
        area.get = original.get; area.set = original.set;
        navigator.clipboard.writeText = original.writeText;
        delete window.__auditNativeFault;
      },
    };
    return true;
  })()`;
}

// Keep the wrapper in place after removing its refusal: the retry must still
// count writes. Restore browser APIs only after the read-only check completes.
export async function retryAuditDetailsReadOnly({
  panel,
  evaluate,
  click,
  expectCard,
  snapshot,
  fault,
  before,
  onStep = () => {},
}) {
  await evaluate(panel, '(() => { window.__auditNativeFault.disarm(); return true; })()');
  try {
    onStep('click_details_retry');
    await click(panel, 'button-text', 'Retry audit details');
    onStep('card_recovered');
    const recovered = await expectCard(
      panel,
      'audit_load_recovered',
      (value) => value?.keyId === before.activeId && !value.detailsUnavailable,
    );
    onStep('compare_storage_after_retry');
    assert.deepEqual(await snapshot(panel), before, 'audit_T86_storage_changed_on_retry');
    const afterFault = await fault(panel);
    if (afterFault?.activeWrites !== 0) throw new Error('audit_T86_active_write_on_retry');
    return recovered;
  } finally {
    await evaluate(panel, '(() => { window.__auditNativeFault?.restore(); return true; })()');
  }
}

// Keep native acceptance receipts useful without forwarding CDP exception
// text, wait snapshots, URLs, credential fields, or audit key material.
const DETAIL_STEPS = new Set([
  'reload_with_prelude',
  'verify_identity_after_reload',
  'open_advanced_section',
  'card_failed_load',
  'read_storage_after_failure',
  'restore_read_fault',
  'click_details_retry',
  'card_recovered',
  'compare_storage_after_retry',
]);
const WAIT_LABELS = new Set([
  'audit_new_document',
  'audit_settings_after_reload',
  'd87_rendered_identity',
  'Advanced agent capabilities_section_ready',
  'Advanced agent capabilities_expanded',
  'audit_load_failure',
  'audit_load_recovered',
]);

export function classifyAuditNativeFailure(stage, step, error) {
  if (stage !== 'details_failure' || !DETAIL_STEPS.has(step)) return 'audit_native_unverified';
  if (/^audit_reload_[a-z_]+$/.test(error?.auditBoundaryCode ?? '')) return error.auditBoundaryCode;
  const message = typeof error?.message === 'string' ? error.message : '';
  const label = message.split('_not_observed:', 1)[0];
  if (WAIT_LABELS.has(label)) return `${label.replaceAll(' ', '_')}_not_observed`;
  return `audit_${step}_failed`;
}

// Page.reload acknowledges the request before the old document disappears.
// Keep the early browser-API fault installed until a distinct document has
// loaded and confirms the prelude executed there.
export async function reloadAuditPrelude(
  panel,
  source,
  { evaluate, waitFor, onBoundary = () => {} },
) {
  let failure;
  const run = async (name, operation) => {
    onBoundary({ boundary: name, outcome: 'started' });
    try {
      const result = await operation();
      onBoundary({ boundary: name, outcome: 'completed' });
      return result;
    } catch {
      onBoundary({ boundary: name, outcome: 'failed' });
      const failure = new Error(`audit_reload_${name}`);
      failure.auditBoundaryCode = failure.message;
      throw failure;
    }
  };
  // The Page agent is session-scoped; registering a script alone does not enable it.
  await run('enable_page', () => panel.send('Page.enable'));
  const previousOrigin = await run('read_previous_document', () =>
    evaluate(panel, 'performance.timeOrigin'),
  );
  const wrappedSource = `(() => {
    const installed = ${source};
    window.__auditPreludeInstalled = installed !== false;
  })()`;
  const installed = await run('install_script', () =>
    panel.send('Page.addScriptToEvaluateOnNewDocument', {
      source: wrappedSource,
    }),
  );
  try {
    await run('request_reload', () => panel.send('Page.reload', { ignoreCache: true }));
    const next = await run('wait_new_document', () =>
      awaitAuditNewDocument(panel, previousOrigin, {
        evaluate: async (target, expression) => {
          try {
            const state = await evaluate(target, expression);
            onBoundary({
              boundary: 'document_probe',
              outcome: 'completed',
              newDocument: state?.newDocument === true,
              settingsReady: state?.settingsReady === true,
              preludeInstalled: state?.preludeInstalled === true,
            });
            return state;
          } catch (error) {
            onBoundary({
              boundary: 'document_probe',
              outcome: 'failed',
              contextDestroyed: /context.*(destroyed|not found)|Cannot find context/i.test(
                error?.message ?? '',
              ),
            });
            throw error;
          }
        },
        waitFor,
      }),
    );
    await run('check_marker', () => {
      if (!next.preludeInstalled) throw new Error('audit_prelude_not_installed');
    });
  } catch (error) {
    failure = error;
  }
  try {
    await run('remove_script', () =>
      panel.send('Page.removeScriptToEvaluateOnNewDocument', {
        identifier: installed.identifier,
      }),
    );
  } catch (error) {
    failure ??= error;
  }
  if (failure) throw failure;
}

export async function awaitAuditNewDocument(panel, previousOrigin, { evaluate, waitFor }) {
  return waitFor(
    'audit_new_document',
    () =>
      evaluate(
        panel,
        `(() => ({
          newDocument: performance.timeOrigin !== ${JSON.stringify(previousOrigin)},
          settingsReady: !!document.querySelector('button[title="Settings"]'),
          preludeInstalled: window.__auditPreludeInstalled === true,
        }))()`,
      ),
    (state) => state?.newDocument && state.settingsReady,
    30000,
  );
}
