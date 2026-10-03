import assert from 'node:assert/strict';
import { createContext, runInContext } from 'node:vm';
import { faultState, installFault, releaseFault } from './prepare-fault-driver.mjs';

// Real injected fault lifecycle and Node driver, with only browser/CDP dependencies
// replaced. A hidden panel never services requestAnimationFrame.
for (const mode of ['hold_reject', 'hold_success']) {
  const context = createContext({
    chrome: { scripting: { executeScript: async () => [{ result: 'real-result' }] } },
    requestAnimationFrame: () => {},
  });
  runInContext('window = globalThis', context);
  const panel = {
    async send(method, { expression }) {
      assert.equal(method, 'Runtime.evaluate');
      let timer;
      try {
        const value = await Promise.race([
          Promise.resolve(runInContext(expression, context)),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('paused_frame_command_timeout')), 50);
          }),
        ]);
        return { result: { value } };
      } finally {
        clearTimeout(timer);
      }
    },
  };
  const original = context.chrome.scripting.executeScript;
  await installFault(panel, mode);
  assert.deepEqual(await context.chrome.scripting.executeScript({ target: { tabId: 1 } }), [
    { result: 'real-result' },
  ]);
  let outcome = 'pending';
  const request = context.chrome.scripting
    .executeScript({ target: { documentIds: ['doc'] }, args: [{ scrollToBottom: true }] })
    .then(
      (value) => {
        assert.equal(value[0].result, 'real-result');
        outcome = 'success';
      },
      (error) => {
        assert.equal(error.message, 'Controlled Prepare rejection');
        outcome = 'rejection';
      },
    );
  await Promise.resolve();
  assert.equal((await faultState(panel)).held, true, 'fault must actually hold the API response');
  assert.equal(outcome, 'pending');
  const observations = [];
  await releaseFault(panel, async () => {
    observations.push(outcome);
    return { outcome };
  });
  assert.equal(outcome, mode === 'hold_reject' ? 'rejection' : 'success');
  await request;
  assert.ok(observations.length >= 2, 'release must observe stable post-settlement UI');
  assert.ok(
    observations.every((value) => value === outcome),
    'UI observations must follow promise settlement',
  );
  assert.equal(
    context.chrome.scripting.executeScript,
    original,
    'original browser API must be restored',
  );
  assert.equal(await faultState(panel), null, 'fault state must be cleaned up');
}
console.log('PASS held response settles and UI stabilizes without animation frames');
