/**
 * Known-good extension IDs. Single source of truth for the auth startup
 * check + the Debug-tab identity card.
 *
 * Add a new ID to `EXPECTED_EXTENSION_IDS` whenever a new build channel
 * starts shipping (staging unpacked, beta upload, separate Web Store
 * listing, etc.). Each ID listed here MUST also have its corresponding
 * `https://<id>.chromiumapp.org/` registered in Supabase's redirect-URI
 * allowlist — that is the actual gate.
 */

export const EXPECTED_EXTENSION_IDS = [
  // Local dev — ID derived from the `key` field in wxt.config.ts.
  'cihdmkcdjjckfhjpgoedmgfpoljebaml',
  // Chrome Web Store production — Store-assigned, replaced our manifest `key`
  // on first upload (documented Chrome behavior). Carry forever; the Store
  // never reissues unless we delist + relist as a new item.
  'hnfolienncfklkgmdjjmhhegglimlamg',
] as const;

export type ExpectedExtensionId = (typeof EXPECTED_EXTENSION_IDS)[number];

export function isExpectedExtensionId(id: string): boolean {
  return (EXPECTED_EXTENSION_IDS as readonly string[]).includes(id);
}

export function expectedRedirectUris(): string[] {
  return EXPECTED_EXTENSION_IDS.map((id) => `https://${id}.chromiumapp.org/`);
}
