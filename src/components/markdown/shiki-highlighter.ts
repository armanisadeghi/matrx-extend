/**
 * Lazy Shiki highlighter calibrated for the side panel + Chrome-extension CSP.
 *
 * Why the JavaScript regex engine: the manifest CSP is `script-src 'self'`
 * with no `wasm-unsafe-eval`, so the default Oniguruma WASM engine is blocked.
 * The JS engine is a tiny bit slower but works under strict CSP.
 *
 * Highlighter is a singleton — created on first request, then reused. Languages
 * are loaded on demand via `highlight()` so we don't pay for grammars no one
 * has typed code in yet.
 */

import {
  type BundledLanguage,
  type BundledTheme,
  type Highlighter,
  bundledLanguages,
  createHighlighter,
} from 'shiki/bundle/web';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';

const THEMES: BundledTheme[] = ['github-dark', 'github-light'];

const INITIAL_LANGS: BundledLanguage[] = [
  'javascript',
  'typescript',
  'tsx',
  'jsx',
  'json',
  'bash',
  'shell',
  'html',
  'css',
  'markdown',
  'python',
  'sql',
  'yaml',
];

let highlighterPromise: Promise<Highlighter> | null = null;

export function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: THEMES,
      langs: INITIAL_LANGS,
      engine: createJavaScriptRegexEngine(),
    });
  }
  return highlighterPromise;
}

const LANG_ALIAS: Record<string, BundledLanguage> = {
  js: 'javascript',
  ts: 'typescript',
  py: 'python',
  sh: 'shell',
  zsh: 'shell',
  yml: 'yaml',
  md: 'markdown',
};

function resolveLang(lang: string): BundledLanguage | null {
  if (!lang) return null;
  const lower = lang.toLowerCase();
  const aliased = LANG_ALIAS[lower] ?? lower;
  return aliased in bundledLanguages ? (aliased as BundledLanguage) : null;
}

/**
 * Highlights `code` for the given language and theme. Falls back to plain
 * text rendering when the language is unknown — caller still gets safe HTML.
 */
export async function highlightToHtml(
  code: string,
  lang: string,
  theme: 'dark' | 'light',
): Promise<string> {
  const hl = await getHighlighter();
  const themeName: BundledTheme = theme === 'dark' ? 'github-dark' : 'github-light';
  const resolved = resolveLang(lang);
  if (resolved && !hl.getLoadedLanguages().includes(resolved)) {
    try {
      await hl.loadLanguage(resolved);
    } catch {
      return hl.codeToHtml(code, { lang: 'text', theme: themeName });
    }
  }
  return hl.codeToHtml(code, { lang: resolved ?? 'text', theme: themeName });
}
