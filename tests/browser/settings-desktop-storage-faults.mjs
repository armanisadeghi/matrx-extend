// Installed in the owned side-panel page. The wrappers replace only Chrome's
// storage boundary; Settings, its queues, and React event handlers remain real.
// Never return a stored pair code or an exception message to the Node runner.
export function desktopStorageFaultSource({ operation, key, mode }) {
  if (!['get', 'set', 'remove', 'clear'].includes(operation)) throw new Error('invalid_operation');
  if (!['reject', 'hold'].includes(mode)) throw new Error('invalid_mode');
  return `(() => {
    const area = chrome.storage.local;
    const operation = ${JSON.stringify(operation)};
    const key = ${JSON.stringify(key)};
    const mode = ${JSON.stringify(mode)};
    const original = area[operation];
    const nativeCall = original.bind(area);
    const fault = { calls: 0, released: false, release: null };
    const targets = (arg) => operation === 'clear' ||
      (operation === 'set' ? Object.hasOwn(arg ?? {}, key) :
        Array.isArray(arg) ? arg.includes(key) : arg === key);
    const wrapper = (...args) => {
      if (!targets(args[0])) return nativeCall(...args);
      fault.calls += 1;
      if (fault.calls !== 1) return nativeCall(...args);
      if (mode === 'reject') return Promise.reject(new Error('controlled storage refusal'));
      return new Promise((resolve, reject) => {
        fault.release = () => {
          if (fault.released) return;
          fault.released = true;
          nativeCall(...args).then(resolve, reject);
        };
      });
    };
    area[operation] = wrapper;
    if (area[operation] !== wrapper) return false;
    window.__desktopSettingsFault = {
      state: () => ({ calls: fault.calls, released: fault.released,
        held: typeof fault.release === 'function' && !fault.released }),
      release: () => fault.release?.(),
      restore: () => { area[operation] = original; },
    };
    return true;
  })()`;
}
