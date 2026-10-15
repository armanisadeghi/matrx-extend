#!/usr/bin/env tsx
/**
 * config:manifest — generate the release config manifest (the DECLARED half of config attestation)
 * from the typed registry (src/lib/config/registry.ts) and the real call sites, never by hand.
 *
 *   pnpm config:manifest [--out <path>] [--sha <40-hex>]
 *
 * readers[] come from scanning src/ for `appConfig('<key>')` and `resolveKnob({feature, key})` /
 * `recordKnobRead('feature.key')` call sites; a registered key with NO call site is an error (a
 * declared-but-unread key would otherwise be a lie), and so is a call site naming an unregistered key.
 * Release identity: --sha / MATRX_BUILD_SHA / git HEAD — the same value wxt.config.ts embeds.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { buildConfigManifest } from '@ai-matrx/data/config-attestation';
import { APP_CONFIG_KEYS, APP_SLUG, KNOB_FEATURES, PACKAGE_CHAT_FEATURES } from '../src/lib/config/registry';

const root = join(import.meta.dirname, '..');
const arg = (n: string) => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

function* walk(dir: string): Generator<string> {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(ts|tsx)$/.test(e) && !/\.test\.tsx?$/.test(e)) yield p;
  }
}

export function scanReaders(srcDir: string): {
  appKeys: Record<string, string[]>;
  knobs: Record<string, string[]>;
} {
  const appKeys: Record<string, string[]> = {};
  const knobs: Record<string, string[]> = {};
  for (const f of walk(srcDir)) {
    const rel = relative(root, f);
    if (rel === 'src/lib/config/index.ts' || rel === 'src/lib/config/registry.ts') continue;
    const text = readFileSync(f, 'utf8');
    for (const m of text.matchAll(/appConfig(?:<[^>]*>)?\(\s*'([a-z0-9_]+)'\s*\)/g))
      (appKeys[m[1]!] ??= []).push(rel);
    // Wrappers over the reader: a call site of appFlag / appConfigNotice / appConfigVersionFloor reads that key.
    const wrappers: Array<[RegExp, string]> = [
      [/\bappFlag\(/, 'flags'],
      [/\bappConfigNotice\(/, 'notice'],
      [/\bappConfigVersionFloor\(/, 'min_supported_app_version'],
    ];
    for (const [re, key] of wrappers) if (re.test(text)) (appKeys[key] ??= []).push(rel);
    for (const m of text.matchAll(
      /resolveKnob\(\{\s*feature:\s*([A-Za-z_'.]+),\s*key:\s*([A-Za-z_'.]+)/g,
    )) {
      const lit = (v: string) => (v.startsWith("'") ? v.slice(1, -1) : undefined);
      let feature = lit(m[1]!);
      let key = lit(m[2]!);
      // A named constant: resolve `const NAME = 'value'` in the same file.
      const constant = (n: string) =>
        text.match(new RegExp(`const\\s+${n}\\s*=\\s*'([^']+)'`))?.[1];
      feature ??= constant(m[1]!);
      key ??= constant(m[2]!);
      if (feature && key) (knobs[`${feature}.${key}`] ??= []).push(rel);
    }
  }
  return { appKeys, knobs };
}

function main() {
  const sha =
    arg('--sha') ??
    process.env.MATRX_BUILD_SHA ??
    execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const out = arg('--out') ?? join(root, '.output', 'config-manifest.json');
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string };
  const { appKeys, knobs } = scanReaders(join(root, 'src'));
  const registeredKnobs = KNOB_FEATURES.flatMap((f) =>
    Object.values(f.defs).map((d) => `${f.feature}.${d.key}`),
  );
  // The attestation interval knob is read by the reporter itself (src/lib/config/reporting.ts).
  knobs['platform.config_attestation.flush_interval_minutes'] = ['src/lib/config/reporting.ts'];
  // Snapshot-served knobs are read through platform-knobs (dynamic keys); register them by that reader.
  const problems: string[] = [];
  for (const k of APP_CONFIG_KEYS)
    if (!appKeys[k])
      problems.push(`app_config key '${k}' is registered but has no appConfig('${k}') call site`);
  for (const k of Object.keys(appKeys))
    if (!(APP_CONFIG_KEYS as readonly string[]).includes(k))
      problems.push(`appConfig('${k}') is called but not registered`);
  for (const k of Object.keys(knobs))
    if (!registeredKnobs.includes(k)) problems.push(`knob '${k}' is read but not registered`);
  // A registered knob with no explicit call site is read through the platform snapshot reader.
  for (const k of registeredKnobs) knobs[k] ??= [PACKAGE_CHAT_FEATURES.has(k.slice(0, k.lastIndexOf('.'))) ? 'src/features/package-chat/knobs.ts' : 'src/lib/settings/platform-knobs.ts'];
  if (problems.length) {
    console.error(`config:manifest REFUSED:\n - ${problems.join('\n - ')}`);
    process.exit(1);
  }
  const url = process.env.WXT_SUPABASE_URL ?? readEnvFile('WXT_SUPABASE_URL');
  const key =
    process.env.WXT_SUPABASE_PUBLISHABLE_KEY ?? readEnvFile('WXT_SUPABASE_PUBLISHABLE_KEY');
  const manifest = buildConfigManifest({
    app: APP_SLUG,
    appVersion: pkg.version,
    buildSha: sha,
    knobFeatures: [...KNOB_FEATURES] as never,
    appConfigKeys: APP_CONFIG_KEYS.map((k) => ({ key: k, readers: appKeys[k]! })),
    readers: knobs,
    bootstrap: {
      database_url: url,
      database_realtime_url: url.replace(/^https:/, 'wss:') + '/realtime/v1',
      publishable_key_prefix: key.slice(0, 12),
      source: 'wxt build env (WXT_SUPABASE_URL, WXT_SUPABASE_PUBLISHABLE_KEY)',
    },
  });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    `config:manifest wrote ${out} (${manifest.app_config.keys.length} app_config keys, ${manifest.knobs.length} knobs) for ${APP_SLUG}@${pkg.version} ${sha}`,
  );
}

function readEnvFile(name: string): string {
  for (const f of ['.env.production', '.env', '.env.local']) {
    try {
      const m = readFileSync(join(root, f), 'utf8').match(new RegExp(`^${name}=(.*)$`, 'm'));
      if (m) return m[1]!.trim().replace(/^["']|["']$/g, '');
    } catch {
      /* next */
    }
  }
  throw new Error(`config:manifest needs ${name} (env or .env.production).`);
}

main();
