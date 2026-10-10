export function sanitizeHostedResourceJournal(source: string, runId: string): string;

export function copyHostedResourceJournal(options: {
  runId: string;
  sourcePath: string;
  outputPath: string;
}): Promise<string>;
