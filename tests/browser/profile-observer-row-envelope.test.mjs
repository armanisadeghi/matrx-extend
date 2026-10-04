import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createClient } from '@supabase/supabase-js';
import { safeProfileBackendCode } from './profile-native-failure.mjs';

const source = await readFile(new URL('./profile-native-acceptance.mjs', import.meta.url), 'utf8');
const querySource = await readFile(
  new URL('../../src/lib/supabase/user-profile.ts', import.meta.url),
  'utf8',
);
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
const userId = 'db4a31ad-6b18-4d33-a296-593f1e7288c9';
const row = { user_id: userId };
const observerSource = source.slice(
  source.indexOf('function observeProfileRequests('),
  source.indexOf('async function openProfile('),
);
const queryStart = querySource.indexOf('  const { data, error } = await usersDb()');
const queryEnd = querySource.indexOf('  if (error)', queryStart);
assert.ok(queryStart >= 0 && queryEnd > queryStart);
const query = new AsyncFunction(
  'usersDb',
  'userId',
  `${querySource.slice(queryStart, queryEnd)} return { data, error };`,
);

// Actual request observer + actual app query chain + installed Supabase client.
// Only network/CDP responses are replaced. The SUT must see the raw list while
// the application receives maybeSingle's unwrapped row; neither owns the other.
for (const [label, payload, presence] of [
  ['empty list', [], false],
  ['one owner row', [row], true],
  ['single object', row, true],
  ['null', null, null],
  ['empty object', {}, null],
  ['malformed row', [{ user_id: 42 }], null],
  ['missing owner', [{}], null],
  ['multiple rows', [row, row], null],
]) {
  for (const base64Encoded of [false, true]) {
    test(`observer recognizes ${label}, base64=${base64Encoded}, without calling unknown absent`, async () => {
      const listeners = new Map();
      let responseRead;
      const body = JSON.stringify(payload);
      const panel = {
        on(name, fn) {
          listeners.set(name, fn);
          return () => listeners.delete(name);
        },
        async send(method) {
          if (method === 'Network.enable') return {};
          assert.equal(method, 'Network.getResponseBody');
          const result = {
            body: base64Encoded ? Buffer.from(body).toString('base64') : body,
            base64Encoded,
          };
          responseRead = Promise.resolve(result);
          return responseRead;
        },
      };
      const observer = new Function(
        'panel',
        'safeProfileBackendCode',
        `${observerSource}; return observeProfileRequests(panel);`,
      )(panel, safeProfileBackendCode);
      await observer.start();
      const client = createClient('https://db.invalid', 'opaque-test-key', {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        global: {
          fetch: async (url, options) => {
            assert.equal(new URL(url).searchParams.get('user_id'), `eq.${userId}`);
            assert.equal(new Headers(options.headers).get('Accept-Profile'), 'users');
            assert.notEqual(
              new Headers(options.headers).get('Accept'),
              'application/vnd.pgrst.object+json',
            );
            listeners.get('Network.requestWillBeSent')({
              requestId: 'owner-read',
              request: { url: String(url), method: options.method },
            });
            listeners.get('Network.responseReceived')({
              requestId: 'owner-read',
              response: { status: 200 },
            });
            listeners.get('Network.loadingFinished')({ requestId: 'owner-read' });
            return new Response(body, {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          },
        },
      });
      const result = await query(() => client.schema('users'), userId);
      await responseRead;
      const observation = observer.snapshot();
      assert.equal(observation.length, 1);
      assert.equal(observation[0].row_present, presence);
      if (label === 'one owner row') assert.deepEqual(result.data, row);
      if (label === 'empty list') assert.equal(result.data, null);
      observer.stop();
      assert.equal(listeners.size, 0);
    });
  }
}
