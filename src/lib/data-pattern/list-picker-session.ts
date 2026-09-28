/** The isolated-world picker hooks are installed by list-picker.content.ts. */
export interface ListPickerWindow {
  __matrxListPickerStart?: (sessionId: string, seed?: ListPickerSeed | null) => void;
  __matrxListPickerCancel?: (sessionId: string) => void;
  __matrxListPickerTeardown?: () => void;
}

export interface ListPickerSeed {
  list_root: string;
  item_selector: string;
}

export interface ListPickerIdentity {
  session_id: string;
  tab_id?: number | null;
  document_id?: string | null;
}

// Chrome injection has two stages (install, then start with arguments). Keep
// start/stop ordered per tab, including across builder unmount/remount, so an
// older installation cannot finish after and replace a newer picker.
const pending = new Map<number, Promise<void>>();

function sequence(tabId: number, operation: () => Promise<void>): Promise<void> {
  const previous = pending.get(tabId) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  pending.set(tabId, current);
  void current
    .finally(() => {
      if (pending.get(tabId) === current) pending.delete(tabId);
    })
    .catch(() => {});
  return current;
}

export function startListPickerSession(
  tabId: number,
  documentId: string,
  sessionId: string,
  seed: ListPickerSeed | null,
  isCurrent: () => boolean,
): Promise<void> {
  return sequence(tabId, async () => {
    if (!isCurrent()) throw new Error('The page changed before the picker could start. Retry on the current page.');
    await chrome.scripting.executeScript({
      target: { tabId, documentIds: [documentId] },
      files: ['content-scripts/list-picker.js'],
    });
    if (!isCurrent()) throw new Error('The page changed before the picker could start. Retry on the current page.');
    await chrome.scripting.executeScript({
      target: { tabId, documentIds: [documentId] },
      func: (id: string, initial: ListPickerSeed | null) => {
        const start = (window as ListPickerWindow).__matrxListPickerStart;
        if (!start) throw new Error('The page picker could not start. Try picking again.');
        start(id, initial);
      },
      args: [sessionId, seed ?? null],
    });
  });
}

export function cancelListPickerSession(tabId: number, documentId: string, sessionId: string): Promise<void> {
  return sequence(tabId, async () => {
    await chrome.scripting.executeScript({
      target: { tabId, documentIds: [documentId] },
      func: (id: string) => {
        (window as ListPickerWindow).__matrxListPickerCancel?.(id);
      },
      args: [sessionId],
    });
  });
}
