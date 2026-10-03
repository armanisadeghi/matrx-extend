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
        const actual = Object.keys(copied).sort();
        const expected = Object.keys(publicJwk).sort();
        return actual.length === expected.length &&
          actual.every((key, i) => key === expected[i] && copied[key] === publicJwk[key]) &&
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
