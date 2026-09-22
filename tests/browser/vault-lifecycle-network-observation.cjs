'use strict';

function isOwnedPanelLogoutResponse({ url, method, frameUrl, extensionId }) {
  let parsed;
  try { parsed = new URL(url); } catch { return false; }
  return method === 'POST'
    && parsed.origin === 'https://db.matrxserver.com'
    && parsed.pathname === '/auth/v1/logout'
    && parsed.searchParams.get('scope') === 'local'
    && [...parsed.searchParams.keys()].length === 1
    && frameUrl === `chrome-extension://${extensionId}/sidepanel.html`;
}

module.exports = { isOwnedPanelLogoutResponse };
