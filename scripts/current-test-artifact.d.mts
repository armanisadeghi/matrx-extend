export type GitHubRunMetadata = {
  id: number;
  repository: { full_name: string };
  head_repository: { full_name: string };
  workflow_id: number;
  path: string;
  event: string;
  head_branch: string;
  status: string;
  conclusion: string;
  head_sha: string;
  run_attempt: number;
};

export type GitHubArtifactMetadata = {
  id: number;
  name: string;
  expired: boolean;
  digest: string;
  workflow_run: { id: number; head_sha: string };
};

export type CiBuildProvenance = {
  schema_version: 1;
  kind: 'ci_development_test';
  eligibleStore: false;
  publish_state: 'not_published';
  repository: string;
  workflow: string;
  event: string;
  ref: string;
  sourceSha: string;
  runId: number;
  runAttempt: number;
  version: string;
  expectedExtensionId: string;
  treeSha256: string;
};

export function verifyGitHubMetadata(
  run: unknown,
  workflow: unknown,
  artifact: unknown,
  runId: string,
  artifactId: string,
): string;

export function verifyDownloadedTree(
  build: string,
  receipt: unknown,
  provenance: unknown,
  run: GitHubRunMetadata,
  version: string,
): Promise<void>;

export type ImportedNativeEvidence = {
  schema_version: 1;
  kind: 'ci_development_test';
  eligibleStore: false;
  publish_state: 'not_published';
  repository: string;
  workflow: string;
  sourceSha: string;
  runId: number;
  runAttempt: number;
  artifactId: number;
  githubArtifactDigest: string;
  treeSha256: string;
  source: {
    originMain: string;
    localHead: string;
    trackedDirty: boolean;
    untrackedRunnerInputs: string[];
    claim: 'current_pushed_source' | 'exact_pushed_commit_only';
  };
};

export function verifyImportedNativeEvidence(
  extensionDir: string,
  localReceiptPath: string,
): Promise<ImportedNativeEvidence>;

export function reserveImportTarget(sha: string, runId: number, attempt: number): Promise<string>;

export function withReservedImportTarget(
  sha: string,
  runId: number,
  attempt: number,
  writeImport: (target: string) => Promise<void>,
): Promise<string>;

export function selectOrImportNativeTarget(
  sourceRoot: string,
  runId: string,
  artifactId: string,
  importMissing: () => Promise<void>,
): Promise<{ target: string; sourceSha: string }>;
