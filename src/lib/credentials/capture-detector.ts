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
  stage: 'username_first' | 'password';
  loginUrl: string;
  username: string | null;
  password?: string;
}

const MAX_USERNAME_LEN = 256;
const MAX_PASSWORD_LEN = 1024;
/** Don't re-send the same snapshot for a double submit (Enter + click). */
const DEDUPE_WINDOW_MS = 3000;

function isVisibleEditable(input: HTMLInputElement): boolean {
  if (input.disabled || input.readOnly || input.type === 'hidden') return false;
  const rect = input.getBoundingClientRect();
  const style = window.getComputedStyle(input);
  return (
    rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'
  );
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
 * A submitted form, or the nearest bounded form-less control group. Never
 * fall back to the document: unrelated password boxes must not join a capture.
 */
function coherentGroup(anchor: Element | null): HTMLElement | null {
  const form = anchor?.closest('form');
  if (form) return form;
  for (
    let node = anchor instanceof HTMLElement ? anchor : null, depth = 0;
    node && depth < 6;
    node = node.parentElement, depth++
  ) {
    const inputs = Array.from(node.querySelectorAll('input'));
    if (inputs.length >= 2 && inputs.length <= 12 && inputs.some((input) => isPasswordInput(input)))
      return node;
  }
  return null;
}

function findUsername(group: HTMLElement): string | null {
  const inputs = Array.from(group.querySelectorAll<HTMLInputElement>('input')).filter(
    (input) =>
      isVisibleEditable(input) &&
      input.value.trim().length > 0 &&
      /^(text|email|tel|search)$/i.test(input.type || 'text'),
  );
  const explicit = inputs.find((input) => input.autocomplete.toLowerCase() === 'username');
  if (explicit) return explicit.value.trim().slice(0, MAX_USERNAME_LEN);
  const hinted = inputs.find((input) =>
    /user|email|login|account|identifier/i.test(
      `${input.name} ${input.id} ${input.placeholder} ${input.getAttribute('aria-label') ?? ''}`,
    ),
  );
  return hinted ? hinted.value.trim().slice(0, MAX_USERNAME_LEN) : null;
}

function safeAction(
  form: HTMLFormElement | null,
  submitter: Element | null,
  doc: Document,
): boolean {
  if (!form) return true;
  const control =
    submitter instanceof HTMLButtonElement || submitter instanceof HTMLInputElement
      ? submitter
      : null;
  const method = (
    control?.getAttribute('formmethod') ??
    form.getAttribute('method') ??
    'get'
  ).toLowerCase();
  if (method === 'get') return false;
  const rawAction =
    control?.getAttribute('formaction') ?? form.getAttribute('action') ?? doc.location.href;
  try {
    const action = new URL(rawAction, doc.location.href);
    const loopback = /^(localhost|127\.0\.0\.1|\[::1\]|::1)$/.test(action.hostname);
    return (
      action.origin === doc.location.origin &&
      (action.protocol === 'https:' || (action.protocol === 'http:' && loopback))
    );
  } catch {
    return false;
  }
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
  const group = coherentGroup(anchor);
  if (!group) return null;
  const form = group instanceof HTMLFormElement ? group : null;
  if (!safeAction(form, anchor, doc)) return null;
  const passwords = Array.from(
    group.querySelectorAll<HTMLInputElement>('input[type="password"]'),
  ).filter((input) => isVisibleEditable(input) && input.value.length > 0 && !isOneTimeCode(input));
  if (passwords.length === 0) {
    const username = Array.from(group.querySelectorAll<HTMLInputElement>('input')).find(
      (input) =>
        isVisibleEditable(input) &&
        input.autocomplete.toLowerCase() === 'username' &&
        input.value.trim().length > 0,
    );
    return username
      ? {
          stage: 'username_first',
          loginUrl: doc.location.href,
          username: username.value.trim().slice(0, MAX_USERNAME_LEN),
        }
      : null;
  }
  const current = passwords.filter(
    (input) => input.autocomplete.toLowerCase() === 'current-password',
  );
  const fresh = passwords.filter((input) => input.autocomplete.toLowerCase() === 'new-password');
  let password: HTMLInputElement | null;
  if (current.length > 0 || fresh.length > 0) {
    const newValues = new Set(fresh.map((input) => input.value));
    const currentValues = new Set(current.map((input) => input.value));
    if (
      current.length === 0 ||
      fresh.length === 0 ||
      newValues.size !== 1 ||
      currentValues.size !== 1 ||
      [...newValues][0] === [...currentValues][0] ||
      passwords.some((input) => !current.includes(input) && !fresh.includes(input))
    )
      return null;
    password = fresh[0] ?? null;
  } else {
    if (new Set(passwords.map((input) => input.value)).size !== 1) return null;
    password = passwords[0] ?? null;
  }
  const value = password?.value;
  if (!password || !value || value.length > MAX_PASSWORD_LEN) return null;

  return {
    stage: 'password',
    loginUrl: doc.location.href,
    username: findUsername(group),
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
  const submitted = new WeakMap<HTMLElement, number>();

  const consider = (anchor: Element | null) => {
    const group = coherentGroup(anchor);
    if (!group) return;
    const now = Date.now();
    if (now - (submitted.get(group) ?? 0) < DEDUPE_WINDOW_MS) return;
    const snap = snapshotLogin(anchor, doc);
    if (!snap) return;
    submitted.set(group, now);
    postCandidate(snap);
  };

  // Real form submission (capture phase so a handler that stops propagation or
  // calls preventDefault + fetch() still lets us see it).
  const onSubmit = (e: Event) => {
    if (!e.isTrusted) return;
    const submitter = (e as SubmitEvent).submitter;
    consider(
      submitter instanceof Element ? submitter : e.target instanceof Element ? e.target : null,
    );
  };
  // Enter inside a password box — SPA logins often have no <form>.
  const onKeyDown = (e: KeyboardEvent) => {
    if (!e.isTrusted || e.key !== 'Enter') return;
    if (isPasswordInput(e.target as Element | null)) consider(e.target as Element);
  };
  // A submit-looking control clicked near a filled password box.
  const onClick = (e: MouseEvent) => {
    if (!e.isTrusted) return;
    const target = e.target instanceof Element ? e.target : null;
    const control = target?.closest('button, input[type="submit"]') ?? null;
    if (!control) return;
    const form = control.closest('form');
    if (form) {
      consider(control);
      return;
    }
    if (coherentGroup(control)) consider(control);
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
