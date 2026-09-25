/**
 * THE TWO LISTS THAT MUST NEVER DRIFT: the manifest's `externally_connectable`
 * matches and `src/lib/origin-allowlist.ts`.
 *
 * ## The defect this closes
 *
 * matrx-frontend gives every agent session its own dev server at
 * `<session>.localhost` so the sessions do not share one cookie jar (its
 * `next.config.js`: `allowedDevOrigins: ["127.0.0.1", "0.0.0.0", "*.localhost"]`).
 * The manifest allowed only the bare `localhost`, and a host glob matches
 * LABELS, not the bare name — so on `acquisition-frontier.localhost:3001`
 * Chrome never injected the bridge and `chrome.runtime.sendMessage` was simply
 * `undefined`. The web app could not detect the extension at all: every button
 * that needs it read "Add the extension", for a browser that had it installed.
 *
 * A cold walk found it on 2026-09-19 — on the exact host this project's own
 * preview convention runs on, which is to say the hand-off could not be walked
 * end to end by anyone following the convention.
 *
 * ## Why a guard and not just the fix
 *
 * The failure is invisible from inside either repo. The manifest looks
 * complete, the runtime list looks complete, and nothing connects them to what
 * the web app is actually served from. So this test holds all three together:
 * a named table of the origins the web app really uses, the runtime rule, and
 * the platform gate — which must be a SUPERSET of the rule, because a message
 * Chrome never delivers cannot be refused by us with a sentence.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { ALLOWED_ORIGIN_PATTERNS, matchesAllowedOrigin } from '@/lib/origin-allowlist';

/**
 * The local unpacked manifest's matches, read out of `wxt.config.ts` as text.
 *
 * Deliberately NOT imported: `wxt.config.ts` pulls in the whole WXT and
 * Tailwind build toolchain, and a guard that can fail because a bundler plugin
 * moved is a guard nobody trusts. The block is unambiguous and the parse
 * throws rather than silently matching nothing.
 */
function manifestExternallyConnectableMatches(): string[] {
  const source = readFileSync(resolve(__dirname, '../../wxt.config.ts'), 'utf8');
  // The local-only host is conditionally spread from a nested array. Stop at
  // the matches property's closing bracket, not that nested array's bracket.
  const block = source.match(
    /externally_connectable:\s*\{\s*matches:\s*\[([\s\S]*?)\n\s*\],\s*\n\s*\}/,
  );
  if (!block?.[1]) {
    throw new Error('externally_connectable.matches not found in wxt.config.ts');
  }
  const found = [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1] as string);
  if (found.length === 0) throw new Error('externally_connectable.matches parsed empty');
  return found;
}

/**
 * Chrome's match-pattern rule for the host, modelled explicitly because it is
 * NOT the same as our runtime matcher's: Chrome's `*.example.com` matches
 * `example.com` itself as well as any subdomain, and a bare host pattern with
 * no port matches ANY port. Getting this wrong in either direction is how the
 * two lists drift apart without anybody noticing.
 */
function chromeMatches(pattern: string, url: string): boolean {
  const m = pattern.match(/^([a-z*]+):\/\/([^/]+)(\/.*)$/i);
  if (!m?.[1] || !m[2]) throw new Error(`not a match pattern: ${pattern}`);
  const [, scheme, host] = m;
  const target = new URL(url);
  const targetScheme = target.protocol.replace(/:$/, '');
  if (scheme !== '*' && scheme !== targetScheme) return false;
  if (host === '*') return true;
  if (host.startsWith('*.')) {
    const bare = host.slice(2);
    return target.hostname === bare || target.hostname.endsWith(`.${bare}`);
  }
  return target.hostname === host;
}

/**
 * Where the web app is actually served from. Each line carries its provenance,
 * because a list of hostnames with no source is a list nobody dares change.
 */
const WEB_APP_ORIGINS: ReadonlyArray<{ url: string; why: string }> = [
  { url: 'https://www.aimatrx.com/capture/needs-you', why: 'NEXT_PUBLIC_SITE_URL in production' },
  { url: 'https://aimatrx.com/capture/needs-you', why: 'the apex, served by the same app' },
  { url: 'https://app.aimatrx.com/capture/needs-you', why: 'the app subdomain' },
  { url: 'https://manage.aimatrx.com/administration', why: 'the admin subdomain' },
  { url: 'https://demos.aimatrx.com/demos/tests/extension-bridge', why: 'the bridge harness page' },
  {
    url: 'http://acquisition-frontier.localhost:3001/capture/needs-you',
    why: 'THE DEFECT: the per-session preview host convention (next.config.js allowedDevOrigins)',
  },
  {
    url: 'http://some-other-session.localhost:3005/capture/needs-you',
    why: 'any other agent session, same convention',
  },
  { url: 'http://localhost:3000/capture/needs-you', why: 'a plain local dev server' },
  { url: 'http://127.0.0.1:3000/capture/needs-you', why: 'the same by address' },
];

describe('the web app can always reach this extension', () => {
  it.each(WEB_APP_ORIGINS)('Chrome delivers from $url ($why)', ({ url }) => {
    const matches = manifestExternallyConnectableMatches();
    expect(
      matches.some((p) => chromeMatches(p, url)),
      `no externally_connectable pattern covers ${url} — Chrome will not even deliver the message, so chrome.runtime.sendMessage is undefined on that page`,
    ).toBe(true);
  });

  it.each(WEB_APP_ORIGINS)('and we accept it at runtime: $url', ({ url }) => {
    expect(matchesAllowedOrigin(url)).toBe(true);
  });

  it('the manifest is a SUPERSET of the runtime rule, never the other way round', () => {
    const matches = manifestExternallyConnectableMatches();
    // One concrete origin per runtime pattern — a pattern proves nothing about
    // another pattern, only about a URL both are asked to judge.
    const samples = ALLOWED_ORIGIN_PATTERNS.map((p) =>
      p
        .replace('/*', '/probe')
        .replace('://*.', '://sample.')
        .replace(':*/', ':4321/')
        .replace(/\*/g, 'sample'),
    );
    for (const url of samples) {
      expect(matchesAllowedOrigin(url), `runtime rule rejects its own pattern's url ${url}`).toBe(
        true,
      );
      expect(
        matches.some((p) => chromeMatches(p, url)),
        `the runtime rule accepts ${url} but the manifest never delivers it — a rule that can only ever refuse`,
      ).toBe(true);
    }
  });

  it('still refuses an origin that is nobody’s', () => {
    for (const url of [
      'https://aimatrx.com.evil.test/x',
      'http://notlocalhost/x',
      'https://mymatrx.com.attacker.example/x',
    ]) {
      expect(matchesAllowedOrigin(url), `runtime rule wrongly accepts ${url}`).toBe(false);
    }
  });
});
