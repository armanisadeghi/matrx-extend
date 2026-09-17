import { broadcast } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';

export type CredentialAssistanceState =
  | 'none'
  | 'saved_login'
  | 'save_pending'
  | 'capture_unavailable';

const saved = new Set<number>();
const capture = new Map<number, Exclude<CredentialAssistanceState, 'none' | 'saved_login'>>();
const writes = new Map<number, Promise<void>>();
const revisions = new Map<number, number>();
let revision = 0;
let registered = false;

function stateFor(tabId: number): CredentialAssistanceState {
  return capture.get(tabId) ?? (saved.has(tabId) ? 'saved_login' : 'none');
}
async function project(tabId: number, state = stateFor(tabId)): Promise<void> {
  const badge =
    state === 'none' ? '' : state === 'saved_login' ? '•' : state === 'save_pending' ? '+' : '!';
  const title =
    state === 'none'
      ? 'Matrx'
      : state === 'saved_login'
        ? 'Matrx has saved-login assistance'
        : state === 'save_pending'
          ? 'Matrx has a pending Vault save'
          : 'Matrx Vault needs attention';
  try {
    await chrome.action.setBadgeText({ tabId, text: badge });
    await chrome.action.setTitle({ tabId, title });
  } catch {
    // Tab may have closed while an asynchronous Chrome mutation was pending.
  }
}
function enqueue(tabId: number, write: () => Promise<void>): Promise<void> {
  const previous = writes.get(tabId) ?? Promise.resolve();
  const next = previous.then(write, write);
  writes.set(tabId, next);
  void next.finally(() => {
    if (writes.get(tabId) === next) writes.delete(tabId);
  });
  return next;
}
function changed(tabId: number): void {
  revisions.set(tabId, ++revision);
  void enqueue(tabId, () => project(tabId));
  broadcast(CHANNELS.CREDENTIAL_ASSISTANCE_CHANGED, { tabId });
}

export function setSavedLoginAssistance(tabId: number, available: boolean): void {
  const had = saved.has(tabId);
  if (available) saved.add(tabId);
  else saved.delete(tabId);
  if (had !== available) changed(tabId);
}

export function setCaptureAssistance(
  tabId: number,
  state: 'save_pending' | 'capture_unavailable' | 'none',
): void {
  const before = capture.get(tabId) ?? 'none';
  if (state === 'none') capture.delete(tabId);
  else capture.set(tabId, state);
  if (before !== state) changed(tabId);
}

export function clearCredentialAssistance(tabId: number): void {
  saved.delete(tabId);
  capture.delete(tabId);
  changed(tabId);
}

/** Clear stale MV3 action state without erasing a newer live offer. */
export async function reconcileCredentialAssistanceActionOnBoot(): Promise<void> {
  const bootRevision = revision;
  const tabs = await chrome.tabs.query({}).catch(() => []);
  await Promise.all(
    tabs.flatMap((tab) => {
      if (tab.id == null) return [];
      const tabId = tab.id;
      return [
        enqueue(tabId, () =>
          project(tabId, (revisions.get(tabId) ?? 0) > bootRevision ? stateFor(tabId) : 'none'),
        ),
      ];
    }),
  );
}

function trustedExtensionPage(sender: chrome.runtime.MessageSender): boolean {
  return (
    sender.id === chrome.runtime.id &&
    !sender.tab &&
    typeof sender.url === 'string' &&
    sender.url.startsWith(`chrome-extension://${chrome.runtime.id}/`)
  );
}

export function registerCredentialAssistanceStatus(): void {
  if (registered) return;
  registered = true;
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const env = message as { __matrx?: unknown; kind?: unknown; payload?: unknown } | null;
    if (
      env?.__matrx !== true ||
      env.kind !== CHANNELS.CREDENTIAL_ASSISTANCE_STATUS ||
      !trustedExtensionPage(sender) ||
      !env.payload ||
      typeof env.payload !== 'object' ||
      Object.keys(env.payload).length !== 1 ||
      !Number.isInteger((env.payload as { tabId?: unknown }).tabId)
    )
      return false;
    sendResponse({ state: stateFor((env.payload as { tabId: number }).tabId) });
    return false;
  });
  chrome.tabs.onRemoved.addListener(clearCredentialAssistance);
  chrome.tabs.onUpdated.addListener((tabId, info) => {
    if (info.status === 'loading' || info.url) clearCredentialAssistance(tabId);
  });
}
