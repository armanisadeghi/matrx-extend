import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import {
  recordMemberPickerBoundary,
  selectedMemberOrganizationFingerprint,
} from './member-picker-transition-diagnostic.mjs';

test('picker boundary records the first hidden phase without persisting identities or labels', async () => {
  const report = {};
  const writes = [];
  let phase = 0;
  const panel = {
    send: async (method, options) => {
      assert.equal(method, 'Runtime.evaluate');
      assert.equal(options.returnByValue, true);
      assert.ok(!options.expression.includes('chrome.storage'));
      phase += 1;
      return {
        result: {
          value: {
            visibility: phase === 1 ? 'visible' : 'hidden',
            focused: phase === 1,
            picker_count: 1,
            expanded_count: 1,
            listbox_count: 1,
            checked_count: 1,
            secret: 'raw organization UUID and token must never persist',
          },
        },
      };
    },
  };
  const writeReport = async (_output, value) => {
    writes.push(JSON.parse(JSON.stringify(value)));
  };
  await recordMemberPickerBoundary({
    panel,
    phase: 'before_escape_keydown',
    report,
    output: '/tmp/proof',
    writeReport,
  });
  await recordMemberPickerBoundary({
    panel,
    phase: 'after_escape_keydown',
    report,
    output: '/tmp/proof',
    writeReport,
  });
  assert.equal(writes.length, 2);
  assert.deepEqual(
    writes[1].organization_picker_transition.map((row) => row.phase),
    ['before_escape_keydown', 'after_escape_keydown'],
  );
  assert.equal(writes[0].organization_picker_transition[0].panel_visibility, 'visible');
  assert.equal(writes[1].organization_picker_transition[1].panel_visibility, 'hidden');
  assert.equal(JSON.stringify(writes).includes('raw organization'), false);
  assert.equal(JSON.stringify(writes).includes('secret'), false);
});

test('picker boundary records an unavailable renderer without inventing visibility', async () => {
  const report = {};
  let writes = 0;
  await recordMemberPickerBoundary({
    panel: {
      send: async () => {
        throw new Error('private CDP failure details');
      },
    },
    phase: 'after_checked_option_proof',
    report,
    output: '/tmp/proof',
    writeReport: async () => {
      writes += 1;
    },
  });
  assert.equal(writes, 1);
  assert.deepEqual(report.organization_picker_transition, [
    { phase: 'after_checked_option_proof', measured: false, panel_visibility: null },
  ]);
  assert.equal(JSON.stringify(report).includes('private'), false);
  await assert.rejects(
    () =>
      recordMemberPickerBoundary({
        panel: {},
        phase: 'unknown',
        report,
        output: '/tmp/proof',
        writeReport: async () => {},
      }),
    /member_picker_phase_invalid/,
  );
});

test('actual Acting as DOM selector distinguishes the organization picker from the archive filter', async () => {
  const window = new Window();
  window.document.body.innerHTML = `
    <div><button aria-expanded="true">Organization</button></div>
    <section>
      <button role="combobox" aria-expanded="false">Archive filter</button>
      <div><div><span>Acting as</span></div><div><button role="combobox" aria-expanded="true" aria-controls="org-options">Acme</button></div></div>
      <div id="org-options" role="listbox">
        <div role="option" data-state="checked" data-value="a4152086-c3e5-44e8-a853-8e3da9918dd8">Acme</div>
      </div>
    </section>`;
  Object.defineProperty(window.document, 'visibilityState', {
    configurable: true,
    value: 'visible',
  });
  const report = {};
  const panel = {
    send: async (_method, options) => ({ result: { value: window.eval(options.expression) } }),
  };
  const visible = await recordMemberPickerBoundary({
    panel,
    phase: 'after_picker_click',
    report,
    output: '/tmp/proof',
    writeReport: async () => {},
  });
  assert.deepEqual(
    [
      visible.panel_visibility,
      visible.picker_count,
      visible.picker_expanded,
      visible.listbox_count,
      visible.checked_count,
    ],
    ['visible', 1, true, 1, 1],
  );
  Object.defineProperty(window.document, 'visibilityState', {
    configurable: true,
    value: 'hidden',
  });
  const hidden = await recordMemberPickerBoundary({
    panel,
    phase: 'after_escape_keydown',
    report,
    output: '/tmp/proof',
    writeReport: async () => {},
  });
  assert.equal(hidden.panel_visibility, 'hidden');
  assert.equal(JSON.stringify(report).includes('a4152086'), false);
  await window.happyDOM.abort();
});

test('checked UUID proof retains trusted picker action and Escape ordering', async () => {
  const actions = [];
  const id = 'a4152086-c3e5-44e8-a853-8e3da9918dd8';
  const fingerprint = await selectedMemberOrganizationFingerprint({
    panel: { send: async (method, args) => actions.push(`${method}:${args.type}`) },
    click: async (_panel, kind) => actions.push(`click:${kind}`),
    evaluate: async () => ({ pickerCount: 1, checkedCount: 1, value: id, labelMatches: true }),
    waitFor: async (_label, read, accept, timeout) => {
      assert.equal(timeout, 10_000);
      const value = await read();
      assert.equal(accept(value), true);
      return value;
    },
    hash: (value) => `fingerprint:${value === id}`,
    UUID: /^[0-9a-f-]{36}$/,
    samplePickerBoundary: async (phase) => actions.push(`sample:${phase}`),
  });
  assert.equal(fingerprint, 'fingerprint:true');
  assert.deepEqual(actions, [
    'sample:before_picker_click',
    'click:organization',
    'sample:after_picker_click',
    'sample:after_checked_option_proof',
    'sample:before_escape_keydown',
    'Input.dispatchKeyEvent:keyDown',
    'sample:after_escape_keydown',
    'Input.dispatchKeyEvent:keyUp',
    'sample:after_escape_keyup',
  ]);
});

test('ambiguous checked options refuse proof and still release the native key', async () => {
  const actions = [];
  await assert.rejects(
    () =>
      selectedMemberOrganizationFingerprint({
        panel: { send: async (_method, args) => actions.push(args.type) },
        click: async () => actions.push('click'),
        evaluate: async () => ({
          pickerCount: 1,
          checkedCount: 2,
          value: null,
          labelMatches: false,
        }),
        waitFor: async (_label, read, accept) => {
          assert.equal(accept(await read()), false);
          throw new Error('member_selected_organization_option_not_observed');
        },
        hash: () => {
          throw new Error('must not hash ambiguity');
        },
        UUID: /^[0-9a-f-]{36}$/,
        samplePickerBoundary: async (phase) => actions.push(phase),
      }),
    /member_selected_organization_option_not_observed/,
  );
  assert.deepEqual(actions.slice(-5), [
    'before_escape_keydown',
    'keyDown',
    'after_escape_keydown',
    'keyUp',
    'after_escape_keyup',
  ]);
  assert.equal(actions.includes('after_checked_option_proof'), false);
});

for (const failingPhase of [
  'after_picker_click',
  'before_escape_keydown',
  'after_escape_keydown',
]) {
  test(`diagnostic write failure at ${failingPhase} still releases Escape and refuses credit`, async () => {
    const actions = [];
    await assert.rejects(
      () =>
        selectedMemberOrganizationFingerprint({
          panel: { send: async (_method, args) => actions.push(args.type) },
          click: async () => actions.push('click'),
          evaluate: async () => ({
            pickerCount: 1,
            checkedCount: 1,
            value: 'a4152086-c3e5-44e8-a853-8e3da9918dd8',
            labelMatches: true,
          }),
          waitFor: async (_label, read, accept) => {
            const value = await read();
            assert.equal(accept(value), true);
            return value;
          },
          hash: () => 'fingerprint',
          UUID: /^[0-9a-f-]{36}$/,
          samplePickerBoundary: async (phase) => {
            actions.push(phase);
            if (phase === failingPhase) throw new Error('private write failure');
          },
        }),
      /member_picker_trace_persist_failed/,
    );
    assert.ok(actions.indexOf('keyDown') >= 0);
    assert.ok(actions.indexOf('keyUp') > actions.indexOf('keyDown'));
    assert.equal(actions.at(-1), 'after_escape_keyup');
  });
}
