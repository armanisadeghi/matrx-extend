/**
 * Login-form capture detector — CONTENT SCRIPT side of the "Save this login?"
 * flow. Mounted lazily by `src/lib/content/bridge.ts` on every top-frame page.
 *
 * What it does: when the user submits a form (or presses Enter / clicks a
 * submit control) that carries a filled password field, it snapshots
 * `{ loginUrl, username, password }` and hands it to the service worker in
 * ONE raw `chrome.runtime.sendMessage` envelope
 * (`CHANNELS.CREDENTIAL_CAPTURE_CANDIDATE`). That is the only value-bearing
 * message in the extension, so:
 *
 *   - it is sent RAW — never through `@/lib/messaging/native` (`send()` logs
 *     its payload);
 *   - it never touches `@/lib/debug/log`, `console`, or any storage;
 *   - the snapshot is a local variable that goes out of scope the moment the
 *     message is posted; nothing is retained in this module.
 *
 * The SW decides everything else (signed in? enabled? "never" for this site?
 * https? existing login to update?) and later asks THIS tab's content script
 * to show the prompt (`capture-prompt.ts`). The password never comes back.
 *
 * This file is part of the content bundle: keep it dependency-free beyond
 * `CHANNELS` — no zod, no React, no logging.
 */

import { CHANNELS } from '@/lib/messaging/schemas';

/** Wire shape of the one value-bearing envelope. Mirrored in capture-candidates.ts. */
export interface CaptureCandidateWire {
  loginUrl: string;
  username: string | null;
  password: string;
}

const MAX_USERNAME_LEN = 256;
const MAX_PASSWORD_LEN = 1024;
/** Don't re-send the same snapshot for a double submit (Enter + click). */
const DEDUPE_WINDOW_MS = 3000;

const USERNAME_HINT = /user|email|login|account|identifier|phone|mobile/i;
const USERNAME_AUTOCOMPLETE = /^(username|email|tel)$/i;

function isVisible(el: HTMLElement): boolean {
  if ((el as HTMLInputElement).disabled) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  const cs = window.getComputedStyle(el);
  return cs.display !== 'none' && cs.visibility !== 'hidden';
}

function isPasswordInput(el: Element | null): el is HTMLInputElement {
  return el instanceof HTMLInputElement && el.type === 'password';
}

function isOneTimeCode(input: HTMLInputElement): boolean {
  return (
    input.getAttribute('autocomplete') === 'one-time-code' ||
    /\b(otp|one[-_ ]?time|verification[-_ ]?code|mfa|2fa|totp)\b/i.test(
      `${input.name} ${input.id} ${input.getAttribute('aria-label') ?? ''} ${input.placeholder}`,
    )
  );
}

/**
 * The container to look for the username in: the password's <form>, else the
 * nearest ancestor that holds more than one input (SPA logins without <form>),
 * else the document body.
 */
function scopeOf(password: HTMLInputElement): HTMLElement {
  const form = password.closest('form');
  if (form) return form;
  let node: HTMLElement | null = password.parentElement;
  while (node && node !== document.body) {
    if (node.querySelectorAll('input').length > 1) return node;
    node = node.parentElement;
  }
  return document.body;
}

function findUsername(password: HTMLInputElement): string | null {
  const scope = scopeOf(password);
  const textInputs = Array.from(
    scope.querySelectorAll<HTMLInputElement>(
      'input[type="text"], input[type="email"], input[type="tel"], input:not([type])',
    ),
  ).filter((i) => isVisible(i) && i.value.trim().length > 0);

  const pick =
    // 1. explicit autocomplete contract wins
    textInputs.find((i) => USERNAME_AUTOCOMPLETE.test(i.getAttribute('autocomplete') ?? '')) ??
    // 2. name / id / placeholder / label heuristic
    textInputs.find((i) =>
      USERNAME_HINT.test(
        `${i.name} ${i.id} ${i.placeholder} ${i.getAttribute('aria-label') ?? ''}`,
      ),
    ) ??
    // 3. the last filled text input before the password
    [...textInputs]
      .reverse()
      .find((i) => {
        const pos = password.compareDocumentPosition(i);
        return (pos & Node.DOCUMENT_POSITION_PRECEDING) !== 0;
      }) ??
    null;

  // Two-step logins (username on the previous screen) leave nothing visible:
  // some sites keep the identifier in a hidden input — accept that as a last
  // resort, value only, never a guess from page text.
  if (!pick) {
    const hidden = Array.from(
      scope.querySelectorAll<HTMLInputElement>('input[type="hidden"]'),
    ).find((i) => USERNAME_HINT.test(`${i.name} ${i.id}`) && i.value.trim().length > 0);
    if (hidden) return hidden.value.trim().slice(0, MAX_USERNAME_LEN);
  }
  return pick ? pick.value.trim().slice(0, MAX_USERNAME_LEN) : null;
}

/**
 * Build the snapshot for a submission anchored at `anchor` (the submitted form,
 * or the element the Enter / click landed on). Returns null when this is not a
 * login we can capture safely:
 *   - no visible, filled password field;
 *   - several filled password fields with DIFFERENT values (a change-password
 *     form — which one is "the" password is ambiguous);
 *   - the form submits with GET (the password would land in the URL);
 *   - a one-time-code box masquerading as a password.
 */
export function snapshotLogin(
  anchor: Element | null,
  doc: Document = document,
): CaptureCandidateWire | null {
  const form = anchor?.closest('form') ?? null;
  const root: ParentNode = form ?? doc;
  const passwords = Array.from(
    root.querySelectorAll<HTMLInputElement>('input[type="password"]'),
  ).filter((i) => isVisible(i) && i.value.length > 0 && !isOneTimeCode(i));
  if (passwords.length === 0) return null;
  if (form && (form.getAttribute('method') ?? 'get').toLowerCase() === 'get') return null;

  const distinct = new Set(passwords.map((p) => p.value));
  if (distinct.size > 1) return null;

  const password = passwords[passwords.length - 1] as HTMLInputElement;
  const value = password.value;
  if (value.length > MAX_PASSWORD_LEN) return null;

  return {
    loginUrl: doc.location.href,
    username: findUsername(password),
    password: value,
  };
}

/** Raw send — deliberately not `@/lib/messaging/native#send` (it logs payloads). */
function postCandidate(candidate: CaptureCandidateWire): void {
  try {
    if (!chrome.runtime?.id) return;
    chrome.runtime
      .sendMessage({
        __matrx: true,
        kind: CHANNELS.CREDENTIAL_CAPTURE_CANDIDATE,
        payload: candidate,
      })
      .catch(() => undefined);
  } catch {
    // orphaned content script — nothing to do
  }
}

/**
 * Install the listeners. Idempotent per document. Returns a disposer (tests).
 */
export function mountCaptureDetector(doc: Document = document): () => void {
  let lastKey = '';
  let lastAt = 0;

  const consider = (anchor: Element | null) => {
    const snap = snapshotLogin(anchor, doc);
    if (!snap) return;
    // Dedupe Enter-then-click on the same values without keeping the values:
    // compare lengths + a cheap non-reversible fold of the password.
    let fold = 0;
    for (let i = 0; i < snap.password.length; i++)
      fold = (fold * 31 + snap.password.charCodeAt(i)) | 0;
    const key = `${snap.loginUrl}|${snap.username ?? ''}|${snap.password.length}|${fold}`;
    const now = Date.now();
    if (key === lastKey && now - lastAt < DEDUPE_WINDOW_MS) return;
    lastKey = key;
    lastAt = now;
    postCandidate(snap);
  };

  // Real form submission (capture phase so a handler that stops propagation or
  // calls preventDefault + fetch() still lets us see it).
  const onSubmit = (e: Event) => consider(e.target instanceof Element ? e.target : null);
  // Enter inside a password box — SPA logins often have no <form>.
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    if (isPasswordInput(e.target as Element | null)) consider(e.target as Element);
  };
  // A submit-looking control clicked near a filled password box.
  const onClick = (e: MouseEvent) => {
    const target = e.target instanceof Element ? e.target : null;
    const control = target?.closest('button, input[type="submit"], [role="button"]') ?? null;
    if (!control) return;
    const form = control.closest('form');
    if (form) {
      consider(control);
      return;
    }
    // No form: only act when a filled password input lives in the same
    // container — otherwise every button on the page would be a candidate.
    let node: HTMLElement | null = control.parentElement;
    for (let depth = 0; node && depth < 6; depth++, node = node.parentElement) {
      if (
        Array.from(node.querySelectorAll<HTMLInputElement>('input[type="password"]')).some(
          (i) => i.value.length > 0,
        )
      ) {
        consider(control);
        return;
      }
    }
  };

  doc.addEventListener('submit', onSubmit, true);
  doc.addEventListener('keydown', onKeyDown, true);
  doc.addEventListener('click', onClick, true);
  return () => {
    doc.removeEventListener('submit', onSubmit, true);
    doc.removeEventListener('keydown', onKeyDown, true);
    doc.removeEventListener('click', onClick, true);
  };
}
