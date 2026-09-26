/**
 * Read a Source's original back — for an extension capture, the full
 * `SoupResult` JSON the landing door kept in S3 (gzipped, SOURCE-CONVERGENCE
 * §3.2 step 5). Fetched through the file service's existing read door
 * (`GET /files/{id}/download`, `downloadFileBytes`), never a new endpoint.
 */

import { downloadFileBytes } from '@/lib/api/routes/files';
import type { SoupResult } from '@/lib/scrape/pipeline';

async function gunzipIfNeeded(buffer: ArrayBuffer): Promise<Uint8Array> {
  const bytes = new Uint8Array(buffer);
  // The door stores gzip. `fetch` may already have decoded it (when the file
  // is served with Content-Encoding: gzip), so check the magic number first.
  if (bytes.length < 2 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes;
  const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function isSoupResult(value: unknown): value is SoupResult {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.url === 'string' &&
    row.article !== null &&
    typeof row.article === 'object' &&
    Array.isArray(row.images) &&
    Array.isArray(row.videos) &&
    Array.isArray(row.audio) &&
    Array.isArray(row.links)
  );
}

/** The capture's original SoupResult. Throws a readable sentence when it cannot be read. */
export async function readCaptureOriginal(fileId: string): Promise<SoupResult> {
  let blob: Blob;
  try {
    ({ blob } = await downloadFileBytes(fileId));
  } catch (err) {
    throw new Error(
      `The original page data could not be downloaded (${err instanceof Error ? err.message : String(err)}). The saved text is shown instead.`,
    );
  }
  const bytes = await gunzipIfNeeded(await blob.arrayBuffer());
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error('The original page data is not readable. The saved text is shown instead.');
  }
  if (!isSoupResult(parsed)) {
    throw new Error(
      'The original page data has an unexpected shape. The saved text is shown instead.',
    );
  }
  return parsed;
}
