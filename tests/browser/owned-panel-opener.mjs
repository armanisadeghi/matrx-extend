const controls =
  '<button id="open-panel">Open panel</button><pre id="result"></pre><pre id="open-trace"></pre>';

function wirePanelOpener(extensionId, root) {
  root.querySelector('#open-panel').addEventListener('click', () => {
    const trace = {
      click_received: true,
      send_invoked: false,
      send_returned: false,
      callback_entered: false,
      callback_has_reply: false,
      callback_last_error: false,
      send_threw: false,
    };
    const publish = () => {
      root.querySelector('#open-trace').textContent = JSON.stringify(trace);
    };
    publish();
    try {
      trace.send_invoked = true;
      publish();
      chrome.runtime.sendMessage(
        extensionId,
        {
          channel: 'FRONTEND_RPC',
          action: 'openPanel',
          payload: { panelId: 'chat' },
          requestId: 'native-sidepanel-qa',
        },
        (reply) => {
          trace.callback_entered = true;
          trace.callback_has_reply = reply !== undefined;
          trace.callback_last_error = Boolean(chrome.runtime.lastError);
          publish();
          root.querySelector('#result').textContent = JSON.stringify(
            reply ?? { error: chrome.runtime.lastError?.message ?? 'no reply' },
          );
        },
      );
      trace.send_returned = true;
      publish();
    } catch (error) {
      trace.send_threw = true;
      publish();
      throw error;
    }
  });
}

export function panelOpenerHtml(extensionId, shadow = false) {
  const mount = shadow
    ? `
    const host = document.createElement('div');
    host.id = 'native-owned-panel-opener';
    host.style.cssText = 'position:fixed;bottom:0;right:0;z-index:2147483647';
    document.body.append(host);
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = ${JSON.stringify(controls)};
  `
    : 'const root = document;';
  return `${shadow ? '' : controls}<script>{
    ${mount}
    (${wirePanelOpener.toString()})(${JSON.stringify(extensionId)}, root);
    document.currentScript?.remove();
  }</script>`;
}
