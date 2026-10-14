/**
 * Who may ask the service worker to run a delegated device tool (`tool:device-invoke`).
 *
 * Allowed: the extension's own pages (`chrome-extension://<this id>/...`, e.g. the side panel),
 * with or without a tab id: a side panel in real use has no tab, an extension page opened as a
 * tab (tests, a pinned page) has one, and both are the extension's own trusted code.
 * Refused: anything else, including content scripts (same extension id, but a web page URL and a
 * tab) and web pages.
 */
export interface DeviceInvokeSender {
  id?: string | undefined;
  url?: string | undefined;
  tab?: unknown | undefined;
}

export function isOwnExtensionPage(sender: DeviceInvokeSender, extensionId: string): boolean {
  if (sender.id !== extensionId) return false;
  return (
    typeof sender.url === 'string' && sender.url.startsWith(`chrome-extension://${extensionId}/`)
  );
}

export function mayInvokeDeviceTool(sender: DeviceInvokeSender, extensionId: string): boolean {
  if (sender.id !== extensionId) return false;
  if (isOwnExtensionPage(sender, extensionId)) return true;
  return !sender.tab;
}
