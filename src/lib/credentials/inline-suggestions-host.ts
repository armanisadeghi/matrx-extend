import {
  fetchBrowserLoginMatches,
  hasRealUserToken,
  materializeBrowserLogin,
} from '@/lib/api/routes/vault';
import { getCurrentUser } from '@/lib/auth/flow';
import {
  type BoundLoginGroup,
  fillControlledCredentialFieldsSource,
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

/** Runs in the page and reads only field shape/identity, never current values. */
function probeFocusedLoginGroup(selector: string): FormGroup | null {
  function visibleEditable(input: HTMLInputElement): boolean {
    const r = input.getBoundingClientRect();
    const style = getComputedStyle(input);
    return (
      !input.disabled &&
      !input.readOnly &&
      r.width > 0 &&
      r.height > 0 &&
      style.display !== 'none' &&
      style.visibility !== 'hidden'
    );
  }
  function selectorFor(input: HTMLInputElement): string | null {
    const escapeSelector = (value: string) =>
      globalThis.CSS?.escape?.(value) ?? value.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
    const id = input.id;
    if (id && document.querySelectorAll(`#${escapeSelector(id)}`).length === 1)
      return `#${escapeSelector(id)}`;
    const name = input.getAttribute('name');
    if (name) {
      const candidate = `input[name="${escapeSelector(name)}"]`;
      if (document.querySelectorAll(candidate).length === 1) return candidate;
    }
    const parts: string[] = [];
    let node: Element | null = input;
    while (node && node !== document.body && parts.length < 8) {
      const parent: Element | null = node.parentElement;
      if (!parent) return null;
      const current = node;
      const siblings = Array.from(parent.children).filter(
        (x: Element) => x.tagName === current.tagName,
      );
      const index = siblings.indexOf(node) + 1;
      parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${index})`);
      node = parent;
    }
    const candidate = parts.join(' > ');
    return candidate && document.querySelectorAll(candidate).length === 1 ? candidate : null;
  }
  let anchor: HTMLInputElement | null = null;
  try {
    const matches = document.querySelectorAll(selector);
    if (matches.length !== 1 || !(matches[0] instanceof HTMLInputElement)) return null;
    anchor = matches[0];
  } catch {
    return null;
  }
  if (!visibleEditable(anchor)) return null;
  const autocomplete = (anchor.autocomplete || '').toLowerCase();
  const type = (anchor.type || 'text').toLowerCase();
  if (
    autocomplete === 'one-time-code' ||
    autocomplete === 'new-password' ||
    /otp|mfa|2fa|verification|confirm/i.test(`${anchor.name} ${anchor.id} ${anchor.placeholder}`)
  )
    return null;
  const scope = anchor.closest('form') ?? anchor.parentElement ?? document.body;
  const inputs = Array.from(scope.querySelectorAll<HTMLInputElement>('input')).filter(
    visibleEditable,
  );
  const password =
    inputs.find(
      (i) =>
        (i.type || '').toLowerCase() === 'password' &&
        i.autocomplete.toLowerCase() !== 'new-password',
    ) ?? null;
  const username =
    inputs.find((i) => /^(username|email)$/i.test(i.autocomplete)) ??
    inputs.find(
      (i) =>
        /^(text|email|tel)$/i.test((i.type || 'text').toLowerCase()) &&
        /user|email|login|account|identifier/i.test(
          `${i.name} ${i.id} ${i.placeholder} ${i.getAttribute('aria-label') ?? ''}`,
        ),
    ) ??
    null;
  const anchorIsPassword = type === 'password' && autocomplete !== 'new-password';
  const anchorIsUsername = autocomplete === 'username';
  if (!anchorIsPassword && !anchorIsUsername) return null;
  // A username-only step is valid when its autocomplete is explicit; the
  // host requires a canonical saved-origin match before it displays a choice.
  const anchorSelector = selectorFor(anchor);
  if (!anchorSelector) return null;
  const usernameSelector = username ? selectorFor(username) : null;
  const passwordSelector = password ? selectorFor(password) : null;
  if ((username && !usernameSelector) || (password && !passwordSelector)) return null;
  const confirmation = inputs.filter(
    (i) => (i.type || '').toLowerCase() === 'password' && i !== password,
  );
  if (confirmation.length > 0) return null;
  const form = anchor.closest('form');
  const action = form?.getAttribute('action');
  if (
    form &&
    ((form.method || 'get').toLowerCase() === 'get' ||
      (action && new URL(action, location.href).origin !== location.origin) ||
      (action &&
        new URL(action, location.href).protocol !== 'https:' &&
        location.protocol !== 'http:'))
  )
    return null;
  return {
    anchor: anchorSelector,
    username: usernameSelector,
    password: passwordSelector,
    usernameOnly: !passwordSelector,
    pageUrl: `${location.origin}${location.pathname}`,
  };
}

/** Test seam: callers must remain serializable across the scripting boundary. */
export const __inlineFillSerializedSourceForTest = fillControlledCredentialFieldsSource.toString();

async function inject<T>(
  tabId: number,
  documentId: string,
  func: (...args: never[]) => T,
  args: unknown[],
): Promise<T | null> {
  const target = { tabId, documentIds: [documentId] } as chrome.scripting.InjectionTarget;
  const [first] = await chrome.scripting.executeScript({
    target,
    func: func as (...a: unknown[]) => T,
    args,
  });
  return (first?.result as T | undefined) ?? null;
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
  const group = await inject<FormGroup | null>(tabId, documentId, probeFocusedLoginGroup, [
    selector,
  ]).catch(() => null);
  if (!group) return response('unsafe_destination');
  const url = new URL(group.pageUrl);
  if (!isSafeDestination(url) || !normalizeLoginUrl(group.pageUrl))
    return response('unsafe_destination');
  const matches = await fetchBrowserLoginMatches(group.pageUrl, { includeFieldInventory: true });
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
  const current = await inject<FormGroup | null>(tabId, documentId, probeFocusedLoginGroup, [
    offer.anchor,
  ]).catch(() => null);
  if (
    !current ||
    current.pageUrl !== offer.pageUrl ||
    current.username !== offer.username ||
    current.password !== offer.password
  )
    return fillResponse('stale');
  const materialized = await materializeBrowserLogin(payload.itemId, {
    pageUrl: offer.pageUrl,
    toolInvocationId: `inline-${offer.id}`,
    clientBuild: chrome.runtime.getManifest().version,
    fieldKeys: current.usernameOnly ? ['username'] : ['username', 'password'],
  });
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
    const done = await inject<{ ok: boolean }>(
      tabId,
      documentId,
      fillControlledCredentialFieldsSource,
      [
        offer,
        [
          ...(offer.username ? [{ selector: offer.username, value: username ?? null }] : []),
          ...(offer.password ? [{ selector: offer.password, value: password ?? null }] : []),
        ],
        SENSITIVE_ATTR,
        false,
      ],
    ).catch(() => null);
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
