#!/usr/bin/env node
/** Fail closed when the event's exact comparison range cannot be proved. */
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { isRuntimeEquivalentDocumentationPath } from './development-source-compatibility.mjs';

export function classifyChangedPaths(paths, baseAvailable = true) {
  if (!baseAvailable || !Array.isArray(paths) || paths.length === 0) return 'full';
  return paths.every(isRuntimeEquivalentDocumentationPath) ? 'docs' : 'full';
}

export function changedPaths(root, base, head) {
  if (!/^[a-f0-9]{40}$/.test(base ?? '') || !/^[a-f0-9]{40}$/.test(head ?? '')) return null;
  if (/^0+$/.test(base) || /^0+$/.test(head)) return null;
  try {
    execFileSync('git', ['cat-file', '-e', `${base}^{commit}`], { cwd: root, stdio: 'ignore' });
    execFileSync('git', ['cat-file', '-e', `${head}^{commit}`], { cwd: root, stdio: 'ignore' });
    const ancestor = execFileSync('git', ['merge-base', base, head], {
      cwd: root,
      encoding: 'utf8',
    }).trim();
    if (ancestor !== base) return null;
    const endpointPaths = execFileSync(
      'git',
      ['diff', '--no-renames', '--name-only', '-z', base, head],
      {
        cwd: root,
        encoding: 'utf8',
      },
    )
      .split('\0')
      .filter(Boolean);
    const committedPaths = execFileSync(
      'git',
      ['log', '--no-renames', '--format=', '--name-only', '-z', `${base}..${head}`],
      {
        cwd: root,
        encoding: 'utf8',
      },
    )
      .split('\0')
      .filter(Boolean);
    return [...new Set([...endpointPaths, ...committedPaths])];
  } catch {
    return null;
  }
}

if (process.argv[1]?.endsWith('/ci-change-scope.mjs')) {
  const paths = changedPaths(process.cwd(), process.env.CI_BASE_SHA, process.env.CI_HEAD_SHA);
  const allowedEvent =
    process.env.CI_EVENT_NAME === 'pull_request' ||
    (process.env.CI_EVENT_NAME === 'push' && process.env.CI_EVENT_REF === 'refs/heads/main');
  const scope = classifyChangedPaths(paths, allowedEvent && paths !== null);
  console.log(JSON.stringify({ scope, paths: paths ?? [], baseAvailable: paths !== null }));
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `scope=${scope}\n`);
}
