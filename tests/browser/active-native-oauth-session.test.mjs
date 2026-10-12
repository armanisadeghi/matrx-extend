import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { ownedPatternRootRequest } from './data-member-auto-extract-driver.mjs';
import { nativeOAuthBearerFromSession } from './native-oauth-session.mjs';
import { storageShapeExpression } from './reviewer-chat-storage-shape.mjs';

const repository = resolve(import.meta.dirname, '../..');
async function activeModules() {
  const scripts = await readdir(resolve(repository, 'scripts'));
  // Profile explicitly refuses hosted dispatch until durable recovery is available.
  const routes = [
    'hosted-guest-acceptance.mjs',
    ...scripts.filter(
      (name) => /^hosted-.*-route\.mjs$/.test(name) && name !== 'hosted-profile-route.mjs',
    ),
  ];
  const modules = new Map();
  async function visit(path) {
    if (modules.has(path)) return;
    const source = await readFile(path, 'utf8');
    modules.set(path, source);
    for (const match of source.matchAll(/(?:from\s*|import\s*\()['"](\.[^'"]+\.mjs)['"]/g)) {
      await visit(resolve(dirname(path), match[1]));
    }
  }
  for (const route of routes) {
    const source = await readFile(resolve(repository, 'scripts', route), 'utf8');
    for (const match of source.matchAll(/['"](tests\/browser\/[^'"]+\.mjs)['"]/g)) {
      await visit(resolve(repository, match[1]));
    }
  }
  return modules;
}
function staleConsumers(modules) {
  return [...modules]
    .filter(([path, source]) => {
      // D217 intentionally records absence of the retired bearer, never consumes it.
      if (path.endsWith('/scrape-save-stale-profile.mjs')) {
        source = source.replace(
          /legacy_bearer_absent: !stored\['matrx\.auth\.accessToken'\],/g,
          '',
        );
      }
      return source.includes('matrx.auth.accessToken');
    })
    .map(([path]) => path.slice(repository.length + 1));
}
test('hosted route graph has no consumers of the retired access token', async () => {
  const modules = await activeModules();
  assert.deepEqual(staleConsumers(modules), []);
  const path = resolve(repository, 'tests/browser/data-member-native-acceptance.mjs');
  modules.set(path, `${modules.get(path)}\nchrome.storage.local.get('matrx.auth.accessToken');`);
  assert.deepEqual(staleConsumers(modules), ['tests/browser/data-member-native-acceptance.mjs']);
});

async function requestContract(mutation = (expression) => expression) {
  for (const [index, method] of ['GET', 'PATCH'].entries()) {
    const bearer = `opaque-current-${index}`;
    const patternId = '00000000-0000-4000-8000-000000000001';
    const organizationId = '00000000-0000-4000-8000-000000000002';
    const calls = [];
    const panel = {
      async send(_method, { expression }) {
        const value = await runInNewContext(mutation(expression), {
          chrome: {
            storage: {
              local: {
                get: async () => ({
                  'matrx.oauth.session': JSON.stringify({ v: 1, accessToken: bearer }),
                  'matrx.auth.accessToken': 'opaque-stale-token',
                }),
              },
            },
          },
          fetch: async (url, options) => {
            calls.push({ url, options });
            assert.equal(options.headers.Authorization, `Bearer ${bearer}`);
            assert.equal(options.headers['X-Organization-Id'], organizationId);
            return {
              status: 200,
              json: async () => [
                {
                  id: patternId,
                  organization_id: organizationId,
                  list_root_selector: `main-${index}`,
                },
              ],
            };
          },
        });
        return { result: { value } };
      },
    };
    assert.equal(
      await ownedPatternRootRequest({
        panel,
        patternId,
        organizationId,
        supabaseOrigin: 'https://db.matrxserver.com',
        publishableKey: 'sb_publishable_fixture',
        method,
        root: `main-${index}`,
      }),
      `main-${index}`,
    );
    assert.equal(calls.length, 1);
    const url = new URL(calls[0].url);
    assert.equal(url.searchParams.get('id'), `eq.${patternId}`);
    assert.equal(url.searchParams.get('organization_id'), `eq.${organizationId}`);
    assert.equal(calls[0].options.method, method);
    if (method === 'PATCH')
      assert.deepEqual(JSON.parse(calls[0].options.body), {
        list_root_selector: `main-${index}`,
      });
  }
}
test('member fixture emits authenticated requests from current OAuth even with stale bearer present', async () => {
  await requestContract();
});
test('fixture guard rejects retired-reader and skipped-request mutations', async () => {
  await assert.rejects(
    requestContract((expression) =>
      expression.replace(
        'const token = (await',
        "const token = 'opaque-stale-token'; const unused = (await",
      ),
    ),
    { code: 'ERR_ASSERTION' },
  );
  await assert.rejects(
    requestContract(
      () => `({ status: 200, rows: [{
    id: '00000000-0000-4000-8000-000000000001',
    organization_id: '00000000-0000-4000-8000-000000000002', list_root_selector: 'main-0' }] })`,
    ),
    { code: 'ERR_ASSERTION' },
  );
});
test('auth summaries reflect current, absent and malformed OAuth without exposing bearer', async () => {
  for (const serialized of [
    JSON.stringify({ v: 1, accessToken: 'opaque-current' }),
    undefined,
    '{broken',
    JSON.stringify({ v: 2, accessToken: 'opaque-future' }),
    JSON.stringify({ v: 1, accessToken: '' }),
  ]) {
    const result = await runInNewContext(storageShapeExpression(), {
      chrome: {
        storage: {
          local: {
            get: async () => ({
              'matrx.oauth.session': serialized,
              'matrx.auth.accessToken': 'opaque-stale',
            }),
          },
        },
      },
    });
    assert.equal(
      result.accessTokenPresent,
      serialized === JSON.stringify({ v: 1, accessToken: 'opaque-current' }),
    );
    assert.equal(JSON.stringify(result).includes('opaque'), false);
  }
  assert.equal(nativeOAuthBearerFromSession(undefined), null);
});
