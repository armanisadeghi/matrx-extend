#!/usr/bin/env node
/**
 * generate-extension-key — One-time script to lock in a stable extension ID.
 *
 * Why: Chrome derives an extension's ID deterministically from its public key.
 * If we generate a keypair once and put the public key into wxt.config.ts
 * (manifest.key), the same extension ID is used in:
 *   - dev (unpacked load)
 *   - production builds
 *   - all CI builds
 *
 * Usage:
 *   node scripts/generate-extension-key.mjs
 *
 * Outputs:
 *   - .secrets/matrx-extend.pem        (PRIVATE key — DO NOT commit; signed in .gitignore)
 *   - .secrets/matrx-extend.pub        (public key in DER, base64)
 *   - prints the extension ID and the chromiumapp.org redirect URI
 *
 * Then:
 *   1. Copy the printed public key into wxt.config.ts → manifest.key
 *   2. Register the printed redirect URI as an allowed redirect on the
 *      Supabase OAuth client "matrx-extend"
 */

import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SECRETS_DIR = resolve(ROOT, '.secrets');
const PEM_PATH = resolve(SECRETS_DIR, 'matrx-extend.pem');
const PUB_PATH = resolve(SECRETS_DIR, 'matrx-extend.pub');

if (!existsSync(SECRETS_DIR)) mkdirSync(SECRETS_DIR, { recursive: true });

if (!existsSync(PEM_PATH)) {
  console.log('▸ Generating new RSA-2048 keypair…');
  // Chrome packs use RSA-2048. Plain `openssl genrsa` works.
  execSync(`openssl genrsa -out "${PEM_PATH}" 2048`, { stdio: 'inherit' });
} else {
  console.log(`▸ Reusing existing private key at ${PEM_PATH}`);
}

// Extract the SubjectPublicKeyInfo (DER). This is what Chrome hashes.
const derPath = resolve(SECRETS_DIR, 'matrx-extend.spki.der');
execSync(`openssl rsa -in "${PEM_PATH}" -pubout -outform DER -out "${derPath}" 2>/dev/null`);
const der = readFileSync(derPath);

// 1) Compute the Chrome extension ID:
//    sha256(pubkey-DER), first 16 bytes, map each nibble 0-15 → 'a'-'p'
const hash = createHash('sha256').update(der).digest();
let extId = '';
for (let i = 0; i < 16; i++) {
  const byte = hash[i];
  // each byte → two letters; high nibble first.
  extId += String.fromCharCode(97 + ((byte >> 4) & 0x0f));
  extId += String.fromCharCode(97 + (byte & 0x0f));
}

// 2) Base64-encode the DER for the manifest.key field.
const pubB64 = der.toString('base64');
writeFileSync(PUB_PATH, pubB64, 'utf8');

const redirectUri = `https://${extId}.chromiumapp.org/`;

console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  Stable extension key generated');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('');
console.log('Extension ID :', extId);
console.log('Redirect URI :', redirectUri);
console.log('');
console.log('  ➊  Paste THIS into wxt.config.ts → manifest.key:');
console.log('');
console.log(`     key: '${pubB64}',`);
console.log('');
console.log('  ➋  In Supabase OAuth dashboard, edit the "matrx-extend" client');
console.log('     and add this redirect URI:');
console.log('');
console.log(`     ${redirectUri}`);
console.log('');
console.log('  Files written:');
console.log(`     ${PEM_PATH}    (PRIVATE KEY — DO NOT COMMIT)`);
console.log(`     ${PUB_PATH}    (public key, safe to commit)`);
console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
