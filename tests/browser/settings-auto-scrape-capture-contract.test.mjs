import assert from 'node:assert/strict';
import test from 'node:test';
import { assertCaptureOff, assertCaptureOn } from './settings-auto-scrape-capture-contract.mjs';

const marker = 'Harbor Dental intake hours October 2026';
const pageUrl = 'http://localhost:37193/harbor-dental-intake';
const on = () => ({
  visible: true,
  stored: true,
  pageUrl,
  calls: [{ kind: 'scrape:capture-page', ok: true, url: pageUrl, markerPresent: true }],
});
const off = () => ({
  visible: false,
  stored: false,
  pageLoaded: true,
  windowCompleted: true,
  calls: [],
});

test('T40 ON requires a real matching capture response and adopted result', () => {
  assert.doesNotThrow(() => assertCaptureOn(on(), marker));
  for (const broken of [
    { calls: [] },
    { calls: [{ ...on().calls[0], ok: false }] },
    { calls: [{ ...on().calls[0], markerPresent: false }] },
    { calls: [{ ...on().calls[0], url: 'http://localhost:37193/other' }] },
  ])
    assert.throws(() => assertCaptureOn({ ...on(), ...broken }, marker));
});

test('T40 OFF requires a completed loaded-page window without capture traffic', () => {
  assert.doesNotThrow(() => assertCaptureOff(off()));
  for (const broken of [
    { calls: on().calls },
    { windowCompleted: false },
    { pageLoaded: false },
    { stored: true },
  ])
    assert.throws(() => assertCaptureOff({ ...off(), ...broken }));
});
