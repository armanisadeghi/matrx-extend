/** Metadata-only, closed-shadow chooser for eligible focused login controls. */
import { CHANNELS } from '@/lib/messaging/schemas';

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
let focusEntry: { target: HTMLInputElement; listener: (event: KeyboardEvent) => void } | null =
  null;

function selectorFor(input: HTMLInputElement): string | null {
  const escapeSelector = (value: string) =>
    globalThis.CSS?.escape?.(value) ?? value.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  if (input.id) {
    const selector = `#${escapeSelector(input.id)}`;
    if (document.querySelectorAll(selector).length === 1) return selector;
  }
  const name = input.getAttribute('name');
  if (name) {
    const selector = `input[name="${escapeSelector(name)}"]`;
    if (document.querySelectorAll(selector).length === 1) return selector;
  }
  const parts: string[] = [];
  let node: Element | null = input;
  while (node && node !== document.body && parts.length < 8) {
    const parent: Element | null = node.parentElement;
    if (!parent) return null;
    const current = node;
    const siblings = Array.from(parent.children).filter(
      (child: Element) => child.tagName === current.tagName,
    );
    parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(node) + 1})`);
    node = parent;
  }
  const selector = parts.join(' > ');
  return selector && document.querySelectorAll(selector).length === 1 ? selector : null;
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

function requestFor(target: HTMLInputElement): void {
  focused = target;
  dismiss();
  const selector = selectorFor(target);
  if (!selector) return;
  const token = ++generation;
  void send(CHANNELS.CREDENTIAL_SUGGESTIONS_QUERY, { fieldSelector: selector })
    .then((raw) => render(target, raw as QueryResponse, token))
    .catch(() => undefined);
}

function render(target: HTMLInputElement, response: QueryResponse, token: number): void {
  if (token !== generation || focused !== target) return;
  dismiss();
  if (response.status !== 'ready') {
    // Explicit focus is still an interaction: show a bounded, actionable
    // explanation instead of silently discarding a recoverable state.
    host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;';
    const shadow = host.attachShadow({ mode: 'closed' });
    const message = document.createElement('button');
    message.type = 'button';
    message.textContent =
      response.status === 'organization_required'
        ? 'Choose organization in Matrx'
        : response.status === 'sign_in_required'
          ? 'Open Vault to sign in'
          : response.message;
    message.setAttribute('aria-label', response.message);
    message.style.cssText =
      'all:initial;display:block;box-sizing:border-box;max-width:292px;max-height:var(--matrx-inline-max-height,168px);overflow:auto;padding:8px;border:1px solid #d4d4d4;border-radius:8px;background:#fff;color:#333;cursor:pointer;font:12px/1.35 system-ui,-apple-system,Segoe UI,sans-serif;outline:2px solid transparent;outline-offset:2px;';
    message.addEventListener('focus', () =>
      message.style.setProperty('outline', '2px solid #2563eb'),
    );
    message.addEventListener('blur', () => message.style.removeProperty('outline'));
    message.addEventListener(
      'click',
      () => void send(CHANNELS.CREDENTIAL_SUGGESTIONS_OPEN_VAULT, {}),
    );
    shadow.append(message);
    document.documentElement.append(host);
    place(target);
    return;
  }
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
      document.activeElement !== target ||
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
      dismiss();
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

export function mountInlineCredentialSuggestions(): void {
  document.addEventListener(
    'focusin',
    (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement) || (target === focused && host)) return;
      requestFor(target);
    },
    true,
  );
  document.addEventListener(
    'focusout',
    () => {
      window.setTimeout(() => {
        const active = document.activeElement;
        if (active !== focused && !focusIsInChooser()) dismiss();
      }, 0);
    },
    true,
  );
  window.addEventListener('scroll', () => focused && place(focused), { passive: true });
  window.addEventListener('resize', () => focused && place(focused));
  window.addEventListener('pagehide', dismiss);
  chrome.runtime.onMessage.addListener((message) => {
    const env = message as { __matrx?: unknown; kind?: unknown } | null;
    if (env?.__matrx === true && env.kind === CHANNELS.CREDENTIAL_SUGGESTIONS_CONTEXT_CHANGED) {
      const target = focused;
      dismiss();
      if (target?.isConnected && document.activeElement === target) requestFor(target);
    }
    return false;
  });
}
