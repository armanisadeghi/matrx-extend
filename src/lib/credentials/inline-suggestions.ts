import { mountGenerationTargetRegistry } from '@/lib/credentials/generation-targets';
/** Metadata-only, closed-shadow chooser for eligible focused login controls. */
import { CHANNELS } from '@/lib/messaging/schemas';
import { readCredentialAssistancePresentation } from '@/lib/settings/persisted';

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
type FillResponse = { status: string; message: string };

const HOST_ID = 'matrx-inline-login-suggestion';
let host: HTMLElement | null = null;
let generation = 0;
let focused: HTMLInputElement | null = null;
let presentation: 'quiet' | 'on_page' = 'quiet';
let focusEntry: { target: HTMLInputElement; listener: (event: KeyboardEvent) => void } | null =
  null;
let focusSequence = 0;
let lastFocusedTarget: HTMLInputElement | null = null;
let lastFocusReport: Promise<void> | null = null;

function deepActive(root: Document | ShadowRoot = document): Element | null {
  let active: Element | null = root.activeElement;
  while (active instanceof HTMLElement && active.shadowRoot?.mode === 'open')
    active = active.shadowRoot.activeElement;
  return active;
}
function openComposedInput(event: Event): HTMLInputElement | null {
  for (const node of event.composedPath()) {
    if (!(node instanceof HTMLInputElement)) continue;
    const root = node.getRootNode();
    if (root === document || (root instanceof ShadowRoot && root.mode === 'open')) return node;
  }
  return null;
}

function dismiss(): void {
  generation++;
  if (focusEntry) {
    focusEntry.target.removeEventListener('keydown', focusEntry.listener, true);
    focusEntry = null;
  }
  host?.remove();
  host = null;
}
function invalidate(): void {
  dismiss();
  focused = null;
}
function focusIsInChooser(): boolean {
  // A focused element in a closed shadow root is exposed as its host to the
  // page document. This keeps a pointer click alive through its click handler.
  return document.activeElement === host;
}
function send(kind: string, payload: unknown): Promise<unknown> {
  return chrome.runtime.sendMessage({ __matrx: true, kind, payload });
}
function place(target: HTMLInputElement): void {
  if (!host) return;
  const rect = target.getBoundingClientRect();
  const margin = 8;
  const below = rect.bottom + 6;
  const roomBelow = Math.max(0, window.innerHeight - below - margin);
  const roomAbove = Math.max(0, rect.top - 6 - margin);
  const showBelow = roomBelow >= roomAbove;
  const top = showBelow ? below : Math.max(margin, rect.top - 6 - Math.min(168, roomAbove));
  host.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 300))}px`;
  host.style.top = `${Math.max(margin, top)}px`;
  // The card scrolls within the space actually remaining after its placement;
  // it never extends below the visual viewport on a short page.
  host.style.setProperty(
    '--matrx-inline-max-height',
    `${Math.max(0, window.innerHeight - Math.max(margin, top) - margin)}px`,
  );
}

function reportFocus(event?: Event, target?: HTMLInputElement): Promise<void> {
  const stamp = performance.timeOrigin + (event?.timeStamp ?? performance.now());
  const sequence = ++focusSequence;
  const reported = send(CHANNELS.CREDENTIAL_SUGGESTIONS_FOCUS_OWNER, { stamp, sequence })
    .then(() => undefined)
    .catch(() => undefined);
  if (target) {
    lastFocusedTarget = target;
    lastFocusReport = reported;
  }
  return reported;
}
function requestFor(target: HTMLInputElement, reported?: Promise<void>): void {
  focused = target;
  dismiss();
  const ownerReport =
    reported ??
    (lastFocusedTarget === target
      ? lastFocusReport
      : document.hasFocus() && deepActive() === target
        ? reportFocus(undefined, target)
        : null);
  if (!ownerReport) return;
  const id = mountGenerationTargetRegistry().registerInput(target);
  if (!id) return;
  const token = ++generation;
  const requestUrl = location.href;
  void ownerReport
    .then(() =>
      send(CHANNELS.CREDENTIAL_SUGGESTIONS_QUERY, { field: { kind: 'registered_input', id } }),
    )
    .then((raw) => render(target, raw as QueryResponse, token, requestUrl))
    .catch(() => undefined);
}

function render(
  target: HTMLInputElement,
  response: QueryResponse,
  token: number,
  requestUrl: string,
): void {
  if (
    token !== generation ||
    focused !== target ||
    deepActive() !== target ||
    location.href !== requestUrl
  ) {
    return;
  }
  dismiss();
  // A focus-triggered lookup is not a request to interrupt the page. Only a
  // usable saved-login choice earns page UI; errors remain explicit when a
  // person deliberately asks the Vault to fill a login.
  if (presentation !== 'on_page' || response.status !== 'ready' || response.matches.length === 0)
    return;
  host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;';
  const shadow = host.attachShadow({ mode: 'closed' });
  const card = document.createElement('div');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'Saved logins from Matrx Vault');
  card.style.cssText =
    'all:initial;display:block;box-sizing:border-box;width:292px;max-width:calc(100vw - 16px);max-height:var(--matrx-inline-max-height,168px);overflow:auto;padding:8px;background:#fff;color:#171717;border:1px solid #d4d4d4;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.18);font:13px/1.35 system-ui,-apple-system,Segoe UI,sans-serif;';
  const title = document.createElement('button');
  title.type = 'button';
  title.textContent = 'Matrx — choose a saved login (Arrow Down to browse)';
  title.setAttribute('aria-label', 'Matrx saved logins. Press Arrow Down to browse.');
  title.setAttribute('aria-expanded', 'false');
  title.style.cssText =
    'all:initial;display:block;font:600 12px/1.4 system-ui,-apple-system,Segoe UI,sans-serif;margin:0 0 6px;color:#333;cursor:pointer;outline:2px solid transparent;outline-offset:2px;';
  title.addEventListener('focus', () => title.style.setProperty('outline', '2px solid #2563eb'));
  title.addEventListener('blur', () => title.style.removeProperty('outline'));
  card.append(title);
  const buttons: HTMLButtonElement[] = [];
  for (const match of response.matches) {
    const button = document.createElement('button');
    button.type = 'button';
    button.hidden = true;
    button.textContent = match.display_name;
    button.style.cssText =
      'all:initial;box-sizing:border-box;width:100%;padding:7px 8px;margin:1px 0;border-radius:5px;cursor:pointer;font:13px/1.3 system-ui,-apple-system,Segoe UI,sans-serif;color:#171717;';
    button.addEventListener('focus', () =>
      button.style.setProperty('outline', '2px solid #2563eb'),
    );
    button.addEventListener('blur', () => button.style.removeProperty('outline'));
    button.addEventListener('mouseenter', () => button.style.setProperty('background', '#f0f0f0'));
    button.addEventListener('mouseleave', () => button.style.removeProperty('background'));
    button.addEventListener('click', () => {
      for (const b of buttons) b.disabled = true;
      void send(CHANNELS.CREDENTIAL_SUGGESTIONS_FILL, {
        offerId: response.offerId,
        itemId: match.item_id,
      })
        .then((raw) => raw as FillResponse)
        .then((result) => {
          if (result.status === 'filled') {
            target.focus();
            dismiss();
          } else {
            title.textContent = result.message;
          }
        })
        .catch(() => {
          title.textContent = 'Saved logins are unavailable right now.';
        });
    });
    buttons.push(button);
    card.append(button);
  }
  const expandChoices = (): void => {
    title.setAttribute('aria-expanded', 'true');
    for (const button of buttons) {
      button.hidden = false;
      button.style.setProperty('display', 'block');
    }
    buttons[0]?.focus();
  };
  title.addEventListener('click', expandChoices);
  shadow.append(card);
  document.documentElement.append(host);
  place(target);
  const entryListener = (event: KeyboardEvent): void => {
    if (
      !event.isTrusted ||
      event.key !== 'ArrowDown' ||
      deepActive() !== target ||
      focused !== target ||
      host?.id !== HOST_ID
    ) {
      return;
    }
    event.preventDefault();
    expandChoices();
  };
  focusEntry = { target, listener: entryListener };
  target.addEventListener('keydown', entryListener, true);
  card.addEventListener('keydown', (event) => {
    const index = buttons.indexOf(shadow.activeElement as HTMLButtonElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      target.focus();
      invalidate();
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      buttons[
        (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
      ]?.focus();
    }
    if (event.key === 'Enter' && index >= 0) {
      event.preventDefault();
      buttons[index]?.click();
    }
  });
}

export function mountInlineCredentialSuggestions(): () => void {
  const navigationApi = (globalThis as typeof globalThis & { navigation?: EventTarget }).navigation;
  void readCredentialAssistancePresentation().then((value) => {
    presentation = value;
    const target = deepActive();
    if (target instanceof HTMLInputElement && target !== focused) requestFor(target);
  });
  const onFocusIn = (event: FocusEvent): void => {
    if (!event.isTrusted || !document.hasFocus()) return;
    const target = openComposedInput(event);
    if (event.target === host) return;
    const reported = reportFocus(event, target ?? undefined);
    if (!target || (target === focused && host)) return;
    requestFor(target, reported);
  };
  const onWindowFocus = (event: FocusEvent): void => {
    if (!event.isTrusted || !document.hasFocus()) return;
    const target = deepActive();
    if (!(target instanceof HTMLInputElement)) {
      reportFocus(event);
      return;
    }
    const reported = reportFocus(event, target);
    // A browser can restore window focus without another focusin. Wait one
    // report turn so a following focusin wins; otherwise mint a fresh offer
    // for this still-focused credential control.
    void reported.then(() => {
      if (lastFocusReport === reported && document.hasFocus() && deepActive() === target)
        requestFor(target, reported);
    });
  };
  const onFocusOut = (): void => {
    window.setTimeout(() => {
      const active = deepActive();
      if (active !== focused && !focusIsInChooser()) invalidate();
    }, 0);
  };
  const onInput = (event: Event): void => {
    if (openComposedInput(event) === focused) invalidate();
  };
  const onPointerDown = (event: PointerEvent): void => {
    if (
      (focused !== null && openComposedInput(event) === focused) ||
      (host !== null && event.composedPath().includes(host))
    )
      return;
    if (event.isTrusted && document.hasFocus()) reportFocus(event);
    invalidate();
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && (deepActive() === focused || focusIsInChooser())) {
      invalidate();
    }
  };
  const onViewportChange = (): void => {
    if (focused?.isConnected) place(focused);
  };
  const onContextChanged = (message: unknown): boolean => {
    const env = message as {
      __matrx?: unknown;
      kind?: unknown;
      payload?: { requery?: unknown };
    } | null;
    if (env?.__matrx === true && env.kind === CHANNELS.CREDENTIAL_SUGGESTIONS_CONTEXT_CHANGED) {
      const target = focused;
      invalidate();
      if (env.payload?.requery !== false && target?.isConnected && deepActive() === target)
        requestFor(target);
    }
    return false;
  };
  const removalObserver = new MutationObserver(() => {
    if (focused && !focused.isConnected) invalidate();
  });

  document.addEventListener('focusin', onFocusIn, true);
  window.addEventListener('focus', onWindowFocus, true);
  document.addEventListener('focusout', onFocusOut, true);
  document.addEventListener('input', onInput, true);
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('scroll', onViewportChange, { passive: true });
  window.addEventListener('resize', onViewportChange);
  window.addEventListener('pagehide', invalidate);
  window.addEventListener('beforeunload', invalidate);
  window.addEventListener('popstate', invalidate);
  window.addEventListener('hashchange', invalidate);
  navigationApi?.addEventListener('currententrychange', invalidate);
  removalObserver.observe(document.documentElement, { childList: true, subtree: true });
  chrome.runtime.onMessage.addListener(onContextChanged);
  const onStorageChanged = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string,
  ) => {
    if (area !== 'local' || !('matrx.settings.v1' in changes)) return;
    void readCredentialAssistancePresentation().then((value) => {
      presentation = value;
      invalidate();
      const target = deepActive();
      if (target instanceof HTMLInputElement) requestFor(target);
    });
  };
  chrome.storage?.onChanged?.addListener(onStorageChanged);

  return () => {
    invalidate();
    lastFocusedTarget = null;
    lastFocusReport = null;
    document.removeEventListener('focusin', onFocusIn, true);
    window.removeEventListener('focus', onWindowFocus, true);
    document.removeEventListener('focusout', onFocusOut, true);
    document.removeEventListener('input', onInput, true);
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('scroll', onViewportChange);
    window.removeEventListener('resize', onViewportChange);
    window.removeEventListener('pagehide', invalidate);
    window.removeEventListener('beforeunload', invalidate);
    window.removeEventListener('popstate', invalidate);
    window.removeEventListener('hashchange', invalidate);
    navigationApi?.removeEventListener('currententrychange', invalidate);
    removalObserver.disconnect();
    chrome.runtime.onMessage.removeListener(onContextChanged);
    chrome.storage?.onChanged?.removeListener(onStorageChanged);
  };
}
