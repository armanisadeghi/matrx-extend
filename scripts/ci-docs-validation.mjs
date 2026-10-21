#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { changedPaths, classifyChangedPaths } from './ci-change-scope.mjs';

const base = process.env.CI_BASE_SHA;
const head = process.env.CI_HEAD_SHA;
const paths = changedPaths(process.cwd(), base, head);
if (classifyChangedPaths(paths, paths !== null) !== 'docs') {
  throw new Error('CI_DOCS_VALIDATION_SCOPE_UNPROVEN');
}
execFileSync('git', ['diff', '--check', base, head], { stdio: 'inherit' });
for (const path of paths) {
  if (path.endsWith('.json') && existsSync(path)) JSON.parse(readFileSync(path, 'utf8'));
  if (path.endsWith('.jsonl') && existsSync(path)) {
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean)) JSON.parse(line);
  }
}
console.log(`Validated ${paths.length} tracked documentation paths and JSON syntax`);
