/** Conservative compatibility proof for immutable CI development bytes. */
import { execFileSync, spawnSync } from 'node:child_process';
// WXT bundles src/ plus public assets; these stabilization records are not imported
// by src/ or wxt.config.ts. Keep operational policy and executable files excluded.
// Changes to this promoter or its tests require a new successful CI artifact.
const RUNTIME_EQUIVALENT_PATH =
  /^docs\/stabilization\/(?:runs\/[^/]+\.json|resource-journals\/[^/]+\.jsonl|[^/]+\.(?:md|html|txt)|inventory\.json|(?:defects|reports|evidence)\/(?:[^/]+\/)*[^/]+\.(?:json|jsonl|md|html|txt|log|png|jpg|jpeg|webp))$/;

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

export function sourceCompatibility(root, sourceSha) {
  const mainSha = git(root, 'rev-parse', 'HEAD');
  if (mainSha !== git(root, 'rev-parse', 'origin/main'))
    throw new Error('ci_dev_checkout_not_origin_main');
  const ancestor = spawnSync('git', ['merge-base', '--is-ancestor', sourceSha, mainSha], {
    cwd: root,
  });
  if (ancestor.error || ancestor.status !== 0) throw new Error('ci_dev_source_not_ancestor');
  const diffPaths = execFileSync(
    'git',
    ['diff', '--no-renames', '--name-only', '-z', sourceSha, mainSha],
    {
      cwd: root,
      encoding: 'utf8',
    },
  )
    .split('\0')
    .filter(Boolean);
  const committedPaths = execFileSync(
    'git',
    ['log', '--no-renames', '--format=', '--name-only', '-z', `${sourceSha}..${mainSha}`],
    {
      cwd: root,
      encoding: 'utf8',
    },
  )
    .split('\0')
    .filter(Boolean);
  if ([...diffPaths, ...committedPaths].some((path) => !RUNTIME_EQUIVALENT_PATH.test(path)))
    throw new Error('ci_dev_runtime_source_changed');
  assertCurrentMain(root, mainSha);
  return {
    mainSha,
    compatibility: mainSha === sourceSha ? 'exact-source' : 'runtime-equivalent',
    diffPaths,
  };
}

export function assertCurrentMain(root, mainSha) {
  if (
    git(root, 'rev-parse', 'HEAD') !== mainSha ||
    git(root, 'rev-parse', 'origin/main') !== mainSha
  )
    throw new Error('ci_dev_main_changed_during_promotion');
  // Recheck before staging and committing too: another writer may add pending code.
  const pendingPaths = [
    ['diff', '--no-renames', '--name-only', '-z', 'HEAD'],
    ['ls-files', '--others', '--exclude-standard', '-z'],
  ].flatMap((args) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean),
  );
  if (pendingPaths.some((path) => !RUNTIME_EQUIVALENT_PATH.test(path)))
    throw new Error('ci_dev_pending_runtime_source');
}

// Hosted execution uses a branch ref, so prove the runner's actual immutable
// checkout too. A moved branch must fail before opening the product.
export function requireHostedDevelopmentCheckout(root, artifactSha, checkoutSha) {
  if (!/^[a-f0-9]{40}$/.test(checkoutSha ?? ''))
    throw new Error('HOSTED_DEVELOPMENT_CHECKOUT_INVALID');
  const proof = sourceCompatibility(root, artifactSha);
  if (proof.mainSha !== checkoutSha) throw new Error('HOSTED_DEVELOPMENT_CHECKOUT_INVALID');
  return proof;
}
