import { z } from 'zod';
import type { ExtractionMode } from '../types';

export const nextDataConfigSchema = z.object({
  source: z.string().optional(),
  key_path: z.string(),
});
export type NextDataConfig = z.infer<typeof nextDataConfigSchema>;

/**
 * Names of window-bound state blobs we extract via inline-script regex.
 * Update by editing the same list inside both detectInPage and runInPage —
 * those functions cross the chrome.scripting boundary and can't reference
 * outer-scope identifiers.
 *
 * Sites this catches:
 *   - Indeed       → window._initialData
 *   - Reddit       → window.___r (similar pattern)
 *   - Reactjs apps → window.__INITIAL_STATE__ / __PRELOADED_STATE__
 *   - Vue/Nuxt     → window.__INITIAL_DATA__
 *   - Apollo       → window.__APOLLO_STATE__ (also detected separately)
 */
export const nextDataMode: ExtractionMode<NextDataConfig> = {
  id: 'next_data',
  label: 'Framework',
  description:
    'Read embedded framework data (Next.js, Nuxt, Apollo, Indeed _initialData, Redux preloaded state). Pick a key path with the JSON tree to extract rows.',
  configSchema: nextDataConfigSchema,
  defaultConfig: () => ({ key_path: '' }),

  detectInPage: () => {
    const found: { source: string; size: number }[] = [];
    const checkScript = (id: string, node: Element | null) => {
      if (!node?.textContent) return;
      try {
        JSON.parse(node.textContent);
        found.push({ source: id, size: node.textContent.length });
      } catch {
        // skip
      }
    };
    checkScript('__NEXT_DATA__', document.getElementById('__NEXT_DATA__'));
    checkScript('__NUXT_DATA__', document.getElementById('__NUXT_DATA__'));
    checkScript('__APOLLO_STATE__', document.getElementById('__APOLLO_STATE__'));

    // LinkedIn Voyager hydration: <code id="bpr-guid-*"> blocks.
    const bprBlocks = document.querySelectorAll<HTMLElement>('code[id^="bpr-guid-"]');
    if (bprBlocks.length > 0) {
      let total = 0;
      let parsedCount = 0;
      for (const b of Array.from(bprBlocks)) {
        try {
          JSON.parse(b.textContent ?? '');
          parsedCount++;
          total += (b.textContent ?? '').length;
        } catch {
          // skip
        }
      }
      if (parsedCount > 0) {
        found.push({ source: `bpr-guid (LinkedIn) ×${parsedCount}`, size: total });
      }
    }

    // Inline window.* state — paren-balanced scan to handle JS object
    // literals (Indeed, Reddit, etc.) where JSON.parse fails.
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
    for (const name of WINDOW_NAMES) {
      let bestSize = 0;
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
          // Quick paren-balanced length scan.
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
          if (depth === 0) {
            const size = i - start;
            if (size > bestSize) bestSize = size;
          }
        }
      }
      if (bestSize > 0) found.push({ source: `window.${name}`, size: bestSize });
    }

    if (found.length === 0) {
      return { available: false, summary: 'No embedded framework data' };
    }
    const summary = found.map((f) => `${f.source} (${(f.size / 1024).toFixed(1)} KB)`).join(', ');
    return {
      available: true,
      summary,
      count: found.length,
      meta: { sources: found },
    };
  },

  runInPage: (config) => {
    const cfg = config as { source?: string; key_path: string };

    const tryParseScript = (node: Element | null): unknown => {
      if (!node?.textContent) return undefined;
      try {
        return JSON.parse(node.textContent);
      } catch {
        return undefined;
      }
    };

    /**
     * Extract a window-bound state blob from inline scripts. Tries JSON.parse
     * first; falls back to safe-eval (no `function`, `=>`, `eval`, etc.) for
     * sites that ship plain JS object literals (unquoted keys / single quotes).
     */
    const extractWindow = (name: string): unknown | undefined => {
      const escName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const lhsRe = new RegExp(
        `(?:window\\.|self\\.|var\\s+|let\\s+|const\\s+)?${escName}\\s*=\\s*`,
        'g',
      );
      const scripts = Array.from(
        document.querySelectorAll<HTMLScriptElement>('script:not([src])'),
      );
      for (const s of scripts) {
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
          let inLineComment = false;
          let inBlockComment = false;
          while (i < txt.length) {
            const ch = txt[i];
            const next = txt[i + 1];
            if (inLineComment) {
              if (ch === '\n') inLineComment = false;
              i++;
              continue;
            }
            if (inBlockComment) {
              if (ch === '*' && next === '/') {
                inBlockComment = false;
                i += 2;
                continue;
              }
              i++;
              continue;
            }
            if (inStr) {
              if (ch === '\\') {
                i += 2;
                continue;
              }
              if (ch === inStr) inStr = null;
              i++;
              continue;
            }
            if (ch === '/' && next === '/') {
              inLineComment = true;
              i += 2;
              continue;
            }
            if (ch === '/' && next === '*') {
              inBlockComment = true;
              i += 2;
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
          // Try JSON first (strict).
          try {
            return JSON.parse(blob);
          } catch {
            // fall through
          }
          // Sanity check before eval.
          if (
            /\b(?:function\s*[(*]|=>|eval\s*\(|new\s+Function|XMLHttpRequest|fetch\s*\()/.test(
              blob,
            )
          ) {
            continue;
          }
          if (blob.length > 5_000_000) continue;
          try {
            return new Function(`"use strict";return (${blob});`)();
          } catch {
            // try next match
          }
        }
      }
      return undefined;
    };

    const sources: { id: string; data: unknown }[] = [];

    // Script-tag-based sources (always JSON).
    const scriptCandidates: [string, Element | null][] = [
      ['__NEXT_DATA__', document.getElementById('__NEXT_DATA__')],
      ['__NUXT_DATA__', document.getElementById('__NUXT_DATA__')],
      ['apollo', document.getElementById('__APOLLO_STATE__')],
    ];
    for (const [id, node] of scriptCandidates) {
      if (cfg.source && cfg.source !== id) continue;
      const data = tryParseScript(node);
      if (data !== undefined) sources.push({ id, data });
    }

    // LinkedIn bpr-guid (aggregated).
    if (!cfg.source || cfg.source === 'bpr-guid') {
      const blocks = Array.from(document.querySelectorAll<HTMLElement>('code[id^="bpr-guid-"]'));
      const aggregated: Record<string, unknown> = {};
      let included: unknown[] = [];
      for (const b of blocks) {
        try {
          const parsed = JSON.parse(b.textContent ?? '') as Record<string, unknown>;
          aggregated[b.id] = parsed;
          if (Array.isArray(parsed.included)) included = included.concat(parsed.included);
        } catch {
          // skip
        }
      }
      if (Object.keys(aggregated).length > 0) {
        sources.push({ id: 'bpr-guid', data: { blocks: aggregated, included } });
      }
    }

    // window.* assignments (JSON or JS-literal).
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
    for (const name of WINDOW_NAMES) {
      const sourceId = `window.${name}`;
      if (cfg.source && cfg.source !== sourceId) continue;
      // Skip if we already got it from a <script id="..."> form.
      if (name === '__APOLLO_STATE__' && sources.some((s) => s.id === 'apollo')) continue;
      const data = extractWindow(name);
      if (data !== undefined) sources.push({ id: sourceId, data });
    }

    // Resolve which source the user wants (or first available).
    const picked =
      cfg.source != null ? sources.find((s) => s.id === cfg.source) : sources[0];
    if (!picked) return [];

    let target: unknown = picked.data;
    if (cfg.key_path) {
      for (const part of cfg.key_path.split('.')) {
        if (target == null || typeof target !== 'object') break;
        target = (target as Record<string, unknown>)[part];
      }
    }

    if (Array.isArray(target)) return target as Record<string, unknown>[];
    if (target && typeof target === 'object') return [target as Record<string, unknown>];
    if (target != null) return [{ value: target }];
    return [];
  },
};
