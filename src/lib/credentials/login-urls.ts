/**
 * Destination rules for Vault browser login — ONE implementation, shared by
 * the `credential_login` tool handler and the page-side fill/capture mechanics.
 *
 * Every function here is pure and value-free: it reasons about URLs and about
 * an item's PLAINTEXT `login_urls` metadata. Nothing in this module ever
 * receives, returns, or stores a credential.
 *
 * The server re-runs its own matcher on every `/browser-login/*` call — these
 * helpers exist so the handler, the capture host and the panel's page ability
 * can never disagree about what "safe" means. (The Vault screens' own
 * "covered by this item" hints live in `@ai-matrx/vault`.)
 */

/** Loopback hosts that may be filled over plain http during development. */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

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
