import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createGuestSendReadinessTimeline } from './guest-chat-input-driver.mjs';

test('failure report keeps the exact Send and initialization-shell evidence', () => {
  const source = readFileSync(
    new URL('./guest-chat-store-acceptance.mjs', import.meta.url),
    'utf8',
  );
  const body = source.match(
    /function diagnosticState\(state, fixture\) \{[\s\S]*?\n\}\n\nasync function capture/,
  )?.[0];
  assert.ok(body, 'acceptance diagnostic transform must be present');
  const diagnosticState = new Function(
    'safeVisibleText',
    `${body.slice(0, -'\n\nasync function capture'.length)}; return diagnosticState;`,
  )(() => '[redacted]');
  const state = {
    composerLength: 139,
    sendEnabled: false,
    sendControlCount: 0,
    sendControlDisabled: null,
    sendLikeControlCount: 1,
    sendLikeControls: [{ label: 'initializing', disabled: true, ariaDisabled: null }],
    initializationShellVisible: true,
  };
  const result = diagnosticState(state, {});
  assert.equal(result.composerLength, 139);
  assert.equal(result.sendControlCount, 0);
  assert.equal(result.sendControlDisabled, null);
  assert.equal(result.sendLikeControlCount, 1);
  assert.equal(result.initializationShellVisible, true);
  assert.deepEqual(result.sendLikeControls, [
    { label: 'initializing', disabled: true, ariaDisabled: null },
  ]);
});

test('send readiness timeline retains shell-to-ready timing and only bounded control states', () => {
  let time = 1000;
  const timeline = createGuestSendReadinessTimeline(() => time);
  const shell = {
    paneVisible: true,
    composerLength: 139,
    sendEnabled: false,
    sendControlCount: 0,
    sendControlDisabled: null,
    sendLikeControlCount: 1,
    sendLikeControls: [
      {
        label: 'initializing',
        disabled: true,
        ariaDisabled: null,
        prompt: 'private draft must not leave this state',
      },
    ],
    initializationShellVisible: true,
  };
  timeline.record('after_insert', shell);
  time = 1080;
  timeline.record('wait', shell);
  time = 1180;
  timeline.record('wait', shell);
  assert.equal(timeline.snapshot().samples.length, 2, 'unchanged polls stay compact');

  time = 1240;
  timeline.record('wait', {
    ...shell,
    sendEnabled: true,
    sendControlCount: 1,
    sendControlDisabled: false,
    sendLikeControls: [{ label: 'send', disabled: false, ariaDisabled: 'false' }],
    initializationShellVisible: false,
  });
  const result = timeline.snapshot();
  assert.equal(result.first_enabled_ms, 240);
  assert.equal(result.last_observed_ms, 240);
  assert.equal(result.samples.length, 3);
  assert.deepEqual(result.samples.at(-1).send_like_controls, [
    { label: 'send', disabled: false, aria_disabled: 'false' },
  ]);
  assert.equal(result.samples[0].composer_length, 139);
  assert.equal(JSON.stringify(result).includes('private draft'), false);
});

test('send readiness timeline bounds repeated transitions and arbitrary control attributes', () => {
  let time = 0;
  const timeline = createGuestSendReadinessTimeline(() => time);
  for (let index = 0; index < 20; index += 1) {
    timeline.record('wait', {
      sendEnabled: index % 2 === 1,
      sendControlCount: 1,
      sendLikeControlCount: 7,
      sendLikeControls: Array.from({ length: 7 }, () => ({
        label: 'Send message password=secret',
        disabled: false,
        ariaDisabled: 'password=secret',
      })),
    });
    time += 10;
  }
  const result = timeline.snapshot();
  assert.equal(result.samples.length, 12);
  assert.equal(result.last_observed_ms, 190);
  assert.equal(result.first_enabled_ms, 10);
  assert.equal(result.samples.at(-1).send_enabled, true);
  assert.equal(result.samples.at(-1).send_like_controls.length, 4);
  assert.equal(JSON.stringify(result).includes('secret'), false);
});

test('a failed panel observation stays unknown rather than looking like a disabled Send', () => {
  const timeline = createGuestSendReadinessTimeline(() => 0);
  timeline.record('wait', null);
  const sample = timeline.snapshot().samples[0];
  assert.equal(sample.observation_available, false);
  assert.equal(sample.send_enabled, null);
  assert.equal(sample.send_control_count, null);
  assert.equal(sample.initialization_shell_visible, null);
});
