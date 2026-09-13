import {
  fetchBrowserLoginMatches,
  hasRealUserToken,
  materializeBrowserLogin,
} from '@/lib/api/routes/vault';
import { getCurrentUser } from '@/lib/auth/flow';
import {
  type BoundLoginGroup,
  credentialDomSource,
  type CredentialDomInjectedRequest,
  type CredentialDomResult,
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
  documentId: string;
  organizationId: string;
  userId: string;
  itemIds: Set<string>;
  expiresAt: number;
  generation: number;
}

const OFFERS = new Map<string, Offer>();
const GENERATIONS = new Map<string, number>();
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

function response(status: keyof typeof COPY): QueryResponse {
  return { status: status as Exclude<QueryResponse['status'], 'ready'>, message: COPY[status] };
}
function fillResponse(status: FillResponse['status']): FillResponse {
  return { status, message: COPY[status] };
}
function purge(tabId?: number): void {
  for (const [id, offer] of OFFERS)
    if (tabId === undefined || offer.tabId === tabId) OFFERS.delete(id);
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
  if (!canTargetCurrentDocument()) return response('unavailable');
  if (!(await isCurrentTopDocument(tabId, documentId))) return response('unavailable');
  if (!(await readOfferSavedLoginsEnabled())) return response('unavailable');
  if (!(await hasRealUserToken())) return response('sign_in_required');
  const actor = await context();
  if (!actor) return response('organization_required');
  const group = await injectCredentialDom(tabId, documentId, { operation: 'focused_group', selector }).catch(() => null);
  if (!group) return response('unsafe_destination');
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
  const actorAfterMatches = await context();
  if (
    !actorAfterMatches ||
    actorAfterMatches.userId !== actor.userId ||
    actorAfterMatches.organizationId !== actor.organizationId
  )
    return response('organization_required');
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
  const id = randomOfferId();
  OFFERS.set(id, {
    id,
    tabId,
    documentId,
    organizationId: actor.organizationId,
    userId: actor.userId,
    itemIds: new Set(eligible.map((m) => m.item_id)),
    expiresAt: Date.now() + OFFER_TTL_MS,
    generation,
    ...group,
  });
  return {
    status: 'ready',
    offerId: id,
    matches: eligible.map(({ item_id, display_name }) => ({ item_id, display_name })),
  };
}

async function fill(
  tabId: number,
  documentId: string,
  payload: { offerId: string; itemId: string },
): Promise<FillResponse> {
  const offer = OFFERS.get(payload.offerId);
  OFFERS.delete(payload.offerId); // claim before async work: duplicate clicks cannot fill twice
  if (
    !offer ||
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
  const current = await injectCredentialDom(tabId, documentId, { operation: 'focused_group', selector: offer.anchor }).catch(() => null);
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

function broadcastContextChanged(targets: Array<{ tabId: number; documentId: string }>): void {
  for (const { tabId, documentId } of targets) {
    void chrome.tabs
      .sendMessage(
        tabId,
        {
          __matrx: true,
          kind: CHANNELS.CREDENTIAL_SUGGESTIONS_CONTEXT_CHANGED,
          payload: {},
        },
        { documentId },
      )
      .catch(() => undefined);
  }
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
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && ('matrx.settings.v1' in changes || 'matrx.org.active' in changes)) {
      const targets = contextTargets();
      invalidate();
      broadcastContextChanged(targets);
    }
  });
}
