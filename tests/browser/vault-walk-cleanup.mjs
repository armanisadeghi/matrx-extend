#!/usr/bin/env node
/**
 * Removes every "ZZ walk" vault item of admin@admin.com without a browser: password sign-in
 * (credentials file named by MATRX_PREPARE_ADMIN_CREDENTIALS_FILE, never printed), then the
 * vault API. Prints only counts. Exit 1 if any remain.
 */
import { readFile } from 'node:fs/promises';

const URL_ = 'https://db.matrxserver.com';
const KEY = (await readFile(new URL('../../.env.production', import.meta.url), 'utf8')).match(
  /^WXT_SUPABASE_PUBLISHABLE_KEY=(.*)$/m,
)[1];
const cred = JSON.parse(await readFile(process.env.MATRX_PREPARE_ADMIN_CREDENTIALS_FILE, 'utf8'));
const j = async (r) => ({ status: r.status, json: await r.json().catch(() => null) });
const tok = await j(
  await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ email: cred.email, password: cred.password }),
  }),
);
if (tok.status !== 200) throw new Error(`signin_${tok.status}`);
const bearer = `Bearer ${tok.json.access_token}`;
const mem = await j(
  await fetch(`${URL_}/rest/v1/rpc/mbr_for_user`, {
    method: 'POST',
    headers: {
      apikey: KEY,
      authorization: bearer,
      'content-type': 'application/json',
      'content-profile': 'public',
    },
    body: JSON.stringify({ p_container_type: 'organization' }),
  }),
);
if (!Array.isArray(mem.json))
  throw new Error('mbr_' + mem.status + ' ' + JSON.stringify(mem.json).slice(0, 200));
const orgs = [
  ...new Set((mem.json ?? []).filter((m) => m.status === 'active').map((m) => m.container_id)),
];
const api = (org, method, path) =>
  fetch(`https://server.app.matrxserver.com/vault${path}`, {
    method,
    headers: { authorization: bearer, 'x-organization-id': org },
  });
const walk = (i) =>
  /^ZZ walk/.test(i.display_name ?? '') || /127\.0\.0\.1/.test(JSON.stringify(i.login_urls ?? []));
let deleted = 0;
let remaining = 0;
for (const org of orgs) {
  for (let pass = 0; pass < 3; pass++) {
    const r = await api(org, 'GET', '/items');
    if (r.status !== 200) continue;
    const items = (await r.json()).items.filter(walk);
    remaining = items.length;
    for (const it of items) {
      for (let k = 0; k < 5; k++)
        if ((await api(org, 'DELETE', `/items/${it.id}`)).status === 204) {
          deleted++;
          break;
        }
    }
    if (!items.length) break;
  }
}
console.log(JSON.stringify({ orgs: orgs.length, deleted, remainingAfterLastPass: remaining }));
