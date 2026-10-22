/** Cheap JSON peeking for the code-block registry (markdown itself is parsed by @ai-matrx/rich-content). */

/**
 * Pulls the first key of a JSON object out of a string without fully parsing.
 * Returns null for arrays, primitives, or malformed input.
 */
export function firstJsonKey(raw: string): string | null {
  let i = 0;
  while (i < raw.length && /\s/.test(raw[i] ?? '')) i++;
  if (raw[i] !== '{') return null;
  i++;
  while (i < raw.length && /\s/.test(raw[i] ?? '')) i++;
  if (raw[i] !== '"') return null;
  i++;
  let key = '';
  while (i < raw.length && raw[i] !== '"') {
    const ch = raw[i];
    if (ch === undefined) break;
    if (ch === '\\' && i + 1 < raw.length) {
      key += raw[i + 1] ?? '';
      i += 2;
      continue;
    }
    key += ch;
    i++;
  }
  return key.length > 0 ? key : null;
}
