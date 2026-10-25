/** Conservative compatibility proof for immutable CI development bytes. */
import { execFileSync, spawnSync } from 'node:child_process';
// WXT bundles src/ plus public assets; these stabilization records are not imported
// by src/ or wxt.config.ts. Keep operational policy and executable files excluded.
// Changes to this promoter or its tests require a new successful CI artifact.
const RUNTIME_EQUIVALENT_PATH =
  /^docs\/stabilization\/(?:runs\/[^/]+\.json|resource-journals\/[^/]+\.jsonl|[^/]+\.(?:md|html|txt)|inventory\.json|(?:defects|reports|evidence)\/(?:[^/]+\/)*[^/]+\.(?:json|jsonl|md|html|txt|log|png|jpg|jpeg|webp))$/;

export function isRuntimeEquivalentDocumentationPath(path) {
  return typeof path === 'string' && RUNTIME_EQUIVALENT_PATH.test(path);
}

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function committedSourceCompatibility(root, sourceSha, checkoutSha) {
  if (![sourceSha, checkoutSha].every((sha) => /^[a-f0-9]{40}$/.test(sha ?? '')))
    throw new Error('ci_dev_source_not_ancestor');
  const ancestor = spawnSync('git', ['merge-base', '--is-ancestor', sourceSha, checkoutSha], {
    cwd: root,
  });
  if (ancestor.error || ancestor.status !== 0) throw new Error('ci_dev_source_not_ancestor');
  const diffPaths = execFileSync(
    'git',
    ['diff', '--no-renames', '--name-only', '-z', sourceSha, checkoutSha],
    {
      cwd: root,
      encoding: 'utf8',
    },
  )
    .split('\0')
    .filter(Boolean);
  const committedPaths = execFileSync(
    'git',
    // Include merge resolutions against their execution parent, while still
    // traversing side-branch commits that may have changed and reverted runtime.
    [
      'log',
      '--diff-merges=first-parent',
      '--no-renames',
      '--format=',
      '--name-only',
      '-z',
      `${sourceSha}..${checkoutSha}`,
    ],
    {
      cwd: root,
      encoding: 'utf8',
    },
  )
    .split('\0')
    .filter(Boolean);
  if ([...diffPaths, ...committedPaths].some((path) => !isRuntimeEquivalentDocumentationPath(path)))
    throw new Error('ci_dev_runtime_source_changed');
  return {
    compatibility: checkoutSha === sourceSha ? 'exact-source' : 'runtime-equivalent',
    diffPaths,
  };
}

/** Current-candidate proof: promotion and dispatch still require synchronized main. */
export function sourceCompatibility(root, sourceSha) {
  const mainSha = git(root, 'rev-parse', 'HEAD');
  if (mainSha !== git(root, 'rev-parse', 'origin/main'))
    throw new Error('ci_dev_checkout_not_origin_main');
  const proof = committedSourceCompatibility(root, sourceSha, mainSha);
  assertCurrentMain(root, mainSha);
  return { mainSha, ...proof };
}

export function assertCurrentMain(root, mainSha) {
  if (
    git(root, 'rev-parse', 'HEAD') !== mainSha ||
    git(root, 'rev-parse', 'origin/main') !== mainSha
  )
    throw new Error('ci_dev_main_changed_during_promotion');
  // Recheck before staging and committing too: another writer may add pending code.
  assertPendingRuntimeInputs(root);
}

function assertPendingRuntimeInputs(root) {
  const pendingPaths = [
    ['diff', '--no-renames', '--name-only', '-z', 'HEAD'],
    ['ls-files', '--others', '--exclude-standard', '-z'],
  ].flatMap((args) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean),
  );
  if (pendingPaths.some((path) => !isRuntimeEquivalentDocumentationPath(path)))
    throw new Error('ci_dev_pending_runtime_source');
}

function frozenSourceCompatibility(root, artifactSha, checkoutSha) {
  const proof = committedSourceCompatibility(root, artifactSha, checkoutSha);
  assertPendingRuntimeInputs(root);
  return {
    artifactSourceSha: artifactSha,
    frozenCheckoutSha: checkoutSha,
    ...proof,
  };
}

/** Immutable historical Git proof; operator HEAD may have advanced since this run. */
export function historicalHostedSourceCompatibility(root, artifactSha, checkoutSha) {
  return {
    purpose: 'historical-hosted-evidence',
    ...frozenSourceCompatibility(root, artifactSha, checkoutSha),
  };
}

/** Live execution additionally proves that this runner is the frozen event checkout. */
export function requireHostedDevelopmentCheckout(root, artifactSha, checkoutSha) {
  const assertCheckout = () => {
    if (!/^[a-f0-9]{40}$/.test(checkoutSha ?? '') || git(root, 'rev-parse', 'HEAD') !== checkoutSha)
      throw new Error('HOSTED_DEVELOPMENT_CHECKOUT_INVALID');
  };
  assertCheckout();
  const proof = frozenSourceCompatibility(root, artifactSha, checkoutSha);
  assertCheckout();
  return { ...proof, purpose: 'hosted-execution' };
}
