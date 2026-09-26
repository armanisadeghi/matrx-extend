/**
 * Redirect transport selection for extension-managed OAuth.
 *
 * Safari has no identity API. Its callback is a public frontend route observed
 * by the extension background page. Chrome retains its managed identity flow.
 */

import { ENV } from '@/config/env';
import { BROWSER } from '@/lib/browser/detect';

const SAFARI_CALLBACK_PATH = '/auth/extension-callback';

export function getSafariRedirectUri(): string {
  return new URL(SAFARI_CALLBACK_PATH, ENV.FRONTEND_URL).toString();
}

export function getRedirectUri(): string {
  if (BROWSER === 'safari') return getSafariRedirectUri();
  if (chrome.identity?.getRedirectURL) return chrome.identity.getRedirectURL();
  throw new Error(
    'OAuth sign-in is unavailable because this browser does not provide an identity API',
  );
}

export function launchWebAuthFlow(url: string): Promise<string> {
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
