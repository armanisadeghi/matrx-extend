/**
 * Known-good extension IDs. Single source of truth for the auth startup
 * check + the Debug-tab identity card.
 *
 * Add a new record whenever a build channel starts shipping (staging
 * unpacked, beta upload, separate Store listing, etc.). Its exact callback
 * URI belongs with its stable runtime ID so the diagnostics never guess a
 * Chromium callback for a non-Chromium runtime.
 */

export const FIREFOX_GECKO_ID = 'matrx-extend@aimatrx.com';

export const EXPECTED_EXTENSION_IDENTITIES = {
  // Local dev — ID derived from the `key` field in wxt.config.ts.
  cihdmkcdjjckfhjpgoedmgfpoljebaml: {
    redirect_uri: 'https://cihdmkcdjjckfhjpgoedmgfpoljebaml.chromiumapp.org/',
  },
  // Chrome Web Store production — Store-assigned, replaced our manifest `key`
  // on first upload (documented Chrome behavior). Carry forever; the Store
  // never reissues unless we delist + relist as a new item.
  hnfolienncfklkgmdjjmhhegglimlamg: {
    redirect_uri: 'https://hnfolienncfklkgmdjjmhhegglimlamg.chromiumapp.org/',
  },
  // Firefox derives its callback from the stable Gecko application ID.
  [FIREFOX_GECKO_ID]: {
    redirect_uri: 'https://73e3f15e331d0e9b5e3e05495f4d29e37690cbad.extensions.allizom.org/',
  },
} as const;

export type ExpectedExtensionId = keyof typeof EXPECTED_EXTENSION_IDENTITIES;

export const EXPECTED_EXTENSION_IDS = Object.keys(
  EXPECTED_EXTENSION_IDENTITIES,
) as ExpectedExtensionId[];

export function getExpectedExtensionIdentity(id: string) {
  return Object.prototype.hasOwnProperty.call(EXPECTED_EXTENSION_IDENTITIES, id)
    ? EXPECTED_EXTENSION_IDENTITIES[id as ExpectedExtensionId]
    : undefined;
}

export function isExpectedExtensionId(id: string): boolean {
  return getExpectedExtensionIdentity(id) !== undefined;
}

export function expectedRedirectUris(): string[] {
  return Object.values(EXPECTED_EXTENSION_IDENTITIES).map(({ redirect_uri }) => redirect_uri);
}
