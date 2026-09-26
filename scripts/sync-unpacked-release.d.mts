export type Promotion = {
  source: string;
  destination: string;
  sourceHash: string;
  destinationHash: string;
  fileCount: number;
  destinations?: string[];
};

export function hashReleaseTree(dir: string): string;
export function promoteUnpackedRelease(input: {
  sourceDir: string;
  destinationDir: string;
  version: string;
}): Promotion;
export function promoteUnpackedReleaseToMany(input: {
  sourceDir: string;
  destinationDirs: string[];
  version: string;
  beforeCommit?: (promotion: Promotion & { destinations: string[] }) => unknown;
}): Promotion & { destinations: string[] };
export function writeReleaseReceipt(input: {
  receiptPath: string;
  sourceSha: string;
  version: string;
  storeZip: string;
  localZip: string;
  promotion: Promotion;
  publishState: string;
}): Record<string, unknown>;
