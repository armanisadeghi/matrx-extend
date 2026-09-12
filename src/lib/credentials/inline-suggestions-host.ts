import {
  fetchBrowserLoginMatches,
  hasRealUserToken,
  materializeBrowserLogin,
} from '@/lib/api/routes/vault';
import { getCurrentUser } from '@/lib/auth/flow';
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

interface FormGroup {
  anchor: string;
  username: string | null;
  password: string | null;
  usernameOnly: boolean;
  pageUrl: string;
}
interface Offer extends FormGroup {
  id: string;
  tabId: number;
  documentId: string;
  organizationId: string;
  userId: string;
  itemIds: Set<string>;
  expiresAt: number;
}

const OFFERS = new Map<string, Offer>();
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
    (payload as { fieldSelector: string }).fieldSelector.length <= MAX_SELECTOR_LENGTH
  );
}
function validFill(payload: unknown): payload is { offerId: string; itemId: string } {
  return (
    !!payload &&
    typeof payload === 'object' &&
    typeof (payload as { offerId?: unknown }).offerId === 'string' &&
    typeof (payload as { itemId?: unknown }).itemId === 'string'
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
  if (!anchorIsPassword && !password) return null; // host applies saved-match gate to username-only
  const anchorSelector = selectorFor(anchor);
  if (!anchorSelector) return null;
  const usernameSelector = username ? selectorFor(username) : null;
  const passwordSelector = password ? selectorFor(password) : null;
  if ((username && !usernameSelector) || (password && !passwordSelector)) return null;
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

function fillBoundGroup(
  expected: FormGroup,
  username: string | undefined,
  password: string | undefined,
  sensitiveAttr: string,
): { ok: boolean } {
  const current = probeFocusedLoginGroup(expected.anchor);
  if (
    !current ||
    current.pageUrl !== expected.pageUrl ||
    current.username !== expected.username ||
    current.password !== expected.password
  )
    return { ok: false };
  const fields: Array<[string, string]> = [];
  if (current.username && username !== undefined) fields.push([current.username, username]);
  if (current.password && password !== undefined) fields.push([current.password, password]);
  if (fields.length === 0 || (current.password && password === undefined)) return { ok: false };
  for (const [selector] of fields) {
    const input = document.querySelector(selector);
    if (
      !(input instanceof HTMLInputElement) ||
      input.disabled ||
      input.readOnly ||
      input.type === 'hidden'
    )
      return { ok: false };
  }
  const written: HTMLInputElement[] = [];
  for (const [selector, value] of fields) {
    const input = document.querySelector(selector) as HTMLInputElement;
    const again = probeFocusedLoginGroup(expected.anchor);
    if (
      !again ||
      again.pageUrl !== expected.pageUrl ||
      again.username !== expected.username ||
      again.password !== expected.password ||
      document.querySelector(selector) !== input
    ) {
      for (const prior of written) {
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(prior), 'value')?.set;
        if (setter) setter.call(prior, '');
        else prior.value = '';
        prior.dispatchEvent(new Event('input', { bubbles: true }));
        prior.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return { ok: false };
    }
    input.setAttribute(sensitiveAttr, '');
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set;
    if (setter) setter.call(input, value);
    else input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    written.push(input);
  }
  return { ok: true };
}

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

async function context(): Promise<{ userId: string; organizationId: string } | null> {
  if (!(await hasRealUserToken())) return null;
  const [user, organizationId] = await Promise.all([getCurrentUser(), getActiveOrganizationId()]);
  return user?.id && organizationId ? { userId: user.id, organizationId } : null;
}

async function query(tabId: number, documentId: string, selector: string): Promise<QueryResponse> {
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
  if (!matches.ok)
    return response(
      matches.failure.kind === 'sign_in_required' ? 'sign_in_required' : 'unavailable',
    );
  // Username-only is permitted only after the server's canonical URL matcher has a match.
  const eligible = matches.data.matches.filter(
    (m) =>
      !group.usernameOnly ||
      m.available_fields?.some((f) => f.field_key === 'username' && f.fillable),
  );
  if (eligible.length === 0) return response('no_matches');
  purge(tabId); // a new focus invalidates all earlier offers in this tab
  const id = randomOfferId();
  OFFERS.set(id, {
    id,
    tabId,
    documentId,
    organizationId: actor.organizationId,
    userId: actor.userId,
    itemIds: new Set(eligible.map((m) => m.item_id)),
    expiresAt: Date.now() + OFFER_TTL_MS,
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
  if (data.origin !== new URL(offer.pageUrl).origin) {
    data.username = '';
    data.password = '';
    data.fields = {};
    return fillResponse('unsafe_destination');
  }
  const username = data.fields?.username ?? data.username;
  const password = data.fields?.password ?? data.password;
  const sensitive = [offer.username, offer.password].filter((x): x is string => !!x);
  rememberSensitiveFields(tabId, sensitive);
  try {
    const done = await inject<{ ok: boolean }>(tabId, documentId, fillBoundGroup, [
      offer,
      username,
      password,
      SENSITIVE_ATTR,
    ]).catch(() => null);
    return done?.ok ? fillResponse('filled') : fillResponse('stale');
  } finally {
    data.username = '';
    data.password = '';
    data.fields = {};
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
      purge();
      chrome.runtime
        .sendMessage({
          __matrx: true,
          kind: CHANNELS.CREDENTIAL_SUGGESTIONS_CONTEXT_CHANGED,
          payload: {},
        })
        .catch(() => undefined);
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
  chrome.tabs.onRemoved.addListener((tabId) => purge(tabId));
  chrome.tabs.onUpdated.addListener((tabId, change) => {
    if (change.status === 'loading' || change.url) purge(tabId);
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && ('matrx.settings.v1' in changes || 'matrx.org.active' in changes)) {
      purge();
      chrome.runtime
        .sendMessage({
          __matrx: true,
          kind: CHANNELS.CREDENTIAL_SUGGESTIONS_CONTEXT_CHANGED,
          payload: {},
        })
        .catch(() => undefined);
    }
  });
}
