import assert from 'node:assert/strict';
import vm from 'node:vm';
import { storageFaultInstallerSource } from './d87-storage-fault-injector.mjs';

const key = 'matrx.settings.v1';
const writes = [];
const area = {
  async set(items) {
    writes.push(items[key]);
  },
};
const window = {};
const installed = vm.runInNewContext(storageFaultInstallerSource(key, 'hold'), {
  chrome: { storage: { local: area } },
  window,
});
assert.equal(installed, true);

const heldWrite = area.set({ [key]: 'light' });
assert.equal(
  JSON.stringify(window.__d87StorageFault.state()),
  '{"calls":1,"released":false,"held":true}',
);
window.__d87StorageFault.release();
window.__d87StorageFault.release();
window.__d87StorageFault.restore();
await heldWrite;

assert.deepEqual(writes, ['light'], 'cleanup must not replay the captured stale write');
assert.equal(area.set.name, 'set', 'cleanup restores the original storage method');
