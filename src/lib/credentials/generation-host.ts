import { hasRealUserToken } from '@/lib/api/routes/vault';
import { getCurrentUser } from '@/lib/auth/flow';
import {
  type CredentialDomInjectedRequest,
  type CredentialDomResult,
  credentialDomSource,
  type GeneratedPasswordTarget,
} from '@/lib/credentials/fill-primitive';
import { GENERATED_SECRET_TTL_MS } from '@/lib/credentials/generation-targets';
import {
  GENERATION_INVALIDATED,
  GENERATION_PANEL_PORT,
  type GenerationDiscoveryResponse,
  type GenerationInvalidationMessage,
  type GenerationOffer,
  type GenerationRequest,
  type GenerationUseResponse,
} from '@/lib/credentials/generation-protocol';
import { isSafeDestination } from '@/lib/credentials/login-urls';
import { getActiveOrganizationId } from '@/lib/org/active-org';

const MAX_VALUE_LENGTH = 65_536;
const COPY = {
  no_targets: 'No compatible new-password fields are available on this page.',
  stale: 'That password form changed. Generate a new password for the current page.',
  unavailable: 'Password generation is unavailable right now.',
  unsafe_destination: 'Matrx will not use this destination.',
  filled: 'Filled. Matrx did not submit the form.',
  refused_unchanged: 'The password fields changed and were left untouched.',
  rolled_back: 'The password fields changed, so Matrx restored its changes.',
  partial_manual_check: 'The page changed while filling. Review the password fields.',
} as const;

interface InternalOffer extends GenerationOffer {
  connectionId: string;
  tabId: number;
  windowId: number;
  topDocumentId: string;
  documentId: string;
  topOrigin: string;
  frameOrigin: string;
  userId: string;
  organizationId: string;
  targets: GeneratedPasswordTarget[];
  epoch: number;
}

interface FrameState {
  documentId: string;
  url: string;
}

const OFFERS = new Map<string, InternalOffer>();
const CLAIMS = new Set<string>();
const CONNECTIONS = new Map<string, { port: chrome.runtime.Port; alive: boolean }>();
const EPOCHS = new Map<number, number>();
let lifecycleEpoch = 0;
let registered = false;

function generationResponse(
  status: Exclude<GenerationDiscoveryResponse['status'], 'ready'>,
): GenerationDiscoveryResponse {
  return { status, message: COPY[status] };
}
function useResponse(status: GenerationUseResponse['status']): GenerationUseResponse {
  return { status, message: COPY[status] };
}
function epoch(tabId: number): number {
  return EPOCHS.get(tabId) ?? 0;
}
function randomId(): string | null {
  try {
    const bytes = new Uint8Array(18);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}
function validRequest(value: unknown): value is GenerationRequest {
  if (!value || typeof value !== 'object') return false;
  const request = value as Partial<GenerationRequest>;
  if (request.__matrxCredentialGeneration !== true || typeof request.operation !== 'string') return false;
  if (typeof request.connectionId !== 'string' || !/^[a-f0-9]{36}$/.test(request.connectionId)) return false;
  if (request.operation === 'discover')
    return Object.keys(request).length === 4 && Number.isInteger(request.tabId) && request.tabId! >= 0;
  if (request.operation === 'use')
    return Object.keys(request).length === 5 && typeof request.offerId === 'string' && request.offerId.length > 0 && typeof request.value === 'string';
  return request.operation === 'discard' && Object.keys(request).length === 4 && Array.isArray(request.offerIds) && request.offerIds.every((id) => typeof id === 'string');
}
function trustedSidepanel(sender: chrome.runtime.MessageSender): boolean {
  return sender.id === chrome.runtime.id && !sender.tab && sender.url === chrome.runtime.getURL('sidepanel.html');
}
async function panelWindow(sender: chrome.runtime.MessageSender): Promise<number | null> {
  if (!trustedSidepanel(sender)) return null;
  try {
    // Chrome 153 side-panel MessageSender has no documentId, while
    // runtime.getContexts reports SIDE_PANEL windowId/tabId as -1. The exact
    // extension sender boundary remains the authority; derive destination from
    // the focused normal window and bind the requested active tab to it.
    const window = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
    return window.focused === true && Number.isInteger(window.id) ? window.id ?? null : null;
  } catch {
    return null;
  }
}
async function activeFocused(tabId: number, windowId: number): Promise<boolean> {
  try {
    const [tab, window] = await Promise.all([chrome.tabs.get(tabId), chrome.windows.get(windowId)]);
    return tab.windowId === windowId && tab.active === true && window.focused === true;
  } catch {
    return false;
  }
}
async function frame(tabId: number, frameId: number): Promise<FrameState | null> {
  try {
    const result = (await chrome.webNavigation.getFrame({ tabId, frameId })) as unknown as Partial<FrameState> | null;
    return result && typeof result.documentId === 'string' && typeof result.url === 'string'
      ? { documentId: result.documentId, url: result.url }
      : null;
  } catch {
    return null;
  }
}
async function permitted(url: URL): Promise<boolean> {
  if (!isSafeDestination(url)) return false;
  try {
    return await chrome.permissions.contains({ origins: [`${url.origin}/*`] });
  } catch {
    return false;
  }
}
async function actor(): Promise<{ userId: string; organizationId: string } | null> {
  if (!(await hasRealUserToken())) return null;
  const [user, organizationId] = await Promise.all([getCurrentUser(), getActiveOrganizationId()]);
  return user?.id && organizationId ? { userId: user.id, organizationId } : null;
}
async function inject<O extends CredentialDomInjectedRequest['operation']>(
  tabId: number,
  documentId: string,
  request: Extract<CredentialDomInjectedRequest, { operation: O }>,
): Promise<CredentialDomResult<O> | null> {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId, documentIds: [documentId] } as chrome.scripting.InjectionTarget,
    func: credentialDomSource as unknown as (...args: never[]) => CredentialDomResult<O>,
    args: [request] as unknown as never[],
  });
  return (result?.result as CredentialDomResult<O> | undefined) ?? null;
}
function offerProjection(offer: InternalOffer): GenerationOffer {
  const { connectionId: _connectionId, tabId: _tabId, windowId: _windowId, topDocumentId: _topDocumentId, documentId: _documentId, topOrigin: _topOrigin, frameOrigin: _frameOrigin, userId: _userId, organizationId: _organizationId, targets: _targets, epoch: _epoch, ...projection } = offer;
  return projection;
}
function clearRegistry(offer: InternalOffer): void {
  void chrome.scripting.executeScript({
    target: { tabId: offer.tabId, documentIds: [offer.documentId] } as chrome.scripting.InjectionTarget,
    func: ((ids: string[]) => window.__matrx_generation_target_registry__?.invalidate(ids)) as unknown as (...args: never[]) => unknown,
    args: [offer.targets.map((target) => target.id)] as unknown as never[],
  }).catch(() => undefined);
}
function clearUnpublished(offers: Iterable<InternalOffer>): void {
  for (const offer of offers) clearRegistry(offer);
}
function consume(offer: InternalOffer): void {
  if (OFFERS.get(offer.id) === offer) OFFERS.delete(offer.id);
  CLAIMS.delete(offer.id);
  clearRegistry(offer);
}
function invalidate(offers: Iterable<InternalOffer>): void {
  const affected: InternalOffer[] = [];
  for (const offer of offers) {
    if (OFFERS.get(offer.id) !== offer) continue;
    affected.push(offer);
    OFFERS.delete(offer.id);
    CLAIMS.delete(offer.id);
    clearRegistry(offer);
  }
  if (affected.length > 0) {
    const message: GenerationInvalidationMessage = {
      __matrxCredentialGeneration: true,
      operation: GENERATION_INVALIDATED,
      offerIds: affected.map((offer) => offer.id),
    };
    void chrome.runtime
      .sendMessage(message)
      .catch(() => undefined);
  }
}
function invalidateTab(tabId?: number): void {
  lifecycleEpoch++;
  for (const [id, current] of EPOCHS) if (tabId === undefined || id === tabId) EPOCHS.set(id, current + 1);
  invalidate([...OFFERS.values()].filter((offer) => tabId === undefined || offer.tabId === tabId));
}
function invalidateWindow(windowId: number): void {
  lifecycleEpoch++;
  const affected = [...OFFERS.values()].filter((offer) => offer.windowId === windowId);
  for (const offer of affected) EPOCHS.set(offer.tabId, epoch(offer.tabId) + 1);
  invalidate(affected);
}
function invalidateConnection(connectionId: string): void {
  invalidate([...OFFERS.values()].filter((offer) => offer.connectionId === connectionId));
}
function connectionLive(connectionId: string): boolean {
  return CONNECTIONS.get(connectionId)?.alive === true;
}
function isLive(offer: InternalOffer): boolean {
  return OFFERS.get(offer.id) === offer && connectionLive(offer.connectionId) && offer.expiresAt > Date.now() && epoch(offer.tabId) === offer.epoch;
}
async function currentBinding(offer: InternalOffer): Promise<boolean> {
  if (!isLive(offer) || !(await activeFocused(offer.tabId, offer.windowId))) return false;
  if (!isLive(offer)) return false;
  const [top, selected, currentActor] = await Promise.all([
    frame(offer.tabId, 0),
    frame(offer.tabId, offer.frameId),
    actor(),
  ]);
  if (!isLive(offer) || !top || !selected || !currentActor) return false;
  if (top.documentId !== offer.topDocumentId || selected.documentId !== offer.documentId) return false;
  if (new URL(top.url).origin !== offer.topOrigin || new URL(selected.url).origin !== offer.frameOrigin) return false;
  if (currentActor.userId !== offer.userId || currentActor.organizationId !== offer.organizationId) return false;
  return (await permitted(new URL(top.url))) && (await permitted(new URL(selected.url))) && isLive(offer);
}
async function discover(tabId: number, senderWindowId: number, connectionId: string, requestEpoch: number, tabEpoch: number): Promise<GenerationDiscoveryResponse> {
  const created: InternalOffer[] = [];
  const live = (): boolean => connectionLive(connectionId) && lifecycleEpoch === requestEpoch && epoch(tabId) === tabEpoch;
  const stale = (): GenerationDiscoveryResponse => { clearUnpublished(created); invalidate(created); return generationResponse('stale'); };
  if (!(await activeFocused(tabId, senderWindowId)) || !live()) return stale();
  const initialActor = await actor();
  if (!initialActor) return live() ? generationResponse('unavailable') : stale();
  let frames: Array<{ frameId: number; documentId?: string; url?: string }>;
  try {
    frames = (await chrome.webNavigation.getAllFrames({ tabId })) ?? [];
  } catch {
    return generationResponse('unavailable');
  }
  const topListed = frames.find((entry) => entry.frameId === 0);
  const top = await frame(tabId, 0);
  if (!live() || !topListed || !top || topListed.documentId !== top.documentId || topListed.url !== top.url) return stale();
  let topUrl: URL;
  try { topUrl = new URL(top.url); } catch { return generationResponse('unsafe_destination'); }
  if (!(await permitted(topUrl))) return generationResponse('unsafe_destination');
  const now = Date.now();
  const expiresAt = now + GENERATED_SECRET_TTL_MS;
  for (const listed of frames) {
    if (!Number.isInteger(listed.frameId) || typeof listed.documentId !== 'string' || typeof listed.url !== 'string') continue;
    const current = await frame(tabId, listed.frameId);
    if (!live()) return stale();
    if (!current || current.documentId !== listed.documentId || current.url !== listed.url) continue;
    let frameUrl: URL;
    try { frameUrl = new URL(current.url); } catch { continue; }
    if (!(await permitted(frameUrl))) continue;
    if (!live()) return stale();
    const discovered = await inject(tabId, current.documentId, {
      operation: 'discover_new_password_groups', documentId: current.documentId, expiresAt,
    }).catch(() => null);
    if (!discovered) continue;
    for (const group of discovered.groups) {
      const id = randomId();
      if (!id || group.targets.length === 0) continue;
      const offer: InternalOffer = {
        connectionId,
        id, origin: frameUrl.origin, frameId: listed.frameId, fieldCount: group.targets.length,
        constraints: group.targets.map((target) => target.constraint), expiresAt,
        tabId, windowId: senderWindowId, topDocumentId: top.documentId, documentId: current.documentId, topOrigin: topUrl.origin,
        frameOrigin: frameUrl.origin, userId: initialActor.userId, organizationId: initialActor.organizationId,
        targets: group.targets, epoch: epoch(tabId),
      };
      created.push(offer);
    }
    if (!live()) return stale();
  }
  const finalActor = await actor();
  if (!live() || !finalActor || finalActor.userId !== initialActor.userId || finalActor.organizationId !== initialActor.organizationId || !(await activeFocused(tabId, senderWindowId)) || !live()) {
    return stale();
  }
  for (const offer of created) OFFERS.set(offer.id, offer);
  if (created.length === 0) return generationResponse('no_targets');
  globalThis.setTimeout(() => {
    // A claimed use owns its own cleanup. An old timer must not invalidate a
    // newer offer or emit a page-changed event after successful use/discard.
    invalidate(created.filter((offer) => !CLAIMS.has(offer.id) && offer.expiresAt <= Date.now()));
  }, GENERATED_SECRET_TTL_MS + 1);
  return { status: 'ready', offers: created.map(offerProjection) };
}
async function use(offer: InternalOffer, value: string, senderWindowId: number): Promise<GenerationUseResponse> {
  if (value.length > MAX_VALUE_LENGTH || offer.windowId !== senderWindowId || offer.expiresAt <= Date.now()) {
    consume(offer);
    return useResponse('stale');
  }
  try {
    if (!(await currentBinding(offer))) return useResponse('stale');
    if (!(await currentBinding(offer))) return useResponse('stale');
    const result = await inject(offer.tabId, offer.documentId, {
      operation: 'fill_new_password_group', documentId: offer.documentId, expiresAt: offer.expiresAt,
      targets: offer.targets, value,
    }).catch(() => null);
    if (!isLive(offer)) return useResponse('stale');
    return result ? useResponse(result.status) : useResponse('unavailable');
  } finally {
    value = '';
    consume(offer);
  }
}
function discard(ids: readonly string[], windowId: number): void {
  const offers = ids
    .map((id) => OFFERS.get(id))
    .filter((offer): offer is InternalOffer => !!offer && offer.windowId === windowId);
  for (const offer of offers) consume(offer);
}

export function registerGeneratedPasswordHost(): void {
  if (registered) return;
  registered = true;
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== GENERATION_PANEL_PORT) return;
    if (!trustedSidepanel(port.sender ?? {})) {
      port.disconnect();
      return;
    }
    const connectionId = randomId();
    if (!connectionId) { port.disconnect(); return; }
    CONNECTIONS.set(connectionId, { port, alive: true });
    port.onDisconnect.addListener(() => {
      const connection = CONNECTIONS.get(connectionId);
      if (!connection || connection.port !== port) return;
      connection.alive = false;
      invalidateConnection(connectionId);
      CONNECTIONS.delete(connectionId);
    });
    port.postMessage({ __matrxCredentialGeneration: true, operation: 'connected', connectionId });
  });
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!validRequest(message) || !trustedSidepanel(sender)) return false;
    if (!connectionLive(message.connectionId)) {
      sendResponse(message.operation === 'discover' ? generationResponse('stale') : useResponse('stale'));
      return true;
    }
    const requestEpoch = lifecycleEpoch;
    const tabEpoch = message.operation === 'discover' ? epoch(message.tabId) : 0;
    // Use claims are reserved before getContexts: a competing click can never
    // survive a delayed sidepanel-context lookup. Every later failure consumes
    // this same object; it is never reinserted.
    const claimed = message.operation === 'use' ? OFFERS.get(message.offerId) : undefined;
    if (message.operation === 'use') {
      if (!claimed || claimed.connectionId !== message.connectionId || CLAIMS.has(claimed.id)) {
        sendResponse(useResponse('stale'));
        return true;
      }
      CLAIMS.add(claimed.id);
    }
    void panelWindow(sender).then((windowId) => {
      if (windowId === null) {
        if (claimed) consume(claimed);
        return message.operation === 'discover' ? generationResponse('unavailable') : useResponse('stale');
      }
      if (message.operation === 'discover') return discover(message.tabId, windowId, message.connectionId, requestEpoch, tabEpoch);
      if (message.operation === 'use') {
        return use(claimed!, message.value, windowId);
      }
      const offers = message.offerIds.map((id) => OFFERS.get(id));
      if (offers.some((offer) => offer?.connectionId !== message.connectionId)) return useResponse('stale');
      discard(message.offerIds, windowId);
      return { status: 'discarded' };
    }).then((response) => response !== undefined && sendResponse(response)).catch(() => {
      if (claimed) consume(claimed);
      if (message.operation === 'discover') sendResponse(generationResponse('unavailable'));
      else if (message.operation === 'use') sendResponse(useResponse('unavailable'));
    });
    return true;
  });
  chrome.tabs.onRemoved.addListener((tabId) => invalidateTab(tabId));
  chrome.tabs.onUpdated.addListener((tabId, change) => {
    if (change.status === 'loading' || change.url) invalidateTab(tabId);
  });
  chrome.tabs.onActivated.addListener((active) => invalidateWindow(active.windowId));
  chrome.windows.onRemoved.addListener((windowId) => invalidateWindow(windowId));
  chrome.windows.onFocusChanged.addListener(() => {
    lifecycleEpoch++;
    invalidate([...OFFERS.values()]);
  });
  chrome.webNavigation.onCommitted.addListener((details) => invalidateTab(details.tabId));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && ('matrx.org.active' in changes || 'matrx.auth.accessToken' in changes || 'matrx.user.profile' in changes)) invalidateTab();
  });
}
