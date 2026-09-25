'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const {
  validateRealSiteUrls,
  observePostFillSubmission,
  panelStatusExpression,
} = require('./vault-real-site-fill-acceptance.cjs');

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
  ])
    assert.throws(() => validateRealSiteUrls(login, wrong));
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

test('wrong-site status uses the panel string-expression contract', async () => {
  const strictPanel = {
    evaluate: async (expression) => {
      if (typeof expression !== 'string') throw new Error('panel_expression_must_be_string');
      assert.match(expression, /const tabId = 731;/);
      assert.match(expression, /credential-suggestions:panel-status/);
      return { status: 'none', exactNoMatchShape: true };
    },
  };
  await assert.rejects(
    () => strictPanel.evaluate(async () => ({ status: 'none', exactNoMatchShape: true }), 731),
    /panel_expression_must_be_string/,
  );
  assert.deepEqual(await strictPanel.evaluate(panelStatusExpression(731)), {
    status: 'none',
    exactNoMatchShape: true,
  });
  assert.throws(() => panelStatusExpression('731'), /real_site_fill_wrong_tab_invalid/);
});
