'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { validateRealSiteUrls } = require('./vault-real-site-fill-acceptance.cjs');

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
