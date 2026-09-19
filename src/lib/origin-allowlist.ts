/**
 * Origin allowlist for WebMCP page-side wiring.
 *
 * The WebMCP bridge content script is permitted to register matrx-extend
 * tools on a page only when the page's origin matches one of these
 * patterns. Both the content script (sender validation) and the SW
 * (tab-update gate that triggers `registerToolsOnActiveTab`) consult the
 * same list, so adding an origin here is a single-edit change.
 *
 * Phase 2 will reuse this list for the manifest's `externally_connectable`
 * matches; the patterns therefore use the same wildcard shape Chrome
 * accepts there (host glob, path always `/*`).
 */

export const ALLOWED_ORIGIN_PATTERNS: readonly string[] = [
  'https://*.aimatrx.com/*',
  'https://aimatrx.com/*',
  'https://*.mymatrx.com/*',
  'https://mymatrx.com/*',
  'https://*-armani-sadeghis-projects.vercel.app/*',
  'http://localhost/*',
  'http://localhost:*/*',
  // 🚨 EVERY per-session preview host. matrx-frontend runs each agent's dev
  // server at its own `<session>.localhost` label so the sessions do not share
  // one cookie jar (its next.config.js `allowedDevOrigins: ["*.localhost"]`).
  // Without these two lines `chrome.runtime.sendMessage` is simply UNDEFINED on
  // `acquisition-frontier.localhost:3001`, so the web app cannot see the
  // extension at all and every button that needs it reads "Add the extension"
  // — which is how a cold walk on 2026-09-19 found the hand-off untestable on
  // the very host the whole preview convention runs on. `http://localhost/*`
  // does NOT cover them: a host glob matches labels, not the bare name.
  'http://*.localhost/*',
  'http://*.localhost:*/*',
  'http://127.0.0.1/*',
  'http://127.0.0.1:*/*',
] as const;

interface ParsedPattern {
  protocol: string;
  hostRegex: RegExp;
  portMatcher: 'any' | 'none' | string;
}

const parsedPatterns: ParsedPattern[] = ALLOWED_ORIGIN_PATTERNS.map(parsePattern);

function parsePattern(pattern: string): ParsedPattern {
  // Strip the trailing path glob — we only care about origin matching.
  const noPath = pattern.replace(/\/\*$/, '').replace(/\/$/, '');
  const m = noPath.match(/^([a-z]+):\/\/([^/]+)$/i);
  if (!m || !m[1] || !m[2]) {
    throw new Error(`Invalid origin pattern: ${pattern}`);
  }
  const protocol = m[1];
  const authority = m[2];

  // Split host:port if a port is present. The wildcard `*` is allowed for
  // both the host (subdomain glob) and the port (any port).
  let host = authority;
  let portMatcher: 'any' | 'none' | string = 'none';
  const lastColon = authority.lastIndexOf(':');
  if (lastColon > 0 && /^[*\d]+$/.test(authority.slice(lastColon + 1))) {
    host = authority.slice(0, lastColon);
    const portPart = authority.slice(lastColon + 1);
    portMatcher = portPart === '*' ? 'any' : portPart;
  }

  // Convert host glob to a regex.
  //   `*.example.com` matches any subdomain (including multi-level), but
  //   does NOT match the bare domain. To match both, list both patterns.
  //   `*-foo.bar.com` matches any prefix ending with `-foo`.
  const hostRegex = new RegExp(
    `^${host
      .split('')
      .map((c) => {
        if (c === '*') return '[^.]+(?:\\.[^.]+)*';
        if (/[a-z0-9]/i.test(c)) return c;
        if (c === '.' || c === '-') return `\\${c}`;
        // Reject unexpected chars defensively.
        return c.replace(/[\\^$.|?*+()[\]{}]/g, '\\$&');
      })
      .join('')}$`,
    'i',
  );

  return { protocol: protocol.toLowerCase(), hostRegex, portMatcher };
}

export function matchesAllowedOrigin(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const protocol = parsed.protocol.replace(/:$/, '').toLowerCase();
  const hostname = parsed.hostname;
  const port = parsed.port; // empty string when default

  for (const p of parsedPatterns) {
    if (p.protocol !== protocol) continue;
    if (!p.hostRegex.test(hostname)) continue;
    if (p.portMatcher === 'none') {
      if (port !== '') continue;
    } else if (p.portMatcher === 'any') {
      // any port (including default) is fine
    } else if (p.portMatcher !== port) {
      continue;
    }
    return true;
  }
  return false;
}
