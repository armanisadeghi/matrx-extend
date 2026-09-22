'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { validateRealSiteUrls } = require('./vault-real-site-fill-acceptance.cjs');

test('admits only the canonical HTTPS AI Matrx login and a distinct same-origin refusal page', () => {
  assert.deepEqual(
    validateRealSiteUrls('https://www.aimatrx.com/login', 'https://www.aimatrx.com/'),
    { login: 'https://www.aimatrx.com/login', wrong: 'https://www.aimatrx.com/' },
  );
});

test('refuses lookalikes, noncanonical login URLs, and the login page as a wrong-site control', () => {
  for (const [login, wrong] of [
    ['http://www.aimatrx.com/login', 'https://www.aimatrx.com/'],
    ['https://www.aimatrx.com/login?next=x', 'https://www.aimatrx.com/'],
    ['https://www.aimatrx.com/login', 'https://aimatrx.com/'],
    ['https://www.aimatrx.com/login', 'https://www.aimatrx.com/login'],
  ]) assert.throws(() => validateRealSiteUrls(login, wrong));
});
