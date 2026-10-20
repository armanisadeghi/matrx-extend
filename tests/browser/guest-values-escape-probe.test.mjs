import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { guestValuesEscapeProbeExpression } from './guest-values-escape-probe.mjs';

const snapshot = (probe) => JSON.parse(JSON.stringify(probe.snapshot()));

// Guest opens Values while asking about the current page; focus is on Open full view.
function setup() {
  const window = new Window();
  const { document } = window;
  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('data-state', 'open');
  const button = document.createElement('button');
  button.setAttribute('aria-label', 'Open full view');
  button.textContent = 'PRIVATE CONTENT MUST NOT BE RECORDED';
  dialog.append(button);
  document.body.append(dialog);
  button.focus();
  // Execute the exact CDP expression, not a reimplementation of the observer.
  window.eval(guestValuesEscapeProbeExpression);
  const probe = document.__guestValuesEscapeProbe;
  const sendEscape = (target = button) => {
    const event = new window.KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      composed: true,
      cancelable: true,
    });
    target.dispatchEvent(event);
    return event;
  };
  return { window, document, dialog, button, probe, sendEscape };
}

test('records target/focus divergence without retargeting the input', () => {
  const { window, document, probe, sendEscape } = setup();
  sendEscape(document.body);
  const trace = snapshot(probe);
  assert.equal(probe.keyDownCount, 1);
  assert.equal(probe.trustedKeyDownCount, 0);
  assert.deepEqual(
    trace.records.map((row) => row.boundary),
    ['window_capture', 'document_capture', 'document_bubble', 'window_bubble'],
  );
  assert.ok(
    trace.records.every(
      (row) =>
        !row.targetInsideDialog &&
        !row.pathIncludesDialog &&
        row.activeInsideDialog &&
        !row.targetIsActiveElement,
    ),
  );
  probe.stop();
  window.happyDOM.abort();
});

test('observes every native boundary without preventing or stopping Escape', () => {
  const { window, button, probe, sendEscape } = setup();
  let targetCalls = 0;
  button.addEventListener('keydown', () => targetCalls++);
  const event = sendEscape();
  const trace = snapshot(probe);
  assert.deepEqual(
    trace.records.map((row) => row.boundary),
    [
      'window_capture',
      'document_capture',
      'dialog_capture',
      'dialog_bubble',
      'document_bubble',
      'window_bubble',
    ],
  );
  assert.ok(
    trace.records.every(
      (row) =>
        row.targetInsideDialog &&
        row.pathIncludesDialog &&
        row.targetIsActiveElement &&
        !row.defaultPrevented &&
        !row.cancelBubble,
    ),
  );
  assert.equal(targetCalls, 1);
  assert.equal(event.defaultPrevented, false);
  assert.equal(JSON.stringify(trace).includes('PRIVATE'), false);
  probe.stop();
  window.happyDOM.abort();
});

test('localizes target propagation suppression to the missing bubble boundaries', () => {
  const { window, button, probe, sendEscape } = setup();
  button.addEventListener('keydown', (event) => event.stopPropagation());
  sendEscape();
  assert.deepEqual(
    snapshot(probe).records.map((row) => row.boundary),
    ['window_capture', 'document_capture', 'dialog_capture'],
  );
  probe.stop();
  window.happyDOM.abort();
});

test('retains close/reopen and removal evidence even when final dialog state is open', () => {
  const { window, document, dialog, button, probe, sendEscape } = setup();
  button.addEventListener('keydown', () => {
    dialog.setAttribute('data-state', 'closed');
    dialog.setAttribute('data-state', 'open');
    dialog.remove();
    document.body.append(dialog);
  });
  sendEscape();
  const trace = snapshot(probe);
  assert.deepEqual(
    trace.transitions.filter((row) => row.type === 'attributes').map((row) => row.oldStateWasOpen),
    [true, false],
  );
  assert.ok(trace.transitions.some((row) => row.originalRemoved));
  assert.ok(trace.transitions.some((row) => row.originalAdded));
  assert.equal(trace.postEscape.originalDialogOpen, true);
  probe.stop();
  window.happyDOM.abort();
});

test('bounds observations and removes all listeners on cleanup', () => {
  const { window, dialog, probe, sendEscape } = setup();
  for (let index = 0; index < 40; index++) {
    sendEscape();
    dialog.setAttribute('data-state', index % 2 ? 'open' : 'closed');
  }
  const before = snapshot(probe);
  assert.equal(before.records.length, 32);
  assert.equal(before.transitions.length, 32);
  assert.ok(before.droppedRecords > 0);
  assert.ok(before.droppedTransitions > 0);
  probe.stop();
  probe.stop();
  sendEscape();
  dialog.remove();
  assert.deepEqual(snapshot(probe), { ...before, postEscape: snapshot(probe).postEscape });
  assert.equal(probe.keyDownCount, 40);
  window.happyDOM.abort();
});

test('reports tooltip and forwarded-prop presence without invoking a React handler', () => {
  const { window, document, dialog, probe, sendEscape } = setup();
  let handlerCalls = 0;
  dialog.__reactProps$diagnostic = { onKeyDown: () => handlerCalls++ };
  const tooltip = document.createElement('span');
  tooltip.setAttribute('role', 'tooltip');
  document.body.append(tooltip);
  sendEscape();
  const trace = snapshot(probe);
  assert.equal(trace.preEscape.mountedTooltipCount, 0);
  assert.equal(trace.preEscape.dialogReactKeyDownPropPresent, false);
  assert.ok(
    trace.records.every(
      (row) => row.mountedTooltipCount === 1 && row.dialogReactKeyDownPropPresent,
    ),
  );
  assert.equal(handlerCalls, 0);
  probe.stop();
  window.happyDOM.abort();
});

test('failure sanitizer retains the structured observer receipt after JSON serialization', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(
    new URL('./guest-chat-store-acceptance.mjs', import.meta.url),
    'utf8',
  );
  const sanitizer = new Function(
    `${source.slice(source.indexOf('function safeValuesCloseDiagnostic('), source.indexOf('function safeVisibleText('))}; return safeValuesCloseDiagnostic;`,
  )();
  const { window, probe, sendEscape } = setup();
  sendEscape();
  const trace = snapshot(probe);
  const error = new Error('guest_values_chip_closed_not_observed');
  error.guestValuesCloseState = { escapeBoundaryTrace: trace };
  const receipt = JSON.parse(JSON.stringify(sanitizer(error)));
  assert.deepEqual(receipt.escape_boundary_trace, trace);
  assert.equal(receipt.escape_boundary_trace.records.length, 6);
  assert.equal(JSON.stringify(receipt).includes('PRIVATE'), false);
  probe.stop();
  window.happyDOM.abort();
});
