export declare function nativeRuntimeFailureCode(
  error: unknown,
):
  | 'browser_runtime_playwright_missing'
  | 'browser_runtime_playwright_unavailable'
  | 'browser_runtime_playwright_invalid'
  | 'browser_runtime_chrome_missing'
  | null;
