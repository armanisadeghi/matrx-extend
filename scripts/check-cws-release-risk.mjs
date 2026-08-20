import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const baselinePath = path.join(root, 'config/chrome-web-store-approved-baseline.json');
const manifestPath = path.join(root, '.output/chrome-mv3/manifest.json');

const baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

const selectPolicySurface = (value) => ({
  name: value.name,
  short_name: value.short_name,
  description: value.description,
  permissions: value.permissions ?? [],
  optional_permissions: value.optional_permissions ?? [],
  host_permissions: value.host_permissions ?? [],
  side_panel: value.side_panel,
  background: value.background,
  action: value.action == null ? undefined : { default_title: value.action.default_title },
  externally_connectable: value.externally_connectable,
  web_accessible_resources: value.web_accessible_resources ?? [],
  content_scripts: value.content_scripts ?? [],
});

const stable = (value) => JSON.stringify(value, null, 2);
const expected = stable(baseline.policySurface);
const actual = stable(selectPolicySurface(manifest));

const failures = [];
if (expected !== actual) {
  failures.push(
    `The manifest policy surface differs from the version ${baseline.publishedVersion} Google approved.`,
  );
}

if (manifest.key != null) failures.push('The Store manifest contains a development key.');
if (manifest.action?.default_popup != null) failures.push('The Store manifest adds a toolbar popup.');

const forbiddenRuntimeTokens = [
  'eval(',
  'new Function',
  'Runtime.evaluate',
  'Runtime.callFunctionOn',
  'Runtime.compileScript',
];

const walk = async (directory) => {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(absolute)));
    else files.push(absolute);
  }
  return files;
};

const emittedFiles = await walk(path.join(root, '.output/chrome-mv3'));
for (const file of emittedFiles.filter((candidate) => candidate.endsWith('.js'))) {
  const source = await readFile(file, 'utf8');
  for (const token of forbiddenRuntimeTokens) {
    if (source.includes(token)) failures.push(`${path.relative(root, file)} contains ${token}.`);
  }
}

if (failures.length > 0) {
  console.error('\nChrome Web Store approval-risk gate: REVIEW REQUIRED\n');
  for (const failure of failures) console.error(`- ${failure}`);
  console.error(
    '\nDo not upload this package yet. Review the change against the Store listing, privacy disclosures, single-purpose statement, reviewer instructions, screenshots, and Google policy. Update the approved baseline only after the changed surface is published by Google.',
  );
  process.exit(1);
}

console.log(
  `Chrome Web Store approval-risk gate passed: manifest policy surface matches published ${baseline.publishedVersion}; emitted code contains no forbidden runtime-code path.`,
);
