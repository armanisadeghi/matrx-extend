/**
 * base64.ts — the DECODED byte length of base64 text.
 *
 * ⚠️ THIS IS A CENSUSED TWIN, NOT A HOME (2026-09-12). The capability lives in
 * `@ai-matrx/kit/base64` as `base64ByteLength`, added in the same session that
 * wrote this file. This extension resolves `@ai-matrx/kit` from the npm
 * registry at `latest`, which is still 0.13.4 — the subpath does not exist
 * there yet — so importing the package here fails `tsc` today. The moment kit
 * 0.13.5 publishes, delete this file and import from
 * `@ai-matrx/kit/base64`; `scripts/package-twins.json` carries a `census`
 * entry for `base64ByteLength` that FAILS as stale the second that happens.
 *
 * WHY IT IS ONE FILE AND NOT THREE INLINE EXPRESSIONS. Three call sites here
 * had written the arithmetic three ways, and one of them
 * (`tools/handlers/read.ts`, feeding `size_bytes`) never got the padding fix
 * two earlier rounds applied to its siblings — the instance-not-class miss a
 * seventh adversarial review caught. One definition per repo is the most this
 * repo can honestly have until the package import works.
 *
 * `b64.length * 3 / 4` OVERSTATES every padded payload by one or two bytes:
 * four base64 characters carry three bytes, and a trailing `=` / `==` is
 * exactly the bytes that were never there. Whitespace (a wrapped data URL) is
 * not base64 data either, so it never counts toward the decoded size.
 */
export function base64ByteLength(b64: string | null | undefined): number {
  if (!b64) return 0;
  const clean = b64.replace(/\s+/g, '');
  if (clean.length === 0) return 0;
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((clean.length * 3) / 4) - padding);
}
