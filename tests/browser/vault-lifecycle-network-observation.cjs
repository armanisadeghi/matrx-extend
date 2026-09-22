'use strict';

function isOwnedPanelLogoutResponse({ url, method, frameUrl, extensionId }) {
  return method === 'POST'
    && url === 'https://db.matrxserver.com/auth/v1/logout'
    && frameUrl === `chrome-extension://${extensionId}/sidepanel.html`;
}

module.exports = { isOwnedPanelLogoutResponse };
