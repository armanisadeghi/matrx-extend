/**
 * The page identity a Source is addressed by — the SAME rule the server's
 * landing door applies (`matrx_scraper.canonical.canonical_url`, aidream).
 *
 * The door canonicalizes whatever the client sends, so the extension does not
 * need this to SAVE. It needs it to READ: recognition ("you captured this
 * page"), `PAGE_ALREADY_CAPTURED` and `prior_capture` look a Source up by
 * `docproc.processed_documents.canonical_identity`, and a lookup keyed any
 * other way silently misses every capture it should find.
 *
 * Deliberately conservative, like the server: the fragment and a trailing
 * slash on a path only. Query parameters are identity on many sites.
 *
 * Pinned to the server's outputs by `canonical.test.ts` (fixtures generated
 * from `matrx_scraper.canonical`); change both together or neither.
 */
export function canonicalUrl(url: string): string {
  let cleaned = (url ?? '').trim();
  cleaned = cleaned.split('#', 1)[0] ?? '';
  if (cleaned.endsWith('/') && (cleaned.match(/\//g)?.length ?? 0) > 3) {
    cleaned = cleaned.slice(0, -1);
  }
  return cleaned;
}
