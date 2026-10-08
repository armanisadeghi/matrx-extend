#!/usr/bin/env node
/**
 * measure-chat-tab — how heavy is the Chat tab, in gzip kB, for the extension's own chat vs the
 * `@ai-matrx/chat` package chat (`sidepanel.html?chat=package`).
 *
 * Method (the chat-package-move analysis, EXTEND-SWITCH-ANALYSIS.md section 4): closure over the
 * built chunks. Static edges are `import ... from "./x.js"`, `export ... from "./x.js"` and bare
 * `import "./x.js"`; dynamic edges are literal `import("./x.js")`.
 *   shell     = static closure of the side-panel entry chunk (what every tab already pays).
 *   Chat tab  = static closure of the chat entry chunk, minus the shell.
 *   reachable = Chat tab plus every chunk it can lazy-load (one hop of import(), each with its static
 *               closure), minus the shell.
 *
 *   pnpm build   # or: WXT_OUT_DIR=.output-x pnpm build
 *   node scripts/measure-chat-tab.mjs [--dir .output/chrome-mv3] [--json] [--top 15]
 *
 * Prints one block per chat entry it finds (`ChatView-*.js` = the extension's own chat,
 * `PackageChatView-*.js` = the package chat). Run it on a build before and after a change.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const dir = resolve(flag('--dir', '.output/chrome-mv3'));
const asJson = args.includes('--json');
const top = Number(flag('--top', '15'));
const chunks = join(dir, 'chunks');

const files = readdirSync(chunks).filter((f) => f.endsWith('.js'));
const text = new Map(files.map((f) => [f, readFileSync(join(chunks, f), 'utf8')]));
const gz = new Map(files.map((f) => [f, gzipSync(text.get(f)).length]));
const kb = (set) => [...set].reduce((n, f) => n + (gz.get(f) ?? 0), 0) / 1024;

const STATIC = /(?:\bfrom|\bimport)\s*["'`]\.\/([^"'`]+\.js)["'`]/g;
const DYNAMIC = /\bimport\(\s*["'`]\.\/([^"'`]+\.js)["'`]\s*\)/g;
const edges = (f, re) => {
  const out = new Set();
  for (const m of text.get(f).matchAll(re)) if (text.has(m[1])) out.add(m[1]);
  return out;
};

function closure(seeds, dynamic) {
  const seen = new Set();
  const stack = [...seeds];
  while (stack.length) {
    const f = stack.pop();
    if (!f || seen.has(f) || !text.has(f)) continue;
    seen.add(f);
    for (const n of edges(f, STATIC)) stack.push(n);
    if (dynamic) for (const n of edges(f, DYNAMIC)) stack.push(n);
  }
  return seen;
}

const shellEntry = files.find((f) => /^sidepanel-[\w-]+\.js$/.test(f) && !/^sidepanel-tab/.test(f));
if (!shellEntry) throw new Error(`no sidepanel-*.js entry chunk in ${chunks}`);
const shell = closure([shellEntry], false);

const entries = files.filter((f) => /^(Package)?ChatView-[\w-]+\.js$/.test(f));
const report = { dir, shellKb: round(kb(shell)), shellChunks: shell.size, entries: {} };
for (const entry of entries) {
  const name = entry.startsWith('Package') ? 'package' : 'extension';
  const stat = closure([entry], false);
  // One hop of laziness: every chunk the Chat tab can pull in on demand (a dynamic import() written in
  // a chunk of its static closure), each with its own static closure. Following lazy edges
  // transitively reaches the whole app, which says nothing about the tab.
  const lazyTargets = new Set();
  for (const f of stat) for (const n of edges(f, DYNAMIC)) lazyTargets.add(n);
  const all = new Set([...stat, ...closure([...lazyTargets], false)]);
  const beyondStatic = new Set([...stat].filter((f) => !shell.has(f)));
  const beyondAll = new Set([...all].filter((f) => !shell.has(f)));
  report.entries[name] = {
    entry,
    chatTabKb: round(kb(beyondStatic)),
    chatTabChunks: beyondStatic.size,
    reachableKb: round(kb(beyondAll)),
    reachableChunks: beyondAll.size,
    biggest: [...beyondStatic]
      .map((f) => [f, round(gz.get(f) / 1024)])
      .sort((a, b) => b[1] - a[1])
      .slice(0, top),
  };
}

function round(n) {
  return Math.round(n * 10) / 10;
}

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`build: ${dir}`);
  console.log(`shell (static closure of ${shellEntry}): ${report.shellKb} kB gzip, ${report.shellChunks} chunks`);
  for (const [name, r] of Object.entries(report.entries)) {
    console.log(`\n[${name}] ${r.entry}`);
    console.log(`  Chat tab (static, beyond shell): ${r.chatTabKb} kB gzip, ${r.chatTabChunks} chunks`);
    console.log(`  reachable incl. lazy (beyond shell): ${r.reachableKb} kB gzip, ${r.reachableChunks} chunks`);
    console.log(`  biggest static chunks:`);
    for (const [f, k] of r.biggest) console.log(`    ${String(k).padStart(7)} kB  ${f}`);
  }
}
