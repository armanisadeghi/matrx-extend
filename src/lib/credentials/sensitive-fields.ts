/**
 * Sensitive-field memory — the extension's OWN record of which page fields it
 * filled with vault plaintext.
 *
 * Why this exists: every page-reading tool used to decide "is this value
 * secret?" by looking at the LIVE DOM (`input.type === 'password'`). That is
 * page-controlled state, and it fails two ways:
 *
 *   1. a filled USERNAME is `type="text"`, so it was echoed verbatim to the
 *      model;
 *   2. a site that toggles "show password" flips the password input to
 *      `type="text"`, un-redacting the password itself.
 *
 * So redaction is now the OR of three independent signals:
 *
 *      marker attribute (`data-matrx-sensitive`, set at fill time)
 *   OR this service-worker-held memory (survives attribute stripping)
 *   OR the legacy live `type === 'password'` check (unchanged)
 *
 * The memory is the only one a hostile page cannot touch. It stores field
 * IDENTITY (CSS selectors) only — never a value. Nothing in this module ever
 * holds, receives, or returns credential plaintext.
 *
 * ── Consumers (keep this list current) ────────────────────────────────────
 *   src/lib/tools/handlers/page-refs.ts   read_page
 *   src/lib/tools/handlers/forms.ts       get_form_fields
 *   src/lib/tools/handlers/read.ts        query_elements
 *   src/lib/tools/handlers/inspect.ts     get_element_at_point,
 *                                         inspect_element,
 *                                         get_element_details
 *
 * `tests/unit/credential-redaction.test.ts` asserts every one of those files
 * still threads the selectors into its injected function — a new page-reading
 * tool that forgets to is a leak, and a grep test is the only thing that can
 * see it (the injected code is a string to `tsc`).
 */

/** Attribute stamped on every field `credential_login` fills. */
export const SENSITIVE_ATTR = 'data-matrx-sensitive';

/** What every redaction site substitutes for a sensitive value. */
export const SENSITIVE_MASK = '***';

/** Cap per tab — a runaway loop must not grow SW memory without bound. */
const MAX_SELECTORS_PER_TAB = 16;

/**
 * tabId → CSS selectors identifying fields we filled with vault plaintext.
 * Service-worker memory only: never persisted to chrome.storage (a credential
 * field identity is not secret, but persisting it invites the pattern of
 * persisting the value beside it).
 */
const BY_TAB = new Map<number, string[]>();

/**
 * Record the identity of fields just filled with credential plaintext. Call
 * BEFORE the fill so a mid-fill failure still leaves the field redacted.
 */
export function rememberSensitiveFields(tabId: number, selectors: readonly string[]): void {
  const existing = BY_TAB.get(tabId) ?? [];
  const merged = [...existing];
  for (const raw of selectors) {
    const sel = raw.trim();
    if (!sel || merged.includes(sel)) continue;
    merged.push(sel);
  }
  BY_TAB.set(tabId, merged.slice(-MAX_SELECTORS_PER_TAB));
}

/**
 * Selectors to hand an injected page-reading function so it can redact by
 * identity. Always safe to call — returns `[]` for an unknown tab.
 */
export function sensitiveSelectorsForTab(tabId: number | null | undefined): string[] {
  if (tabId == null) return [];
  return (BY_TAB.get(tabId) ?? []).slice();
}

/** Drop a tab's memory (tab closed, or the fields were cleared and re-read). */
export function forgetSensitiveFields(tabId: number): void {
  BY_TAB.delete(tabId);
}

/** Test-only reset so suites don't leak state into each other. */
export function _resetSensitiveFieldMemory(): void {
  BY_TAB.clear();
}

// A closed tab can never be read again — drop its entry so the map doesn't
// grow for the life of the service worker.
if (typeof chrome !== 'undefined' && chrome.tabs?.onRemoved?.addListener) {
  chrome.tabs.onRemoved.addListener((tabId: number) => {
    BY_TAB.delete(tabId);
  });
}
