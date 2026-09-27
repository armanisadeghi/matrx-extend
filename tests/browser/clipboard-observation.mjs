// A temporary read override must end before the caller can trigger a product
// action. Playwright's grantPermissions normalizes extension origins to "null".
export async function withClipboardReadPermission({
  browserSession,
  panel,
  panelUrl,
  read,
  evidence,
}) {
  const url = new URL(panelUrl);
  if (url.protocol !== 'chrome-extension:' || !/^[a-p]{32}$/.test(url.hostname))
    throw new Error('clipboard_observation_origin_refused');
  const origin = `${url.protocol}//${url.host}`;
  const response = await panel.send('Runtime.evaluate', {
    expression: `navigator.permissions.query({name:'clipboard-read'}).then(value=>value.state)`,
    awaitPromise: true,
    returnByValue: true,
  });
  const original = response.result?.value;
  if (response.exceptionDetails || !['granted', 'denied', 'prompt'].includes(original))
    throw new Error('clipboard_observation_permission_state_unavailable');
  const permission = { name: 'clipboard-read' };
  evidence.clipboardObservationStage = 'grant';
  evidence.clipboardObservationPermissionRestored = false;
  // Use setPermission: grantPermissions rejects unrelated permissions as well.
  // The browser session belongs only to the harness's newly spawned profile.
  try {
    await browserSession.send('Browser.setPermission', { permission, setting: 'granted', origin });
    evidence.clipboardReadPermissionForObservation = true;
    evidence.clipboardObservationStage = 'read';
    return await read();
  } finally {
    // Even a transport failure may have delivered the grant. Restore before
    // returning or throwing; no product click can run with our override active.
    const lastStage = evidence.clipboardObservationStage;
    evidence.clipboardObservationStage = 'restore';
    await browserSession.send('Browser.setPermission', { permission, setting: original, origin });
    evidence.clipboardObservationPermissionRestored = true;
    evidence.clipboardObservationStage = lastStage;
  }
}
