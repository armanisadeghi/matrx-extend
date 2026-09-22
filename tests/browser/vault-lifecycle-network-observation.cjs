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

function observeOwnedPanelLogout({ panel, extensionId, onResponse }) {
  if (!panel?.onEvent || typeof extensionId !== 'string' || typeof onResponse !== 'function')
    throw new Error('owned_panel_logout_observer_missing');
  const pending = new Set();
  let stopped = false;
  const stop = panel.onEvent((method, params) => {
    if (stopped) return;
    if (method === 'Network.requestWillBeSent') {
      if (isOwnedPanelLogoutResponse({
        url: params?.request?.url,
        method: params?.request?.method,
        frameUrl: params?.documentURL,
        extensionId,
      }) && typeof params.requestId === 'string') pending.add(params.requestId);
      return;
    }
    if (method !== 'Network.responseReceived' || !pending.delete(params?.requestId)) return;
    if (Number.isInteger(params?.response?.status)) onResponse({ status: params.response.status });
  });
  return () => {
    stopped = true;
    pending.clear();
    if (typeof stop === 'function') stop();
  };
}

module.exports = { isOwnedPanelLogoutResponse, observeOwnedPanelLogout };
