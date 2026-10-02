export type LocalDevBuildReceipt = {
  schema_version: 1;
  kind: 'local_dev_unpacked';
  publish_state: 'not_published';
  observedAt: string;
  extensionDir: string;
  version: string;
  treeSha256: string;
};

export function requireLocalDevReceipt(
  receipt: unknown,
  extensionDir: string,
): LocalDevBuildReceipt;

export function recordLocalDevBuild(input: {
  extensionDir?: string;
  outputPath: string;
}): Promise<LocalDevBuildReceipt>;
