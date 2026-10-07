import assert from 'node:assert/strict';
import { hashReleaseTree } from './sync-unpacked-release.mjs';

/** Verify the immutable artifact against its receipt, independent of caller checkout version. */
export function verifyFrozenArtifactIdentity({ extensionDir, manifest, receipt }) {
  assert.equal(manifest.version, receipt.version, 'artifact_manifest_version_mismatch');
  assert.equal(hashReleaseTree(extensionDir), receipt.treeSha256, 'artifact_tree_mismatch');
  return { version: receipt.version, treeSha256: receipt.treeSha256 };
}
