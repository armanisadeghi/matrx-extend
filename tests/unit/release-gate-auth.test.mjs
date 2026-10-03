import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gateSession } from '../../scripts/release-with-gate-auth.mjs';

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
