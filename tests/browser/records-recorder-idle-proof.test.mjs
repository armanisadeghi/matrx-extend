import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import {
  recorderIdleBadgeAccepted,
  recorderIdleBadgeState,
} from './records-recorder-idle-proof.mjs';

const goodTabs =
  '<button role="tab" title="Tools" data-state="active" aria-controls="tools"></button>' +
  '<div id="tools" role="tabpanel" data-state="active">' +
  '<button role="tab" data-state="active" aria-controls="recorder">Recorder</button>' +
  '<div id="recorder" role="tabpanel" data-state="active"><span role="status" aria-label="Idle" data-status-tone="neutral">Idle</span></div>' +
  '</div>';

async function observe(html = goodTabs) {
  const window = new Window();
  window.document.body.innerHTML = html;
  window.Element.prototype.getBoundingClientRect = () => ({ width: 100, height: 20 });
  const panel = {
    async send(method, { expression }) {
      assert.equal(method, 'Runtime.evaluate');
      return { result: { value: await window.eval(expression) } };
    },
  };
  const state = await recorderIdleBadgeState(panel);
  window.happyDOM.abort();
  return state;
}

test('accepts one visible neutral Idle status in active Tools / Recorder panes', async () => {
  assert.equal(recorderIdleBadgeAccepted(await observe()), true);
});

test('rejects a hidden Idle badge', async () => {
  assert.equal(
    recorderIdleBadgeAccepted(
      await observe(
        goodTabs.replace('aria-label="Idle"', 'aria-label="Idle" style="display:none"'),
      ),
    ),
    false,
  );
});

test('rejects a non-Idle label', async () => {
  assert.equal(
    recorderIdleBadgeAccepted(
      await observe(goodTabs.replace('aria-label="Idle"', 'aria-label="Recording"')),
    ),
    false,
  );
});

test('rejects duplicate status badges', async () => {
  assert.equal(
    recorderIdleBadgeAccepted(
      await observe(
        goodTabs.replace(
          '</div></div>',
          '<span role="status" aria-label="Idle" data-status-tone="neutral">Idle</span></div></div>',
        ),
      ),
    ),
    false,
  );
});

test('rejects a non-neutral tone', async () => {
  assert.equal(
    recorderIdleBadgeAccepted(
      await observe(goodTabs.replace('data-status-tone="neutral"', 'data-status-tone="warning"')),
    ),
    false,
  );
});
