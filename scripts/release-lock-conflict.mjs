#!/usr/bin/env node
// Return a merge tree only for concurrent @ai-matrx lock refreshes. Every
// other conflict, manifest edit, or lockfile edit needs a human merge.
import { execFileSync, spawnSync } from 'node:child_process';

const [remote, local] = process.argv.slice(2);
if (!remote || !local) process.exit(2);
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
// Nested in the aidream monorepo (cwd apps/matrx-extend) git names paths from the toplevel: every read and
// every conflict path carries the app's prefix ('' standalone).
const PREFIX = git('rev-parse', '--show-prefix');
const show = (ref, path) => git('show', `${ref}:${PREFIX}${path}`);

// Parse the shared-package records separately so only resolved version moves
// are eligible. Existing package metadata and importer specifiers are data,
// not expendable output of a merge.
function lockRecords(text) {
  const lines = text.split('\n');
  const kept = [];
  const records = { importers: new Map(), packages: new Map(), snapshots: new Map() };
  let section = '';
  let record = null;
  function finishRecord() {
    if (!record) return;
    const sectionRecords = records[record.section];
    if (sectionRecords.has(record.key))
      throw new Error(`duplicate ${record.section} record ${record.key}`);
    sectionRecords.set(record.key, record.lines.join('\n'));
    record = null;
  }
  for (const line of lines) {
    const indent = line.match(/^ */)[0].length;
    if (record) {
      if (!line.trim() || indent > record.indent) {
        record.lines.push(line);
        continue;
      }
      finishRecord();
    }
    if (indent === 0 && /^(importers|packages|snapshots):/.test(line)) section = line.split(':')[0];
    const match =
      section === 'importers'
        ? indent === 6 && line.match(/^\s+['"]?(@ai-matrx\/[^:'"]+)['"]?:/)
        : (section === 'packages' || section === 'snapshots') &&
          indent === 2 &&
          line.match(/^ {2}['"]?(@ai-matrx\/[^:'"]+)['"]?:/);
    if (match) {
      record = { section, key: match[1], indent, lines: [line] };
      continue;
    }
    kept.push(line);
  }
  finishRecord();
  return { rest: kept.join('\n'), records };
}

function resolvedVersion(record) {
  const specifier = record.match(/^\s+specifier:\s*(.+)$/m)?.[1];
  const version = record.match(/^\s+version:\s*(.+)$/m)?.[1];
  if (!specifier || !version) throw new Error('a shared-package importer record is incomplete');
  const semanticVersion = version.match(/^\d+\.\d+\.\d+(?:-[\w.-]+)?/)?.[0];
  if (!semanticVersion) throw new Error('a shared-package importer version is not understood');
  return { specifier, version, semanticVersion };
}

function packageKey(key) {
  const parts = key.match(/^(@ai-matrx\/[^@]+)@([^()]+)(?:\(|$)/);
  if (!parts) throw new Error(`a shared-package key is not understood: ${key}`);
  return { name: parts[1], version: parts[2] };
}

function sameSnapshotAfterVersionMoves(before, after, moved) {
  const oldLines = before.split('\n');
  const newLines = after.split('\n');
  if (oldLines.length !== newLines.length) return false;
  const reference = /^(\s+['"]?)(@ai-matrx\/[^:'"]+)(['"]?:\s*)(\d+\.\d+\.\d+(?:-[\w.-]+)?)(.*)$/;
  return oldLines.every((line, index) => {
    if (line === newLines[index]) return true;
    const oldRef = line.match(reference);
    const newRef = newLines[index].match(reference);
    if (!oldRef || !newRef) return false;
    const versionMove = moved.get(oldRef[2]);
    return Boolean(
      versionMove &&
        oldRef[1] === newRef[1] &&
        oldRef[2] === newRef[2] &&
        oldRef[3] === newRef[3] &&
        oldRef[4] === versionMove.before &&
        newRef[4] === versionMove.after &&
        oldRef[5] === newRef[5],
    );
  });
}

function validVersionRefresh(base, side) {
  if (base.rest !== side.rest)
    throw new Error('the lockfile contains changes outside @ai-matrx records');
  const moved = new Map();
  const beforeImporters = base.records.importers;
  const afterImporters = side.records.importers;
  if (beforeImporters.size !== afterImporters.size)
    throw new Error('shared-package importer set changed');
  for (const [name, before] of beforeImporters) {
    const after = afterImporters.get(name);
    if (!after) throw new Error(`shared-package importer ${name} was removed`);
    const prior = resolvedVersion(before);
    const current = resolvedVersion(after);
    if (
      prior.specifier !== current.specifier ||
      before.replace(/^([ \t]*version:\s*).+$/m, '$1<version>') !==
        after.replace(/^([ \t]*version:\s*).+$/m, '$1<version>')
    ) {
      throw new Error(`shared-package importer ${name} changed beyond its resolved version`);
    }
    if (prior.semanticVersion === current.semanticVersion && prior.version !== current.version) {
      throw new Error(`shared-package importer ${name} changed resolution without a version move`);
    }
    if (prior.semanticVersion !== current.semanticVersion) {
      moved.set(name, { before: prior.semanticVersion, after: current.semanticVersion });
    }
  }
  for (const section of ['packages', 'snapshots']) {
    const beforeRecords = base.records[section];
    const afterRecords = side.records[section];
    for (const [key, prior] of beforeRecords) {
      if (afterRecords.has(key)) {
        const current = afterRecords.get(key);
        if (
          prior !== current &&
          !(section === 'snapshots' && sameSnapshotAfterVersionMoves(prior, current, moved))
        )
          throw new Error(`${section} metadata changed for ${key}`);
      } else {
        const { name, version } = packageKey(key);
        if (moved.get(name)?.before !== version) {
          throw new Error(`${section} removed ${key} without its importer version moving`);
        }
      }
    }
    for (const key of afterRecords.keys()) {
      if (beforeRecords.has(key)) continue;
      const { name, version } = packageKey(key);
      if (moved.get(name)?.after !== version) {
        throw new Error(`${section} added ${key} without its importer version moving`);
      }
    }
  }
}

try {
  const base = git('merge-base', remote, local);
  const manifest = show(base, 'package.json');
  if (show(remote, 'package.json') !== manifest || show(local, 'package.json') !== manifest) {
    throw new Error('a package manifest changed');
  }
  const baseline = lockRecords(show(base, 'pnpm-lock.yaml'));
  validVersionRefresh(baseline, lockRecords(show(remote, 'pnpm-lock.yaml')));
  validVersionRefresh(baseline, lockRecords(show(local, 'pnpm-lock.yaml')));
  const probe = spawnSync('git', [
    'merge-tree',
    '--write-tree',
    '--name-only',
    '-z',
    remote,
    local,
  ]);
  if (probe.status !== 1) throw new Error('the merge is clean or has an unexpected status');
  const parts = probe.stdout.toString('utf8').split('\0');
  const separator = parts.indexOf('', 1);
  const paths = parts.slice(1, separator);
  if (separator < 0 || paths.length !== 1 || paths[0] !== `${PREFIX}pnpm-lock.yaml`) {
    throw new Error(`conflicts include ${paths.join(', ') || 'an unknown path'}`);
  }
  const resolved = spawnSync('git', ['merge-tree', '--write-tree', '-X', 'ours', remote, local], {
    encoding: 'utf8',
  });
  if (resolved.status !== 0 || !/^[0-9a-f]{40,64}$/.test(resolved.stdout.trim())) {
    throw new Error('remote-first merge did not produce a clean tree');
  }
  const tree = resolved.stdout.trim();
  if (show(tree, 'pnpm-lock.yaml') !== show(remote, 'pnpm-lock.yaml')) {
    throw new Error('remote-first merge did not select the remote lock');
  }
  process.stdout.write(`${tree}\n`);
} catch (error) {
  process.stderr.write(`lock reconciliation refused: ${error.message}\n`);
  process.exit(1);
}
