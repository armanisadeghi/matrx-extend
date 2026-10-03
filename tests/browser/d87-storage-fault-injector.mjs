export function storageFaultInstallerSource(key, mode) {
  return `(() => {
    const key = ${JSON.stringify(key)};
    const area = chrome.storage.local;
    const original = area.set;
    const nativeSet = original.bind(area);
    const fault = { mode: ${JSON.stringify(mode)}, calls: 0, released: false, release: null };
    const wrapper = (items) => {
      if (!Object.hasOwn(items, key)) return nativeSet(items);
      fault.calls += 1;
      if (fault.calls !== 1) return nativeSet(items);
      if (fault.mode === 'reject') return Promise.reject(new Error('d87 controlled storage refusal'));
      return new Promise((resolve, reject) => {
        fault.release = () => {
          if (fault.released) return;
          fault.released = true;
          nativeSet(items).then(resolve, reject);
        };
      });
    };
    area.set = wrapper;
    if (area.set !== wrapper) return false;
    window.__d87StorageFault = {
      state: () => ({ calls: fault.calls, released: fault.released,
        held: typeof fault.release === 'function' && !fault.released }),
      release: () => fault.release?.(),
      restore: () => { area.set = original; },
    };
    return true;
  })()`;
}
