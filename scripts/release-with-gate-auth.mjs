#!/usr/bin/env node
// Mint a point-use user session for the authenticated server contract gate.
// The JWT exists only in this process and its release.sh child environment.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export async function gateSession(env, request = fetch) {
  const required = [
    'WXT_SUPABASE_URL',
    'WXT_SUPABASE_PUBLISHABLE_KEY',
    'AIDREAM_GATE_USERNAME',
    'AIDREAM_GATE_PASSWORD',
    'AIDREAM_GATE_ORGANIZATION_ID',
    'AIDREAM_API_URL',
  ];
  const missing = required.filter((name) => !env[name]);
  if (missing.length) throw new Error(`Missing release gate configuration: ${missing.join(', ')}`);
  const base = env.WXT_SUPABASE_URL.replace(/\/$/, '');
  const auth = await request(`${base}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: env.WXT_SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: env.AIDREAM_GATE_USERNAME, password: env.AIDREAM_GATE_PASSWORD }),
  });
  if (!auth.ok) throw new Error(`Release gate sign-in failed (${auth.status})`);
  const session = await auth.json();
  if (
    !session.access_token ||
    session.user?.email?.toLowerCase() !== env.AIDREAM_GATE_USERNAME.toLowerCase()
  )
    throw new Error('Release gate sign-in returned an invalid identity');

  // Match the client membership resolver. A readable organization is not
  // necessarily one that this user can act within.
  const membership = await request(`${base}/rest/v1/rpc/mbr_for_user`, {
    method: 'POST',
    headers: {
      apikey: env.WXT_SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
      'Content-Profile': 'public',
      'Accept-Profile': 'public',
    },
    body: JSON.stringify({ p_container_type: 'organization' }),
  });
  if (!membership.ok) throw new Error(`Release gate membership read failed (${membership.status})`);
  const rows = await membership.json();
  if (
    !Array.isArray(rows) ||
    !rows.some((row) => (row.container_id ?? row.containerId) === env.AIDREAM_GATE_ORGANIZATION_ID)
  )
    throw new Error('Release gate identity is not a member of the configured organization');
  return session.access_token;
}

// Local releases (release.sh with no caller-supplied AIDREAM_API_TOKEN) read
// the gate identity from the gitignored LOCAL_GATE_ENV and the public Supabase
// values from the committed production env. Values already in the environment
// win, so CI — which runs this file's main path, not --print-env — is unchanged.
export const LOCAL_GATE_ENV = '.env.release.local';
const PUBLIC_ENV = '.env.production';

export function localGateEnv(env, root, load = process.loadEnvFile) {
  for (const file of [LOCAL_GATE_ENV, PUBLIC_ENV]) {
    const path = resolve(root, file);
    if (!existsSync(path)) {
      if (file === LOCAL_GATE_ENV)
        throw new Error(
          `Local release gate needs ${LOCAL_GATE_ENV} with AIDREAM_API_URL, AIDREAM_GATE_USERNAME, AIDREAM_GATE_PASSWORD and AIDREAM_GATE_ORGANIZATION_ID`,
        );
      continue;
    }
    load(path);
  }
  return env;
}

async function main() {
  if (process.argv[2] === '--print-env') {
    // KEY=value lines for release.sh to export into its own check processes.
    // The JWT is written only to this pipe, never to a file or log.
    const env = localGateEnv(process.env, resolve(dirname(fileURLToPath(import.meta.url)), '..'));
    const token = await gateSession(env);
    process.stdout.write(
      `AIDREAM_API_TOKEN=${token}\nAIDREAM_ORGANIZATION_ID=${env.AIDREAM_GATE_ORGANIZATION_ID}\nAIDREAM_API_URL=${env.AIDREAM_API_URL}\n`,
    );
    return;
  }
  const token = await gateSession(process.env);
  if (process.argv[2] === '--check-auth') {
    process.stdout.write('Release gate identity and organization membership verified.\n');
    return;
  }
  const child = spawn('bash', ['release.sh', ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: {
      ...process.env,
      AIDREAM_API_TOKEN: token,
      AIDREAM_ORGANIZATION_ID: process.env.AIDREAM_GATE_ORGANIZATION_ID,
    },
  });
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (exitCode, signal) => resolve(signal ? 1 : (exitCode ?? 1)));
  });
  process.exitCode = code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    // Provider error bodies and session objects must never reach CI logs.
    process.stderr.write(
      `${error instanceof Error ? error.message : 'Release gate authentication failed'}\n`,
    );
    process.exitCode = 1;
  });
}
