#!/usr/bin/env node
/** Link and evaluate the installed, published Chat window definitions against its installed siblings.
 * Host typechecking skips dependency JavaScript: chat .175 + summon .15 passed tsc but failed this import.
 * This reads dist from the consumer install, never the aidream workspace source or an export-name regex.
 */
import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parsePnpmLock } from './check-matrx-packages.mjs';

export async function checkChatPackageLink({ packageRoot } = {}) {
  const require = createRequire(import.meta.url);
  const graph = parsePnpmLock(readFileSync(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8'));
  const registryRoot = (name, manifestPath) => {
    const root = dirname(realpathSync(manifestPath));
    // pnpm links into its registry store are valid; links out to an aidream workspace are not artifacts.
    const suffix = `${sep}node_modules${sep}${name.split('/').join(sep)}`;
    if (!root.endsWith(suffix))
      throw new Error(`${name} resolves to a workspace link, not an installed registry artifact`);
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
    const versions = graph.installed.get(name);
    if (manifest.name !== name || versions?.size !== 1 || !versions.has(manifest.version))
      throw new Error(`${name}@${manifest.version} does not match the consumer lock graph`);
    return root;
  };
  const root = registryRoot(
    '@ai-matrx/chat',
    packageRoot
      ? resolve(packageRoot, 'package.json')
      : require.resolve('@ai-matrx/chat/package.json'),
  );
  const chatRequire = createRequire(resolve(root, 'package.json'));
  registryRoot('@ai-matrx/summon', chatRequire.resolve('@ai-matrx/summon/package.json'));
  await import(pathToFileURL(resolve(root, 'dist/window-panels/overlays/chat-overlays.js')).href);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const at = process.argv.indexOf('--package-root');
  try {
    if (at >= 0 && !process.argv[at + 1]) throw new Error('missing --package-root directory');
    await checkChatPackageLink(at >= 0 ? { packageRoot: process.argv[at + 1] } : {});
    console.log('Published Chat windows link against installed sibling packages.');
  } catch (error) {
    console.error(
      `Published Chat package cannot link: ${error instanceof Error ? error.message : 'unknown import failure'}`,
    );
    process.exitCode = 1;
  }
}
