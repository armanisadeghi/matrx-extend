/**
 * Browser-targeting primitive types.
 *
 * Used by the tool registry's `supportedBrowsers` axis and by per-browser
 * code branches (UI surface choice, streaming strategy, manifest builder).
 *
 * The default everywhere is "all three" — a tool that omits
 * `supportedBrowsers` ships to Chrome, Firefox, and Safari unchanged.
 */

export const SUPPORTED_BROWSERS = ['chrome', 'firefox', 'safari'] as const;

export type SupportedBrowser = (typeof SUPPORTED_BROWSERS)[number];

/** A tool / feature's browser support set. Omit to mean "all three". */
export type BrowserSet = readonly SupportedBrowser[];

export const ALL_BROWSERS: BrowserSet = SUPPORTED_BROWSERS;
