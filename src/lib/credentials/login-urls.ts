/**
 * Destination rules for Vault browser login — ONE implementation, shared by
 * the `credential_login` tool handler and the Vault side panel.
 *
 * Every function here is pure and value-free: it reasons about URLs and about
 * an item's PLAINTEXT `login_urls` metadata. Nothing in this module ever
 * receives, returns, or stores a credential.
 *
 * The server re-runs its own matcher on every `/browser-login/*` call — these
 * helpers exist so the UI can render honestly ("this page is already covered",
 * "this page can't be filled") without a round trip, and so the handler and the
 * panel can never disagree about what "safe" or "covered" means.
 */

/** Loopback hosts that may be filled over plain http during development. */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** URL matching rule for browser fill. Mirrors `uri_match_mode` on the item. */
export type UriMatchMode = 'host' | 'exact' | 'never';

export const URI_MATCH_MODE_LABELS: Record<UriMatchMode, string> = {
  host: 'Any page on this site',
  exact: 'Only this exact URL',
  never: 'Never fill automatically',
};

export function asUriMatchMode(raw: string | null | undefined): UriMatchMode {
  return raw === 'exact' || raw === 'never' ? raw : 'host';
}

/** Parse without throwing. Returns null for anything that isn't a URL. */
export function safeParseUrl(raw: string | null | undefined): URL | null {
  if (!raw) return null;
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

/**
 * HTTPS only, with an explicit carve-out for loopback development. Everything
 * else — http on a real host, file:, chrome:, chrome-extension:, about:,
 * data: — is refused before any vault call is made.
 */
export function isSafeDestination(url: URL): boolean {
  if (url.protocol === 'https:') return true;
  if (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)) return true;
  return false;
}

/** True when this raw URL string is a destination browser fill may target. */
export function isFillablePageUrl(raw: string | null | undefined): boolean {
  const url = safeParseUrl(raw);
  return url !== null && isSafeDestination(url);
}

/**
 * The canonical stored form of a login URL: `origin + pathname`. Query and
 * hash are dropped — they carry session tokens and one-time state that would
 * make an `exact` match never fire again. This is the same normalization the
 * `credential_login` handler sends to `/browser-login/*`.
 */
export function normalizeLoginUrl(raw: string | null | undefined): string | null {
  const url = safeParseUrl(raw);
  if (!url) return null;
  return `${url.origin}${url.pathname}`;
}

/** Display host for an item — the first login URL that parses. */
export function primaryHost(loginUrls: readonly string[]): string | null {
  for (const entry of loginUrls) {
    const url = safeParseUrl(entry);
    if (url) return url.host;
  }
  return null;
}

/** Every distinct host an item lists, in declaration order. */
export function hostsOf(loginUrls: readonly string[]): string[] {
  const seen: string[] = [];
  for (const entry of loginUrls) {
    const url = safeParseUrl(entry);
    if (url && !seen.includes(url.host)) seen.push(url.host);
  }
  return seen;
}

/**
 * Would this item's stored URLs cover `pageUrl` under `mode`?
 *
 * This is a UI hint only — the SERVER decides what actually fills. It is
 * deliberately conservative: `never` covers nothing, `exact` requires the same
 * origin AND path, `host` requires the same host.
 */
export function coversPage(
  loginUrls: readonly string[],
  mode: UriMatchMode,
  pageUrl: string | null | undefined,
): boolean {
  if (mode === 'never') return false;
  const page = safeParseUrl(pageUrl);
  if (!page) return false;
  for (const entry of loginUrls) {
    const stored = safeParseUrl(entry);
    if (!stored) continue;
    if (mode === 'exact') {
      if (stored.origin === page.origin && stored.pathname === page.pathname) return true;
    } else if (stored.host === page.host) {
      return true;
    }
  }
  return false;
}

/**
 * Add `pageUrl` to `loginUrls` in normalized form, without duplicating an
 * entry that is already there. Returns the ORIGINAL array when nothing would
 * change, so a caller can skip a pointless PATCH.
 */
export function withPageAdded(
  loginUrls: readonly string[],
  pageUrl: string | null | undefined,
): string[] {
  const normalized = normalizeLoginUrl(pageUrl);
  const current = [...loginUrls];
  if (!normalized) return current;
  if (current.some((entry) => normalizeLoginUrl(entry) === normalized)) return current;
  current.push(normalized);
  return current;
}

/** A short, human-readable label for a stored login URL. */
export function loginUrlLabel(raw: string): string {
  const url = safeParseUrl(raw);
  if (!url) return raw;
  return url.pathname && url.pathname !== '/' ? `${url.host}${url.pathname}` : url.host;
}
