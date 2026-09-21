/**
 * Browser identity + capability matrix.
 *
 * Single source of truth for "which browser are we running in?" and "what
 * APIs does that browser expose?". Every per-browser branch in the codebase
 * (UI surface choice, streaming strategy, manifest builder, tool registry
 * gate, release pipeline) reads from this module so the per-browser
 * decisions stay in one auditable place.
 *
 * The `BROWSER` constant is set at *build* time by WXT via
 * `import.meta.env.BROWSER`. WXT statically replaces the expression with
 * the literal browser name, so dead branches (e.g. Chrome-only code in a
 * Safari build) are tree-shaken. Read-once, do not mutate.
 *
 * The `BROWSER_FEATURES` matrix is hand-maintained. If you add a per-browser
 * branch elsewhere in the codebase, add the corresponding capability flag
 * here first — that keeps the matrix complete and the auto-generated
 * `docs/browser-feature-matrix.md` accurate.
 *
 * Background: WXT defaults Safari + Firefox builds to MV2. Firefox commands
 * explicitly request MV3, while the current Safari manifest command
 * (`pnpm build:safari`) intentionally retains MV2 at `.output/safari-mv2/`.
 * Safari therefore uses its MV2 background-page lifecycle rather than the
 * MV3 service-worker lifecycle.
 *   See node_modules/wxt/dist/core/resolve-config.mjs:45 for the WXT
 *   default; Firefox's MV3 commands are in package.json.
 */

import { ALL_BROWSERS, type BrowserSet, type SupportedBrowser } from '@/lib/browser/types';

/**
 * The browser this build targets. Static at build time.
 *
 * WXT replaces `import.meta.env.BROWSER` with a string literal during the
 * Vite build, so this expression compiles down to e.g. `'chrome'`. That
 * means subsequent `if (BROWSER === 'safari')` branches tree-shake cleanly.
 *
 * Falls back to `'chrome'` only when run outside the Vite pipeline (tests,
 * scripts) — those contexts shouldn't be making per-browser decisions anyway.
 */
export const BROWSER: SupportedBrowser = ((): SupportedBrowser => {
  const value = (import.meta as unknown as { env?: { BROWSER?: string } })?.env?.BROWSER;
  if (value === 'firefox' || value === 'safari') return value;
  return 'chrome';
})();

/**
 * Capability flags per browser. Hand-maintained, not feature-detected.
 *
 * Hand-maintained because:
 *   1. Some checks would require touching APIs that don't exist (would throw).
 *   2. Build-time constants tree-shake; runtime detection doesn't.
 *   3. We want one auditable matrix, not 30 scattered `typeof chrome.X`
 *      checks.
 *
 * When a browser ships a new capability (Safari finally gets sidePanel,
 * Firefox finally gets offscreen, etc.), flip the bit here and any per-tool
 * `supportedBrowsers` declaration. The auto-generated feature matrix doc
 * picks up the change automatically.
 */
export interface BrowserCapabilities {
  /**
   * How `chrome.storage.session` is kept out of content scripts.
   *
   * Chromium and Safari require an explicit `setAccessLevel(TRUSTED_CONTEXTS)`
   * call. Firefox's bundled session storage is already trusted-context-only
   * and does not implement that setter.
   */
  hasNativeTrustedSessionStorage: boolean;
  /** Has `chrome.sidePanel` — the side-panel UI surface. */
  hasSidePanel: boolean;
  /** Has `chrome.offscreen` — long-running background documents. */
  hasOffscreen: boolean;
  /** Has `chrome.debugger` — the Chrome DevTools Protocol attach point. */
  hasDebugger: boolean;
  /** Has `chrome.tabGroups` — UI tab grouping. */
  hasTabGroups: boolean;
  /** Has `chrome.pageCapture` — MHTML save. */
  hasPageCapture: boolean;
  /** Has `chrome.runtime.connectNative` — stdio native messaging hosts. */
  hasNativeMessaging: boolean;
  /**
   * Has on-device LLM APIs (Gemini Nano via `LanguageModel` / `window.ai`).
   * Currently Chrome-only (origin-trial flag); Safari has Apple Foundation
   * Models but doesn't expose them to extensions yet.
   */
  hasOnDeviceAI: boolean;
  /** Has `chrome.sessions` — recently-closed tabs. */
  hasSessions: boolean;
  /** Has `chrome.identity.launchWebAuthFlow` — OAuth helper. */
  hasIdentityWebAuthFlow: boolean;
  /** Has `chrome.contextMenus`. */
  hasContextMenus: boolean;
  /** Has `chrome.tabs.captureVisibleTab` (the cheap screenshot path). */
  hasCaptureVisibleTab: boolean;
  /** Has `chrome.windows.create({ type: 'popup' })` for primary surface. */
  hasWindowsCreate: boolean;
}

const CHROME: BrowserCapabilities = {
  hasNativeTrustedSessionStorage: false,
  hasSidePanel: true,
  hasOffscreen: true,
  hasDebugger: true,
  hasTabGroups: true,
  hasPageCapture: true,
  hasNativeMessaging: true,
  hasOnDeviceAI: true,
  hasSessions: true,
  hasIdentityWebAuthFlow: true,
  hasContextMenus: true,
  hasCaptureVisibleTab: true,
  hasWindowsCreate: true,
};

const FIREFOX: BrowserCapabilities = {
  hasNativeTrustedSessionStorage: true,
  hasSidePanel: true, // sidebar_action; WXT polyfills the manifest field
  hasOffscreen: false, // critical: streams must move to a UI-surface host on FF
  hasDebugger: false,
  hasTabGroups: false,
  hasPageCapture: false,
  hasNativeMessaging: true, // stdio-based, host JSON manifest
  hasOnDeviceAI: false,
  hasSessions: true,
  hasIdentityWebAuthFlow: true,
  hasContextMenus: true,
  hasCaptureVisibleTab: true,
  hasWindowsCreate: true,
};

const SAFARI: BrowserCapabilities = {
  hasNativeTrustedSessionStorage: false,
  hasSidePanel: false, // Safari has no sidepanel API; popup-as-primary instead
  hasOffscreen: false, // streams hosted in popup surface
  hasDebugger: false,
  hasTabGroups: false,
  hasPageCapture: false,
  // Safari's native-messaging model is XPC inside the wrapper .app, not
  // stdio. The same `connectNative` shape exists but the host bundling is
  // entirely different — see Appendix A in the Safari port plan. Treated
  // as unavailable for v1; the Safari Native XPC Bridge follow-up project
  // flips this to true.
  hasNativeMessaging: false,
  hasOnDeviceAI: false,
  hasSessions: true,
  hasIdentityWebAuthFlow: true,
  hasContextMenus: true,
  hasCaptureVisibleTab: true,
  hasWindowsCreate: true,
};

export const CAPABILITIES_BY_BROWSER: Record<SupportedBrowser, BrowserCapabilities> = {
  chrome: CHROME,
  firefox: FIREFOX,
  safari: SAFARI,
};

/** Capability matrix for the *current* build target. */
export const BROWSER_FEATURES: BrowserCapabilities = CAPABILITIES_BY_BROWSER[BROWSER];

/**
 * Firefox may omit `storage.session.setAccessLevel` only for a Firefox build
 * running from its real extension origin. A forged or misconfigured runtime
 * must continue down the explicit-setter path and fail closed.
 */
export function usesNativeTrustedSessionStorage(
  extensionRoot: string,
  browser: SupportedBrowser = BROWSER,
  capabilities: BrowserCapabilities = BROWSER_FEATURES,
): boolean {
  if (browser !== 'firefox' || !capabilities.hasNativeTrustedSessionStorage)
    return false;
  try {
    const parsed = new URL(extensionRoot);
    return parsed.protocol === 'moz-extension:' && parsed.pathname === '/';
  } catch {
    return false;
  }
}

/**
 * Does the current browser appear in this support set?
 *
 * Treats `undefined` / empty as "all browsers" — that's the registry
 * convention: a tool that doesn't declare `supportedBrowsers` ships
 * everywhere.
 */
export function isBrowserSupported(supported: BrowserSet | undefined): boolean {
  if (!supported || supported.length === 0) return true;
  return supported.includes(BROWSER);
}

/**
 * Throw a structured error when a code path requires a browser capability
 * that's not available. Use at handler entry only when there's no graceful
 * fallback. Most call sites should branch on `BROWSER_FEATURES.hasX`
 * instead.
 */
export function assertSupports(feature: keyof BrowserCapabilities): void {
  if (!BROWSER_FEATURES[feature]) {
    throw new Error(
      `Feature '${feature}' is not supported on ${BROWSER}. Branch on BROWSER_FEATURES.${feature} or set supportedBrowsers on the tool.`,
    );
  }
}

export { ALL_BROWSERS, type BrowserSet, type SupportedBrowser };
