import {
  fetchBrowserLoginMatches,
  hasRealUserToken,
  materializeBrowserLogin,
} from '@/lib/api/routes/vault';
import { getCurrentUser } from '@/lib/auth/flow';
import { setSavedLoginAssistance } from '@/lib/credentials/assistance-status';
import {
  type BoundLoginGroup,
  type CredentialDomInjectedRequest,
  type CredentialDomResult,
  credentialDomSource,
} from '@/lib/credentials/fill-primitive';
import { isSafeDestination, normalizeLoginUrl } from '@/lib/credentials/login-urls';
import { SENSITIVE_ATTR, rememberSensitiveFields } from '@/lib/credentials/sensitive-fields';
import { CHANNELS } from '@/lib/messaging/schemas';
import { getActiveOrganizationId } from '@/lib/org/active-org';
import { readOfferSavedLoginsEnabled } from '@/lib/settings/persisted';

/**
 * Service-worker host for the metadata-only inline Vault chooser.
 *
 * This deliberately uses a raw onMessage listener: it accepts content-script
 * messages carrying page selectors and must never pass through the debug
 * messaging bus. Credential values exist only between materialize and the
 * document-targeted fill injection below.
 */

const OFFER_TTL_MS = 60_000;
const MAX_SELECTOR_LENGTH = 800;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type QueryResponse =
  | { status: 'ready'; offerId: string; matches: Array<{ item_id: string; display_name: string }> }
  | {
      status:
        | 'no_matches'
        | 'sign_in_required'
        | 'organization_required'
        | 'unavailable'
        | 'unsafe_destination';
      message: string;
    };
type FillResponse = {
  status: 'filled' | 'stale' | 'unavailable' | 'unsafe_destination';
  message: string;
};

interface FormGroup extends BoundLoginGroup {}
interface Offer extends FormGroup {
  id: string;
  tabId: number;
  windowId: number;
  documentId: string;
  organizationId: string;
  userId: string;
  itemIds: Set<string>;
  expiresAt: number;
  generation: number;
}

const OFFERS = new Map<string, Offer>();
const GENERATIONS = new Map<string, number>();
// This fence deliberately outlives an offer claim. A claimed fill can still be
// awaiting materialization when a person changes tabs and comes back.
const ACTIVATION_EPOCHS = new Map<number, number>();
let registered = false;

const COPY = {
  no_matches: 'No saved login is available for this form.',
  sign_in_required: 'Sign in to Matrx to use saved logins.',
  organization_required: 'Choose an organization in Matrx before using saved logins.',
  unavailable: 'Saved logins are unavailable right now.',
  unsafe_destination: 'Matrx will not fill this page.',
  stale: 'That sign-in form changed. Focus it again to choose a saved login.',
  filled: 'Filled. Matrx did not submit the form.',
} as const;
const PANEL_COPY = {
  stale: 'Click the username or password box on the website, then choose Fill.',
  disabled: 'Turn on saved-login matching in extension settings to use Fill.',
  filled: 'Filled. Review the form, then sign in.',
} as const;

function response(status: keyof typeof COPY): QueryResponse {
  return { status: status as Exclude<QueryResponse['status'], 'ready'>, message: COPY[status] };
}
function fillResponse(status: FillResponse['status']): FillResponse {
  return { status, message: COPY[status] };
}
function purge(tabId?: number): void {
  const affected = new Set<number>();
  for (const [id, offer] of OFFERS)
    if (tabId === undefined || offer.tabId === tabId) {
      affected.add(offer.tabId);
      OFFERS.delete(id);
    }
  for (const id of tabId === undefined ? affected : new Set([tabId]))
    setSavedLoginAssistance(id, false);
}
function purgeExpired(): void {
  for (const [id, offer] of OFFERS) if (offer.expiresAt <= Date.now()) expireOffer(id);
}
function generationKey(tabId: number, documentId: string): string {
  return `${tabId}:${documentId}`;
}
function nextGeneration(tabId: number, documentId: string): number {
  const key = generationKey(tabId, documentId);
  const next = (GENERATIONS.get(key) ?? 0) + 1;
  GENERATIONS.set(key, next);
  purge(tabId);
  return next;
}
function invalidate(tabId?: number): void {
  purge(tabId);
  for (const key of GENERATIONS.keys()) {
    if (tabId === undefined || key.startsWith(`${tabId}:`))
      GENERATIONS.set(key, (GENERATIONS.get(key) ?? 0) + 1);
  }
}
function randomOfferId(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
function validQuery(payload: unknown): payload is { fieldSelector: string } {
  return (
    !!payload &&
    typeof payload === 'object' &&
    typeof (payload as { fieldSelector?: unknown }).fieldSelector === 'string' &&
    (payload as { fieldSelector: string }).fieldSelector.length > 0 &&
    (payload as { fieldSelector: string }).fieldSelector.length <= MAX_SELECTOR_LENGTH &&
    Object.keys(payload).length === 1
  );
}
function validFill(payload: unknown): payload is { offerId: string; itemId: string } {
  return (
    !!payload &&
    typeof payload === 'object' &&
    typeof (payload as { offerId?: unknown }).offerId === 'string' &&
    typeof (payload as { itemId?: unknown }).itemId === 'string' &&
    Object.keys(payload).length === 2
  );
}
function validPanelPayload(payload: unknown): payload is { tabId: number; itemId?: string } {
  return (
    !!payload &&
    typeof payload === 'object' &&
    Number.isInteger((payload as { tabId?: unknown }).tabId) &&
    (payload as { tabId: number }).tabId >= 0 &&
    Object.keys(payload).every((key) => key === 'tabId' || key === 'itemId') &&
    (!('itemId' in payload) ||
      (typeof (payload as { itemId?: unknown }).itemId === 'string' &&
        UUID.test((payload as { itemId: string }).itemId)))
  );
}
function trustedSidepanel(sender: chrome.runtime.MessageSender): boolean {
  return (
    sender.id === chrome.runtime.id &&
    !sender.tab &&
    sender.url === chrome.runtime.getURL('sidepanel.html')
  );
}
function activationEpoch(windowId: number): number {
  return ACTIVATION_EPOCHS.get(windowId) ?? 0;
}
async function currentActiveTab(tabId: number, windowId: number): Promise<boolean> {
  try {
    const tab = await chrome.tabs.get(tabId);
    return tab.windowId === windowId && tab.active === true;
  } catch {
    return false;
  }
}

/** Test seam: this is the one serializable credential DOM source. */
export const __inlineFillSerializedSourceForTest = credentialDomSource.toString();

async function injectCredentialDom<O extends CredentialDomInjectedRequest['operation']>(
  tabId: number,
  documentId: string,
  request: Extract<CredentialDomInjectedRequest, { operation: O }>,
): Promise<CredentialDomResult<O> | null> {
  const target = { tabId, documentIds: [documentId] } as chrome.scripting.InjectionTarget;
  const [first] = await chrome.scripting.executeScript({
    target,
    func: credentialDomSource as unknown as (...args: never[]) => CredentialDomResult<O>,
    args: [request] as unknown as never[],
  });
  return (first?.result as CredentialDomResult<O> | undefined) ?? null;
}

function canTargetCurrentDocument(): boolean {
  // Chrome 106 is frozen in the manifest, which guarantees documentIds. These
  // checks only catch a partially unavailable API; they do not claim to prove
  // an option an older browser never supported.
  return (
    typeof chrome.scripting?.executeScript === 'function' &&
    typeof chrome.webNavigation?.getFrame === 'function'
  );
}

async function context(): Promise<{ userId: string; organizationId: string } | null> {
  if (!(await hasRealUserToken())) return null;
  const [user, organizationId] = await Promise.all([getCurrentUser(), getActiveOrganizationId()]);
  return user?.id && organizationId ? { userId: user.id, organizationId } : null;
}

/** Chrome 106+ document targeting is mandatory; never fall back to tab-only injection. */
async function isCurrentTopDocument(tabId: number, documentId: string): Promise<boolean> {
  if (!canTargetCurrentDocument()) return false;
  try {
    const frame = (await chrome.webNavigation.getFrame({ tabId, frameId: 0 })) as unknown as {
      documentId?: unknown;
    } | null;
    return frame?.documentId === documentId;
  } catch {
    return false;
  }
}

async function query(tabId: number, documentId: string, selector: string): Promise<QueryResponse> {
  const generation = nextGeneration(tabId, documentId);
  // Window identity arrives asynchronously; retain each window's epoch from
  // query entry so activation during any earlier await cannot mint an offer.
  const activationAtStart = new Map(ACTIVATION_EPOCHS);
  if (!canTargetCurrentDocument()) return response('unavailable');
  if (!(await isCurrentTopDocument(tabId, documentId))) return response('unavailable');
  if (!(await readOfferSavedLoginsEnabled())) return response('unavailable');
  if (!(await hasRealUserToken())) return response('sign_in_required');
  const actor = await context();
  if (!actor) return response('organization_required');
  const group = await injectCredentialDom(tabId, documentId, {
    operation: 'focused_group',
    selector,
  }).catch(() => null);
  if (!group) return response('unsafe_destination');
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab || tab.windowId == null || !tab.active) return response('unavailable');
  const queryEpoch = activationAtStart.get(tab.windowId) ?? 0;
  if (activationEpoch(tab.windowId) !== queryEpoch) return response('unsafe_destination');
  const url = new URL(group.pageUrl);
  if (!isSafeDestination(url) || !normalizeLoginUrl(group.pageUrl))
    return response('unsafe_destination');
  const matches = await fetchBrowserLoginMatches(
    group.pageUrl,
    { includeFieldInventory: true },
    { expectedActor: actor },
  );
  if (GENERATIONS.get(generationKey(tabId, documentId)) !== generation)
    return response('unsafe_destination');
  if (activationEpoch(tab.windowId) !== queryEpoch) return response('unsafe_destination');
  const actorAfterMatches = await context();
  if (
    !actorAfterMatches ||
    actorAfterMatches.userId !== actor.userId ||
    actorAfterMatches.organizationId !== actor.organizationId
  )
    return response('organization_required');
  if (activationEpoch(tab.windowId) !== queryEpoch) return response('unsafe_destination');
  if (!matches.ok)
    return response(
      matches.failure.kind === 'sign_in_required' ? 'sign_in_required' : 'unavailable',
    );
  // Username-only is permitted only after the server's canonical URL matcher has a match.
  const eligible = matches.data.matches.filter((m) => {
    const inventory = m.available_fields ?? [];
    return (
      (!group.username || inventory.some((f) => f.field_key === 'username' && f.fillable)) &&
      (!group.password || inventory.some((f) => f.field_key === 'password' && f.fillable))
    );
  });
  if (eligible.length === 0) return response('no_matches');
  if (
    GENERATIONS.get(generationKey(tabId, documentId)) !== generation ||
    activationEpoch(tab.windowId) !== queryEpoch
  )
    return response('unsafe_destination');
  const id = randomOfferId();
  OFFERS.set(id, {
    id,
    tabId,
    windowId: tab.windowId,
    documentId,
    organizationId: actor.organizationId,
    userId: actor.userId,
    itemIds: new Set(eligible.map((m) => m.item_id)),
    expiresAt: Date.now() + OFFER_TTL_MS,
    generation,
    ...group,
  });
  setSavedLoginAssistance(tabId, true);
  globalThis.setTimeout(() => {
    expireOffer(id);
  }, OFFER_TTL_MS + 1);
  return {
    status: 'ready',
    offerId: id,
    matches: eligible.map(({ item_id, display_name }) => ({ item_id, display_name })),
  };
}

type PanelStatus = { status: 'ready' | 'none' | 'disabled'; itemIds: string[] };
async function panelStatus(tabId: number): Promise<PanelStatus> {
  purgeExpired();
  if (!(await readOfferSavedLoginsEnabled())) return { status: 'disabled', itemIds: [] };
  const offers = [...OFFERS.values()].filter(
    (offer) =>
      offer.tabId === tabId &&
      offer.expiresAt > Date.now() &&
      GENERATIONS.get(generationKey(offer.tabId, offer.documentId)) === offer.generation,
  );
  if (offers.length !== 1) return { status: 'none', itemIds: [] };
  const offer = offers[0];
  if (!offer) return { status: 'none', itemIds: [] };
  if (!(await isCurrentTopDocument(offer.tabId, offer.documentId)))
    return { status: 'none', itemIds: [] };
  const actor = await context();
  if (!actor || actor.userId !== offer.userId || actor.organizationId !== offer.organizationId)
    return { status: 'none', itemIds: [] };
  if (
    OFFERS.get(offer.id) !== offer ||
    GENERATIONS.get(generationKey(offer.tabId, offer.documentId)) !== offer.generation ||
    offer.expiresAt <= Date.now()
  )
    return { status: 'none', itemIds: [] };
  return { status: 'ready', itemIds: [...offer.itemIds] };
}

async function fill(
  tabId: number,
  documentId: string,
  payload: { offerId: string; itemId: string },
): Promise<FillResponse> {
  const offer = OFFERS.get(payload.offerId);
  OFFERS.delete(payload.offerId); // claim before async work: duplicate clicks cannot fill twice
  if (offer) setSavedLoginAssistance(tabId, false);
  if (!offer) return fillResponse('stale');
  if (
    offer.tabId !== tabId ||
    offer.documentId !== documentId ||
    offer.expiresAt <= Date.now() ||
    !offer.itemIds.has(payload.itemId)
  )
    return fillResponse('stale');
  if (!canTargetCurrentDocument()) return fillResponse('unavailable');
  if (!(await isCurrentTopDocument(tabId, documentId))) return fillResponse('unavailable');
  if (GENERATIONS.get(generationKey(tabId, documentId)) !== offer.generation)
    return fillResponse('stale');
  if (!(await readOfferSavedLoginsEnabled())) return fillResponse('unavailable');
  const actor = await context();
  if (!actor || actor.userId !== offer.userId || actor.organizationId !== offer.organizationId)
    return fillResponse('stale');
  const current = await injectCredentialDom(tabId, documentId, {
    operation: 'focused_group',
    selector: offer.anchor,
  }).catch(() => null);
  if (
    !current ||
    current.pageUrl !== offer.pageUrl ||
    current.username !== offer.username ||
    current.password !== offer.password
  )
    return fillResponse('stale');
  const materialized = await materializeBrowserLogin(
    payload.itemId,
    {
      pageUrl: offer.pageUrl,
      toolInvocationId: `inline-${offer.id}`,
      clientBuild: chrome.runtime.getManifest().version,
      fieldKeys: current.usernameOnly ? ['username'] : ['username', 'password'],
    },
    { expectedActor: actor },
  );
  if (!materialized.ok)
    return fillResponse(materialized.failure.kind === 'forbidden' ? 'stale' : 'unavailable');
  const data = materialized.data;
  const clearMaterialized = (): void => {
    data.username = '';
    data.password = '';
    data.fields = {};
  };
  const stillAuthorized = async (): Promise<boolean> => {
    const currentActor = await context();
    return (
      !!currentActor &&
      currentActor.userId === offer.userId &&
      currentActor.organizationId === offer.organizationId &&
      (await readOfferSavedLoginsEnabled()) &&
      GENERATIONS.get(generationKey(tabId, documentId)) === offer.generation
    );
  };
  if (!(await stillAuthorized())) {
    clearMaterialized();
    return fillResponse('stale');
  }
  if (!(await isCurrentTopDocument(tabId, documentId))) {
    clearMaterialized();
    return fillResponse('stale');
  }
  // This is immediately after the final awaited document check. An
  // invalidation can happen while Chrome resolves getFrame, so re-check the
  // current actor/settings and synchronous offer generation before injection.
  if (!(await stillAuthorized())) {
    clearMaterialized();
    return fillResponse('stale');
  }
  if (data.origin !== new URL(offer.pageUrl).origin) {
    clearMaterialized();
    return fillResponse('unsafe_destination');
  }
  const username = data.fields?.username ?? data.username;
  const password = data.fields?.password ?? data.password;
  const sensitive = [offer.username, offer.password].filter((x): x is string => !!x);
  rememberSensitiveFields(tabId, sensitive);
  try {
    const done = await injectCredentialDom(tabId, documentId, {
      operation: 'fill',
      expected: offer,
      requested: [
        ...(offer.username ? [{ selector: offer.username, value: username ?? null }] : []),
        ...(offer.password ? [{ selector: offer.password, value: password ?? null }] : []),
      ],
      sensitiveAttr: SENSITIVE_ATTR,
      preserveLegacyFieldBehavior: false,
    }).catch(() => null);
    return done?.ok ? fillResponse('filled') : fillResponse('stale');
  } finally {
    clearMaterialized();
  }
}

async function panelFill(tabId: number, itemId: string): Promise<FillResponse> {
  purgeExpired();
  const candidates = [...OFFERS.values()].filter(
    (offer) => offer.tabId === tabId && offer.itemIds.has(itemId) && offer.expiresAt > Date.now(),
  );
  if (candidates.length !== 1) return { status: 'stale', message: PANEL_COPY.stale };
  const offer = candidates[0];
  if (!offer) return { status: 'stale', message: PANEL_COPY.stale };
  // Claim synchronously before any await. This is the only admission point for
  // competing panel clicks and survives later validation failure.
  OFFERS.delete(offer.id);
  setSavedLoginAssistance(offer.tabId, false);
  const capturedEpoch = activationEpoch(offer.windowId);
  if (!(await readOfferSavedLoginsEnabled()))
    return { status: 'unavailable', message: PANEL_COPY.disabled };
  if (
    !(await currentActiveTab(offer.tabId, offer.windowId)) ||
    !(await isCurrentTopDocument(offer.tabId, offer.documentId))
  )
    return { status: 'stale', message: PANEL_COPY.stale };
  const valid = (): boolean =>
    activationEpoch(offer.windowId) === capturedEpoch &&
    GENERATIONS.get(generationKey(offer.tabId, offer.documentId)) === offer.generation &&
    offer.expiresAt > Date.now();
  const fence = async (): Promise<boolean> => {
    if (!valid()) return false;
    if (!(await currentActiveTab(offer.tabId, offer.windowId)) || !valid()) return false;
    if (!(await isCurrentTopDocument(offer.tabId, offer.documentId))) return false;
    return valid();
  };
  if (!(await fence())) return { status: 'stale', message: PANEL_COPY.stale };
  if (GENERATIONS.get(generationKey(offer.tabId, offer.documentId)) !== offer.generation)
    return { status: 'stale', message: PANEL_COPY.stale };
  const actor = await context();
  if (!actor || actor.userId !== offer.userId || actor.organizationId !== offer.organizationId)
    return { status: 'stale', message: PANEL_COPY.stale };
  const current = await injectCredentialDom(offer.tabId, offer.documentId, {
    operation: 'focused_group',
    selector: offer.anchor,
    requirePanelFocus: true,
  }).catch(() => null);
  if (
    !(await fence()) ||
    !current ||
    current.pageUrl !== offer.pageUrl ||
    current.username !== offer.username ||
    current.password !== offer.password
  )
    return { status: 'stale', message: PANEL_COPY.stale };
  const materialized = await materializeBrowserLogin(
    itemId,
    {
      pageUrl: offer.pageUrl,
      toolInvocationId: `panel-${offer.id}`,
      clientBuild: chrome.runtime.getManifest().version,
      fieldKeys: current.usernameOnly ? ['username'] : ['username', 'password'],
    },
    { expectedActor: actor },
  );
  if (!materialized.ok)
    return fillResponse(materialized.failure.kind === 'forbidden' ? 'stale' : 'unavailable');
  const data = materialized.data;
  const clear = (): void => {
    data.username = '';
    data.password = '';
    data.fields = {};
  };
  try {
    const actorAfterMaterialization = await context();
    if (
      !actorAfterMaterialization ||
      actorAfterMaterialization.userId !== offer.userId ||
      actorAfterMaterialization.organizationId !== offer.organizationId ||
      !(await readOfferSavedLoginsEnabled()) ||
      !(await fence()) ||
      data.origin !== new URL(offer.pageUrl).origin
    )
      return { status: 'stale', message: PANEL_COPY.stale };
    rememberSensitiveFields(
      offer.tabId,
      [offer.username, offer.password].filter((x): x is string => !!x),
    );
    const done = await injectCredentialDom(offer.tabId, offer.documentId, {
      operation: 'fill',
      expected: offer,
      requested: [
        ...(offer.username
          ? [{ selector: offer.username, value: data.fields?.username ?? data.username ?? null }]
          : []),
        ...(offer.password
          ? [{ selector: offer.password, value: data.fields?.password ?? data.password ?? null }]
          : []),
      ],
      sensitiveAttr: SENSITIVE_ATTR,
      preserveLegacyFieldBehavior: false,
      requirePanelFocus: true,
    }).catch(() => null);
    return done?.ok
      ? { status: 'filled', message: PANEL_COPY.filled }
      : { status: 'stale', message: PANEL_COPY.stale };
  } finally {
    clear();
  }
}

function contextTargets(): Array<{ tabId: number; documentId: string }> {
  const targets = new Map<string, { tabId: number; documentId: string }>();
  for (const offer of OFFERS.values())
    targets.set(generationKey(offer.tabId, offer.documentId), {
      tabId: offer.tabId,
      documentId: offer.documentId,
    });
  for (const key of GENERATIONS.keys()) {
    const separator = key.indexOf(':');
    const tabId = Number(key.slice(0, separator));
    const documentId = key.slice(separator + 1);
    if (Number.isInteger(tabId) && documentId) targets.set(key, { tabId, documentId });
  }
  return [...targets.values()];
}

function broadcastContextChanged(
  targets: Array<{ tabId: number; documentId: string }>,
  requery = true,
): void {
  for (const { tabId, documentId } of targets) {
    void chrome.tabs
      .sendMessage(
        tabId,
        {
          __matrx: true,
          kind: CHANNELS.CREDENTIAL_SUGGESTIONS_CONTEXT_CHANGED,
          payload: requery ? {} : { requery: false },
        },
        { documentId },
      )
      .catch(() => undefined);
  }
}

function expireOffer(id: string): void {
  const offer = OFFERS.get(id);
  if (!offer || offer.expiresAt > Date.now()) return;
  OFFERS.delete(id);
  setSavedLoginAssistance(offer.tabId, false);
  // Expiry must clear the mounted chooser, not immediately mint another offer.
  broadcastContextChanged([{ tabId: offer.tabId, documentId: offer.documentId }], false);
}

export function registerInlineCredentialSuggestionHost(): void {
  if (registered) return;
  registered = true;
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message !== 'object') return false;
    const env = message as { __matrx?: unknown; kind?: unknown; payload?: unknown };
    if (env.__matrx !== true) return false;
    if (env.kind === CHANNELS.AUTH_STATE_CHANGED) {
      const targets = contextTargets();
      invalidate();
      broadcastContextChanged(targets);
      return false;
    }
    if (env.kind === CHANNELS.CREDENTIAL_SUGGESTIONS_PANEL_STATUS) {
      if (!trustedSidepanel(sender) || !validPanelPayload(env.payload) || 'itemId' in env.payload)
        return false;
      void panelStatus(env.payload.tabId)
        .then(sendResponse)
        .catch(() => sendResponse({ status: 'none', itemIds: [] }));
      return true;
    }
    if (env.kind === CHANNELS.CREDENTIAL_SUGGESTIONS_PANEL_FILL) {
      if (
        !trustedSidepanel(sender) ||
        !validPanelPayload(env.payload) ||
        typeof env.payload.itemId !== 'string'
      )
        return false;
      void panelFill(env.payload.tabId, env.payload.itemId)
        .then(sendResponse)
        .catch(() => sendResponse(fillResponse('unavailable')));
      return true;
    }
    const tabId = sender.tab?.id;
    const documentId = (sender as chrome.runtime.MessageSender & { documentId?: unknown })
      .documentId;
    if (env.kind === CHANNELS.CREDENTIAL_SUGGESTIONS_QUERY) {
      if (
        tabId == null ||
        sender.frameId !== 0 ||
        typeof documentId !== 'string' ||
        !validQuery(env.payload)
      ) {
        sendResponse(response('unsafe_destination'));
        return false;
      }
      void query(tabId, documentId, env.payload.fieldSelector)
        .then(sendResponse)
        .catch(() => sendResponse(response('unavailable')));
      return true;
    }
    if (env.kind === CHANNELS.CREDENTIAL_SUGGESTIONS_FILL) {
      if (
        tabId == null ||
        sender.frameId !== 0 ||
        typeof documentId !== 'string' ||
        !validFill(env.payload)
      ) {
        sendResponse(fillResponse('stale'));
        return false;
      }
      void fill(tabId, documentId, env.payload)
        .then(sendResponse)
        .catch(() => sendResponse(fillResponse('unavailable')));
      return true;
    }
    if (env.kind === CHANNELS.CREDENTIAL_SUGGESTIONS_OPEN_VAULT) {
      if (tabId != null) void chrome.sidePanel.open({ tabId }).catch(() => undefined);
      sendResponse({ ok: tabId != null });
      return false;
    }
    return false;
  });
  chrome.tabs.onRemoved.addListener((tabId) => invalidate(tabId));
  chrome.tabs.onUpdated.addListener((tabId, change) => {
    if (change.status === 'loading' || change.url) invalidate(tabId);
  });
  chrome.tabs.onActivated.addListener((activeInfo) => {
    ACTIVATION_EPOCHS.set(activeInfo.windowId, activationEpoch(activeInfo.windowId) + 1);
    for (const offer of [...OFFERS.values()]) {
      if (offer.windowId !== activeInfo.windowId) continue;
      OFFERS.delete(offer.id);
      setSavedLoginAssistance(offer.tabId, false);
    }
    // The state projection is value-free. Consumers re-read rather than retain IDs.
    setSavedLoginAssistance(activeInfo.tabId, false);
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (
      area === 'local' &&
      ('matrx.settings.v1' in changes ||
        'matrx.org.active' in changes ||
        'matrx.auth.accessToken' in changes ||
        'matrx.user.profile' in changes)
    ) {
      const targets = contextTargets();
      invalidate();
      broadcastContextChanged(targets);
    }
  });
}
