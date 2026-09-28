export interface ScreenshotDocument {
  tabId: number;
  windowId: number;
  documentId: string;
  url: string;
  title: string | null;
}

export async function readScreenshotDocument(tabId: number): Promise<ScreenshotDocument> {
  let tab: chrome.tabs.Tab;
  let frame: Awaited<ReturnType<typeof chrome.webNavigation.getFrame>>;
  try {
    [tab, frame] = await Promise.all([
      chrome.tabs.get(tabId),
      chrome.webNavigation.getFrame({ tabId, frameId: 0 }),
    ]);
  } catch {
    throw new Error('Cannot identify the page for this screenshot. Try again on a regular web page.');
  }
  if (tab.windowId == null || !frame?.documentId || !frame.url || frame.errorOccurred) {
    throw new Error('Cannot identify the page for this screenshot.');
  }
  return {
    tabId,
    windowId: tab.windowId,
    documentId: frame.documentId,
    url: frame.url,
    title: tab.title ?? null,
  };
}

export async function assertScreenshotDocument(document: ScreenshotDocument, requireActive = true): Promise<void> {
  if (requireActive) {
    const [active] = await chrome.tabs.query({ active: true, windowId: document.windowId });
    if (active?.id !== document.tabId) {
      throw new Error('The active tab changed during screenshot capture. Return to the original tab and try again.');
    }
  }
  const current = await readScreenshotDocument(document.tabId);
  if (current.windowId !== document.windowId || current.documentId !== document.documentId || current.url !== document.url) {
    throw new Error('The page changed during screenshot capture. Try again on the current page.');
  }
}

export async function captureForDocument<T>(
  document: ScreenshotDocument,
  capture: () => Promise<T>,
): Promise<T> {
  await assertScreenshotDocument(document);
  const result = await capture();
  await assertScreenshotDocument(document);
  return result;
}
