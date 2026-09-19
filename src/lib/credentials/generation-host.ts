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
  type GenerationDiscoveryResponse,
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
  if (request.operation === 'discover')
    return Object.keys(request).length === 3 && Number.isInteger(request.tabId) && request.tabId! >= 0;
  if (request.operation === 'use')
    return Object.keys(request).length === 4 && typeof request.offerId === 'string' && request.offerId.length > 0 && typeof request.value === 'string';
  return request.operation === 'discard' && Object.keys(request).length === 3 && Array.isArray(request.offerIds) && request.offerIds.every((id) => typeof id === 'string');
}
function trustedSidepanel(sender: chrome.runtime.MessageSender): boolean {
  return sender.id === chrome.runtime.id && !sender.tab && sender.url === chrome.runtime.getURL('sidepanel.html');
}
async function panelWindow(sender: chrome.runtime.MessageSender): Promise<number | null> {
  if (!trustedSidepanel(sender) || typeof sender.documentId !== 'string' || !chrome.runtime.getContexts) return null;
  try {
    const contexts = (await chrome.runtime.getContexts({
      contextTypes: ['SIDE_PANEL' as chrome.runtime.ContextType],
    })) as Array<{ contextType?: string; documentId?: string; documentUrl?: string; windowId?: number }>;
    const context = contexts.find(
      (candidate) =>
        candidate.contextType === 'SIDE_PANEL' &&
        candidate.documentId === sender.documentId &&
        candidate.documentUrl === chrome.runtime.getURL('sidepanel.html') &&
        Number.isInteger(candidate.windowId),
    );
    return context?.windowId ?? null;
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
  const { tabId: _tabId, windowId: _windowId, topDocumentId: _topDocumentId, documentId: _documentId, topOrigin: _topOrigin, frameOrigin: _frameOrigin, userId: _userId, organizationId: _organizationId, targets: _targets, epoch: _epoch, ...projection } = offer;
  return projection;
}
function clearRegistry(offer: InternalOffer): void {
  void chrome.scripting.executeScript({
    target: { tabId: offer.tabId, documentIds: [offer.documentId] } as chrome.scripting.InjectionTarget,
    func: ((ids: string[]) => window.__matrx_generation_target_registry__?.invalidate(ids)) as unknown as (...args: never[]) => unknown,
    args: [offer.targets.map((target) => target.id)] as unknown as never[],
  }).catch(() => undefined);
}
function invalidate(offers: Iterable<InternalOffer>): void {
  const byDocument = new Map<string, InternalOffer>();
  for (const offer of offers) {
    if (OFFERS.get(offer.id) === offer) OFFERS.delete(offer.id);
    CLAIMS.delete(offer.id);
    byDocument.set(`${offer.tabId}:${offer.documentId}`, offer);
    clearRegistry(offer);
  }
  if (byDocument.size > 0)
    void chrome.runtime
      .sendMessage({ __matrxCredentialGeneration: true, operation: GENERATION_INVALIDATED })
      .catch(() => undefined);
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
function isLive(offer: InternalOffer): boolean {
  return OFFERS.get(offer.id) === offer && offer.expiresAt > Date.now() && epoch(offer.tabId) === offer.epoch;
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
async function discover(tabId: number, senderWindowId: number, requestEpoch: number, tabEpoch: number): Promise<GenerationDiscoveryResponse> {
  const live = (): boolean => lifecycleEpoch === requestEpoch && epoch(tabId) === tabEpoch;
  if (!(await activeFocused(tabId, senderWindowId)) || !live()) return generationResponse('stale');
  const initialActor = await actor();
  if (!initialActor) return live() ? generationResponse('unavailable') : generationResponse('stale');
  let frames: Array<{ frameId: number; documentId?: string; url?: string }>;
  try {
    frames = (await chrome.webNavigation.getAllFrames({ tabId })) ?? [];
  } catch {
    return generationResponse('unavailable');
  }
  const topListed = frames.find((entry) => entry.frameId === 0);
  const top = await frame(tabId, 0);
  if (!live() || !topListed || !top || topListed.documentId !== top.documentId || topListed.url !== top.url) return generationResponse('stale');
  let topUrl: URL;
  try { topUrl = new URL(top.url); } catch { return generationResponse('unsafe_destination'); }
  if (!(await permitted(topUrl))) return generationResponse('unsafe_destination');
  const created: InternalOffer[] = [];
  const now = Date.now();
  const expiresAt = now + GENERATED_SECRET_TTL_MS;
  for (const listed of frames) {
    if (!Number.isInteger(listed.frameId) || typeof listed.documentId !== 'string' || typeof listed.url !== 'string') continue;
    const current = await frame(tabId, listed.frameId);
    if (!live()) return generationResponse('stale');
    if (!current || current.documentId !== listed.documentId || current.url !== listed.url) continue;
    let frameUrl: URL;
    try { frameUrl = new URL(current.url); } catch { continue; }
    if (!(await permitted(frameUrl))) continue;
    if (!live()) return generationResponse('stale');
    const discovered = await inject(tabId, current.documentId, {
      operation: 'discover_new_password_groups', documentId: current.documentId, expiresAt,
    }).catch(() => null);
    if (!live()) return generationResponse('stale');
    if (!discovered) continue;
    for (const group of discovered.groups) {
      const id = randomId();
      if (!id || group.targets.length === 0) continue;
      const offer: InternalOffer = {
        id, origin: frameUrl.origin, frameId: listed.frameId, fieldCount: group.targets.length,
        constraints: group.targets.map((target) => target.constraint), expiresAt,
        tabId, windowId: senderWindowId, topDocumentId: top.documentId, documentId: current.documentId, topOrigin: topUrl.origin,
        frameOrigin: frameUrl.origin, userId: initialActor.userId, organizationId: initialActor.organizationId,
        targets: group.targets, epoch: epoch(tabId),
      };
      created.push(offer);
    }
  }
  const finalActor = await actor();
  if (!live() || !finalActor || finalActor.userId !== initialActor.userId || finalActor.organizationId !== initialActor.organizationId || !(await activeFocused(tabId, senderWindowId)) || !live()) {
    return generationResponse('stale');
  }
  for (const offer of created) OFFERS.set(offer.id, offer);
  if (created.length === 0) return generationResponse('no_targets');
  globalThis.setTimeout(() => invalidate([...created].filter((offer) => offer.expiresAt <= Date.now())), GENERATED_SECRET_TTL_MS + 1);
  return { status: 'ready', offers: created.map(offerProjection) };
}
async function use(offerId: string, value: string, senderWindowId: number): Promise<GenerationUseResponse> {
  const offer = OFFERS.get(offerId);
  if (!offer || CLAIMS.has(offerId)) return useResponse('stale');
  CLAIMS.add(offerId); // claim synchronously, before any await
  if (value.length > MAX_VALUE_LENGTH || offer.windowId !== senderWindowId || offer.expiresAt <= Date.now()) {
    invalidate([offer]);
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
    invalidate([offer]);
  }
}
function discard(ids: readonly string[], windowId: number): void {
  const offers = ids
    .map((id) => OFFERS.get(id))
    .filter((offer): offer is InternalOffer => !!offer && offer.windowId === windowId);
  invalidate(offers);
}

export function registerGeneratedPasswordHost(): void {
  if (registered) return;
  registered = true;
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!validRequest(message) || !trustedSidepanel(sender)) return false;
    const requestEpoch = lifecycleEpoch;
    const tabEpoch = message.operation === 'discover' ? epoch(message.tabId) : 0;
    void panelWindow(sender).then((windowId) => {
      if (windowId === null) return undefined;
      if (message.operation === 'discover') return discover(message.tabId, windowId, requestEpoch, tabEpoch);
      if (message.operation === 'use') return use(message.offerId, message.value, windowId);
      discard(message.offerIds, windowId);
      return { status: 'discarded' };
    }).then((response) => response !== undefined && sendResponse(response)).catch(() => {
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
