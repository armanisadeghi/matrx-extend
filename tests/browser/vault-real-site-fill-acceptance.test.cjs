'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { validateRealSiteUrls, observePostFillSubmission } = require('./vault-real-site-fill-acceptance.cjs');

test('admits only the canonical HTTPS AI Matrx login and an owned different-origin refusal page', () => {
  assert.deepEqual(
    validateRealSiteUrls('https://www.aimatrx.com/login', 'http://127.0.0.1:4312/login'),
    { login: 'https://www.aimatrx.com/login', wrong: 'http://127.0.0.1:4312/login' },
  );
});

test('refuses lookalikes, noncanonical login URLs, and the login page as a wrong-site control', () => {
  for (const [login, wrong] of [
    ['http://www.aimatrx.com/login', 'http://127.0.0.1:4312/login'],
    ['https://www.aimatrx.com/login?next=x', 'http://127.0.0.1:4312/login'],
    ['https://www.aimatrx.com/login', 'https://aimatrx.com/'],
    ['https://www.aimatrx.com/login', 'https://www.aimatrx.com/login'],
  ]) assert.throws(() => validateRealSiteUrls(login, wrong));
});

test('post-fill observer catches delayed native navigation and programmatic network submission', () => {
  const page = new EventEmitter();
  const mainFrame = {};
  page.mainFrame = () => mainFrame;
  const observation = observePostFillSubmission(page);

  page.emit('request', {
    isNavigationRequest: () => true,
    frame: () => mainFrame,
    method: () => 'GET',
  });
  page.emit('request', {
    isNavigationRequest: () => false,
    frame: () => mainFrame,
    method: () => 'POST',
  });
  page.emit('framenavigated', mainFrame);

  assert.deepEqual(observation.observed, {
    navigationRequest: true,
    nonReadRequest: true,
    mainFrameNavigation: true,
  });
  observation.stop();
  assert.equal(page.listenerCount('request'), 0);
  assert.equal(page.listenerCount('framenavigated'), 0);
});
