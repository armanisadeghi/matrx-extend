/**
 * Cross-browser transport for extension-managed OAuth redirects.
 *
 * Safari exposes the standards-shaped promise API as `browser.identity`, while
 * Chrome keeps callback-oriented `chrome.identity`. Keep that distinction at
 * this boundary so sign-in and identity diagnostics observe the same callback.
 */

type BrowserIdentityApi = {
  getRedirectURL?: () => string;
  launchWebAuthFlow?: (details: { url: string; interactive: boolean }) => Promise<
    string | undefined
  >;
};

function getBrowserIdentity(): BrowserIdentityApi | undefined {
  // Identity is unavailable in content/offscreen contexts, so resolve lazily.
  return (globalThis as unknown as { browser?: { identity?: BrowserIdentityApi } }).browser
    ?.identity;
}

export function getRedirectUri(): string {
  const browserIdentity = getBrowserIdentity();
  if (browserIdentity?.getRedirectURL) return browserIdentity.getRedirectURL();

  if (chrome.identity?.getRedirectURL) return chrome.identity.getRedirectURL();
  throw new Error(
    'OAuth sign-in is unavailable because this browser does not provide an identity API',
  );
}

export function launchWebAuthFlow(url: string): Promise<string> {
  const browserIdentity = getBrowserIdentity();
  if (browserIdentity?.launchWebAuthFlow) {
    return browserIdentity.launchWebAuthFlow({ url, interactive: true }).then((callbackUrl) => {
      if (!callbackUrl) throw new Error('OAuth flow cancelled or returned no URL');
      return callbackUrl;
    });
  }

  if (!chrome.identity?.launchWebAuthFlow) {
    return Promise.reject(
      new Error(
        'OAuth sign-in is unavailable because this browser does not provide an identity API',
      ),
    );
  }
  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url, interactive: true }, (callbackUrl) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!callbackUrl) {
        reject(new Error('OAuth flow cancelled or returned no URL'));
        return;
      }
      resolve(callbackUrl);
    });
  });
}
