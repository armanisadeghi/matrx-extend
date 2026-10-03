import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import {
  LOCAL_GATE_ENV,
  gateSession,
  localGateEnv,
} from '../../scripts/release-with-gate-auth.mjs';

const env = {
  WXT_SUPABASE_URL: 'https://db.example',
  WXT_SUPABASE_PUBLISHABLE_KEY: 'publishable',
  AIDREAM_API_URL: 'https://api.example',
  AIDREAM_GATE_USERNAME: 'reviewer@example.com',
  AIDREAM_GATE_PASSWORD: 'password',
  AIDREAM_GATE_ORGANIZATION_ID: 'chosen-org',
};
function response(rows = [{ container_id: 'chosen-org' }]) {
  return async (url, init) => {
    if (url.includes('/auth/v1/token')) {
      assert.equal(JSON.parse(init.body).email, env.AIDREAM_GATE_USERNAME);
      return {
        ok: true,
        json: async () => ({
          access_token: 'point-use',
          user: { email: env.AIDREAM_GATE_USERNAME },
        }),
      };
    }
    assert.equal(init.headers.Authorization, 'Bearer point-use');
    assert.deepEqual(JSON.parse(init.body), { p_container_type: 'organization' });
    return { ok: true, json: async () => rows };
  };
}

test('mints a session only for the explicitly configured member organization', async () => {
  assert.equal(await gateSession(env, response()), 'point-use');
  await assert.rejects(gateSession(env, response([{ container_id: 'other-org' }])), /not a member/);
});

test('refuses missing explicit organization without attempting sign-in', async () => {
  await assert.rejects(
    gateSession({ ...env, AIDREAM_GATE_ORGANIZATION_ID: '' }, () => {
      throw new Error('unexpected request');
    }),
    /AIDREAM_GATE_ORGANIZATION_ID/,
  );
});

test('local mode loads the gitignored gate env, then the public env, and names a missing file', () => {
  const loaded = [];
  const root = new URL('../..', import.meta.url).pathname;
  // Both files exist in a configured local checkout; the loader is injected so
  // the test never reads real credentials.
  if (existsSync(`${root}${LOCAL_GATE_ENV}`)) {
    localGateEnv({}, root, (path) => loaded.push(path));
    assert.deepEqual(
      loaded.map((path) => path.split('/').pop()),
      [LOCAL_GATE_ENV, '.env.production'],
    );
  }
  assert.throws(() => localGateEnv({}, '/nonexistent-root', () => {}), /\.env\.release\.local/);
});
