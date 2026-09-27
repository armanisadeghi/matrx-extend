const RUNTIME_CODES = new Set([
  'browser_runtime_playwright_missing',
  'browser_runtime_playwright_unavailable',
  'browser_runtime_playwright_invalid',
  'browser_runtime_chrome_missing',
]);

// The resolver may include host paths in its explanation. Persist only its known code.
export function nativeRuntimeFailureCode(error) {
  if (!(error instanceof Error)) return null;
  const code = error.message.split(':', 1)[0];
  return RUNTIME_CODES.has(code) ? code : null;
}
