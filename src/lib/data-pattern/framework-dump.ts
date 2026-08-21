/**
 * Framework-state dump: reads embedded hydration JSON out of the page —
 * __NEXT_DATA__ / __NUXT_DATA__ / Apollo script tags, LinkedIn bpr-guid
 * blocks, and inline `window.* = {...}` assignments whose values are strict
 * JSON. JavaScript object literals are intentionally skipped.
 *
 * Extracted from FrameworkTab so the scanner is unit-testable (audit P1-5 —
 * it was a 140-line inline closure whose failures were invisible).
 *
 * `frameworkDumpInPage` crosses the chrome.scripting boundary via
 * .toString(): it MUST stay self-contained (no imports, no outer-scope
 * refs). It can be exercised directly in jsdom tests because everything it
 * touches is `document` + standard JS.
 */

export type FrameworkDumpSource = { source: string; data: unknown };

export const frameworkDumpInPage = (): FrameworkDumpSource[] => {
  const out: { source: string; data: unknown }[] = [];
  const tryParse = (id: string, node: Element | null) => {
    if (!node?.textContent) return;
    try {
      out.push({ source: id, data: JSON.parse(node.textContent) });
    } catch {
      // skip
    }
  };
  tryParse('__NEXT_DATA__', document.getElementById('__NEXT_DATA__'));
  tryParse('__NUXT_DATA__', document.getElementById('__NUXT_DATA__'));
  tryParse('apollo', document.getElementById('__APOLLO_STATE__'));

  // LinkedIn bpr-guid hydration blocks
  const bprBlocks = Array.from(document.querySelectorAll<HTMLElement>('code[id^="bpr-guid-"]'));
  if (bprBlocks.length > 0) {
    const aggregated: Record<string, unknown> = {};
    let included: unknown[] = [];
    for (const b of bprBlocks) {
      try {
        const p = JSON.parse(b.textContent ?? '') as Record<string, unknown>;
        aggregated[b.id] = p;
        if (Array.isArray(p.included)) included = included.concat(p.included);
      } catch {
        // skip
      }
    }
    if (Object.keys(aggregated).length > 0) {
      out.push({ source: 'bpr-guid', data: { blocks: aggregated, included } });
    }
  }

  // Inline window.* state (Indeed _initialData, Redux preloaded, etc.).
  // The paren-balanced scan finds the candidate value; JSON.parse is the
  // only accepted parser. JavaScript object literals are skipped.
  const WINDOW_NAMES = [
    '_initialData',
    '__INITIAL_STATE__',
    '__INITIAL_DATA__',
    '__PRELOADED_STATE__',
    '__APP_STATE__',
    '__REDUX_STATE__',
    '__APOLLO_STATE__',
    '__SERVER_STATE__',
  ];
  const inlineScripts = Array.from(
    document.querySelectorAll<HTMLScriptElement>('script:not([src])'),
  );
  const extractWindow = (name: string): unknown | undefined => {
    const escName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const lhsRe = new RegExp(
      `(?:window\\.|self\\.|var\\s+|let\\s+|const\\s+)?${escName}\\s*=\\s*`,
      'g',
    );
    for (const s of inlineScripts) {
      const txt = s.textContent ?? '';
      if (!txt.includes(name)) continue;
      lhsRe.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = lhsRe.exec(txt))) {
        const start = m.index + m[0].length;
        const opener = txt[start];
        if (opener !== '{' && opener !== '[') continue;
        let i = start;
        let depth = 0;
        let inStr: string | null = null;
        while (i < txt.length) {
          const ch = txt[i];
          if (inStr) {
            if (ch === '\\') {
              i += 2;
              continue;
            }
            if (ch === inStr) inStr = null;
            i++;
            continue;
          }
          if (ch === '"' || ch === "'" || ch === '`') {
            inStr = ch;
            i++;
            continue;
          }
          if (ch === '{' || ch === '[') depth++;
          else if (ch === '}' || ch === ']') {
            depth--;
            if (depth === 0) {
              i++;
              break;
            }
          }
          i++;
        }
        if (depth !== 0) continue;
        const blob = txt.slice(start, i);
        try {
          return JSON.parse(blob);
        } catch {
          // Window assignments may contain arbitrary JavaScript. Keep the
          // extension CSP-safe and deterministic: accept JSON only; the loop
          // naturally tries the next assignment after this block.
        }
      }
    }
    return undefined;
  };
  for (const name of WINDOW_NAMES) {
    // NOTE: __APOLLO_STATE__ may exist BOTH as a script tag and as a window
    // assignment, and they can differ. Surface both — the UI's source picker
    // disambiguates (previously the window form was silently dropped).
    const data = extractWindow(name);
    if (data !== undefined) out.push({ source: `window.${name}`, data });
  }

  return out;
};
