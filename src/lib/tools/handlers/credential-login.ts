/**
 * `credential_login` — agent-safe destination login.
 *
 * The agent asks for a login. It never learns the credential.
 *
 * Contract (cross-repo plan:
 * /Users/armanisadeghi/code/common-docs/projects/credential-sharing-browser-login/PLAN.md
 * § "Agent-safe browser login" + Phase 4):
 *
 *   arguments: { credential_item_id?: string }   ← and NOTHING else
 *
 * There is deliberately no `url`, `username`, `password`, `selector`, or
 * `script` argument. The extension derives the real tab origin itself
 * (`getAssignedTab`) and detects the login fields itself, so a compromised or
 * confused model cannot point the fill at a destination of its choosing, and
 * cannot smuggle a value in or out through the tool envelope.
 *
 * The whole resolve → materialize → fill → submit → verify cycle happens
 * inside ONE `run()` call. The plaintext lives in a `const` in that scope and
 * nowhere else: never chrome.storage, Redux, IndexedDB, local/session storage,
 * tool arguments, tool results, logs, traces, screenshots, clipboard,
 * analytics, error text, or model context. Every `return` from this handler
 * goes through `safeResult()`, which can only emit the fixed status enum plus
 * non-secret metadata.
 *
 * MFA and CAPTCHA are never bypassed — they terminate the tool with a status
 * that hands control back to the human.
 */

import {
  type BrowserLoginResultStatus,
  type VaultCallFailure,
  fetchBrowserLoginMatches,
  hasRealUserToken,
  materializeBrowserLogin,
  reportBrowserLoginResult,
} from '@/lib/api/routes/vault';
import { checkAuthState } from '@/lib/chat/context/check-auth-state';
import { isSafeDestination } from '@/lib/credentials/login-urls';
import {
  SENSITIVE_ATTR,
  forgetSensitiveFields,
  rememberSensitiveFields,
} from '@/lib/credentials/sensitive-fields';
import { log } from '@/lib/debug/log';
import { getAssignedTab } from '@/lib/tools/handlers/_active-tab';
import type { ToolHandler } from '@/lib/tools/types';
import { z } from 'zod';

/**
 * The COMPLETE set of statuses this tool may return. Nothing else is ever
 * emitted. `unknown` is NOT success — the agent must treat it as "the login
 * state could not be established".
 */
export type CredentialLoginStatus =
  | 'authenticated'
  | 'needs_mfa'
  | 'captcha_or_takeover'
  | 'credentials_rejected'
  | 'selection_required'
  | 'no_matching_login'
  | 'unsafe_destination'
  | 'unknown';

/** Safe candidate shown to the agent on `selection_required`. Ids + titles only. */
interface SafeChoice {
  credential_item_id: string;
  display_name: string;
}

interface CredentialLoginResult {
  status: CredentialLoginStatus;
  /** Machine-readable detail. Never derived from page or credential content. */
  reason?: string;
  /** Human-readable next step for the agent. Static strings only. */
  message?: string;
  /** Only populated for `selection_required`. */
  choices?: SafeChoice[];
}

const CredentialLoginArgs = z
  .object({
    /**
     * Which vault item to use. Omit to let the server match the CURRENT tab
     * origin. This is the ONLY argument — see the file header.
     */
    credential_item_id: z.string().min(1).optional(),
  })
  .default({});
type CredentialLoginArgs = z.infer<typeof CredentialLoginArgs>;

// ── Timing ──────────────────────────────────────────────────────────────────
const POLL_INTERVAL_MS = 400;
/** Two-step flows: how long to wait for the password field after step one. */
const WAIT_FOR_PASSWORD_MS = 12_000;
/** How long to watch for navigation / page-state change after submitting. */
const WAIT_AFTER_SUBMIT_MS = 15_000;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ── Origin safety ───────────────────────────────────────────────────────────
// `isSafeDestination` (HTTPS, or http on loopback) lives in
// src/lib/credentials/login-urls.ts so the Vault side panel enforces the EXACT
// same rule when deciding whether to offer "Use here" on the current tab. Two
// copies of this rule is how a surface starts advertising a fill the handler
// would refuse.

// ── Injected page probes ────────────────────────────────────────────────────
// Everything below runs in the PAGE. Each function is self-contained (no
// closure over module scope) because chrome.scripting serializes it. All of
// them are injected with `frameIds: [0]` — top frame only.

interface LoginFormProbe {
  is_top_frame: boolean;
  origin: string;
  href: string;
  username_selector: string | null;
  password_selector: string | null;
  submit_selector: string | null;
}

interface PageStateProbe {
  href: string;
  has_password_field: boolean;
  /** Category only — never the raw text, which can echo back the username. */
  error_kind: 'credentials' | 'generic' | null;
  mfa: boolean;
  captcha: boolean;
}

/**
 * Detect the login fields WITHOUT reading their values. Returns identity
 * (CSS selectors) only.
 */
function probeLoginFormSource(): LoginFormProbe {
  function uniqueSelector(el: Element): string {
    const id = el.getAttribute('id');
    if (id) return `#${CSS.escape(id)}`;
    const name = el.getAttribute('name');
    if (name) return `${el.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`;
    const parts: string[] = [];
    let node: Element | null = el;
    while (node && node.nodeType === 1 && node !== document.body && parts.length < 8) {
      const current: Element = node;
      const tag = current.tagName.toLowerCase();
      const parent = current.parentElement;
      if (!parent) {
        parts.unshift(tag);
        break;
      }
      const siblings = Array.from(parent.children).filter(
        (c: Element) => c.tagName === current.tagName,
      );
      const idx = siblings.indexOf(current) + 1;
      parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${idx})` : tag);
      node = parent;
    }
    return parts.join(' > ');
  }
  function visible(el: Element): boolean {
    if (!(el instanceof HTMLElement)) return false;
    if ((el as HTMLInputElement).disabled) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    const cs = window.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    return true;
  }

  const password =
    Array.from(document.querySelectorAll<HTMLInputElement>('input[type="password"]')).find(
      visible,
    ) ?? null;

  const USERNAME_HINT = /user|email|login|account|identifier|phone|mobile/i;
  const textInputs = Array.from(
    document.querySelectorAll<HTMLInputElement>(
      'input[type="text"], input[type="email"], input[type="tel"], input:not([type])',
    ),
  ).filter(visible);

  let username: HTMLInputElement | null = null;
  // 1. explicit autocomplete contract wins
  username =
    textInputs.find((i) => /^(username|email)$/i.test(i.getAttribute('autocomplete') ?? '')) ??
    null;
  // 2. the field immediately before the password field in the same form
  if (!username && password) {
    const scope = password.closest('form') ?? document.body;
    const inScope = textInputs.filter((i) => scope.contains(i));
    username = inScope.length > 0 ? (inScope[inScope.length - 1] ?? null) : null;
  }
  // 3. name / id / placeholder / label heuristic
  if (!username) {
    username =
      textInputs.find((i) =>
        USERNAME_HINT.test(
          `${i.getAttribute('name') ?? ''} ${i.getAttribute('id') ?? ''} ${
            i.getAttribute('placeholder') ?? ''
          } ${i.getAttribute('aria-label') ?? ''}`,
        ),
      ) ?? null;
  }
  // 4. a lone visible text input on a page that has a password field
  if (!username && password && textInputs.length === 1) username = textInputs[0] ?? null;

  // Submit affordance: prefer the form's own submit, then a button whose
  // label reads like a login continuation.
  const anchor = password ?? username;
  const form = anchor?.closest('form') ?? null;
  let submit: Element | null = form
    ? form.querySelector('button[type="submit"], input[type="submit"]')
    : null;
  if (!submit) {
    const SUBMIT_TEXT = /^(sign\s*in|log\s*in|login|continue|next|submit|go)$/i;
    const scope: ParentNode = form ?? document;
    submit =
      Array.from(
        scope.querySelectorAll<HTMLElement>('button, input[type="submit"], [role="button"]'),
      )
        .filter(visible)
        .find((b) => {
          const label = (
            b.innerText ||
            (b as HTMLInputElement).value ||
            b.getAttribute('aria-label') ||
            ''
          ).trim();
          return SUBMIT_TEXT.test(label);
        }) ?? null;
  }
  if (!submit && form) submit = form.querySelector('button:not([type])');

  return {
    is_top_frame: window.top === window.self,
    origin: location.origin,
    href: location.href,
    username_selector: username ? uniqueSelector(username) : null,
    password_selector: password ? uniqueSelector(password) : null,
    submit_selector: submit ? uniqueSelector(submit) : null,
  };
}

/**
 * Mark + fill one field. `value` is credential plaintext travelling into the
 * page — which is the entire point of the tool. It is never returned.
 */
function fillFieldSource(
  selector: string,
  value: string,
  sensitiveAttr: string,
): { ok: boolean; reason?: string } {
  const el = document.querySelector(selector) as HTMLInputElement | null;
  if (!el) return { ok: false, reason: 'field_not_found' };
  // Mark BEFORE writing so a mid-fill failure still leaves the field redacted.
  el.setAttribute(sensitiveAttr, '');
  el.scrollIntoView({ block: 'center', behavior: 'instant' });
  el.focus();
  // React/Vue track the value setter — bypass with the native one, then
  // dispatch the events a controlled input needs to register the change.
  const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
  const nativeSetter = desc?.set;
  if (nativeSetter) nativeSetter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.dispatchEvent(new Event('blur', { bubbles: true }));
  return { ok: true };
}

/** Click the submit affordance, or fall back to the form's own submit. */
function submitLoginSource(selector: string | null): { ok: boolean; mode: string } {
  if (selector) {
    const btn = document.querySelector(selector) as HTMLElement | null;
    if (btn) {
      btn.click();
      return { ok: true, mode: 'click' };
    }
  }
  const pw = document.querySelector('input[type="password"]') as HTMLInputElement | null;
  const form = (pw ?? document.querySelector('input'))?.closest('form') ?? null;
  if (form) {
    if (typeof form.requestSubmit === 'function') form.requestSubmit();
    else form.submit();
    return { ok: true, mode: 'form' };
  }
  return { ok: false, mode: 'none' };
}

/** Post-submit page state. Returns categories and booleans — never page text. */
function pageStateSource(): PageStateProbe {
  function visible(el: Element): boolean {
    if (!(el instanceof HTMLElement)) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    const cs = window.getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden';
  }

  const hasPassword = Array.from(
    document.querySelectorAll<HTMLInputElement>('input[type="password"]'),
  ).some(visible);

  // CAPTCHA / bot-challenge markers.
  const captcha =
    !!document.querySelector(
      '.g-recaptcha, #g-recaptcha, .h-captcha, [data-sitekey], #cf-challenge-running, #challenge-form',
    ) ||
    Array.from(document.querySelectorAll('iframe')).some((f) =>
      /recaptcha|hcaptcha|turnstile|challenges\.cloudflare/i.test(f.src ?? ''),
    );

  // MFA / one-time-code markers.
  const MFA_HINT = /otp|mfa|2fa|totp|one[-_ ]?time|verification[-_ ]?code|authenticator/i;
  const mfaField = Array.from(document.querySelectorAll<HTMLInputElement>('input')).some(
    (i) =>
      i.getAttribute('autocomplete') === 'one-time-code' ||
      MFA_HINT.test(`${i.getAttribute('name') ?? ''} ${i.getAttribute('id') ?? ''}`),
  );
  const bodyText = (document.body?.innerText ?? '').slice(0, 4000);
  const mfaCopy =
    /two[- ]factor|2-step|verification code|authenticator app|enter the code we sent/i.test(
      bodyText,
    );
  const mfa = mfaField || mfaCopy;

  // Error classification. Only the CATEGORY escapes — a login error commonly
  // echoes the username back, and that value is a credential.
  const CREDENTIAL_ERROR =
    /incorrect password|wrong password|invalid (?:password|username|email|credentials|login)|password (?:is )?incorrect|(?:username|email) (?:or|and) password|couldn'?t find your account|we don'?t recognize|no account found|login failed|authentication failed/i;
  const GENERIC_ERROR = /\berror\b|try again|something went wrong/i;
  const alertText = Array.from(
    document.querySelectorAll('[role="alert"], .error, .alert, [aria-live="assertive"]'),
  )
    .filter(visible)
    .map((e) => (e as HTMLElement).innerText ?? '')
    .join(' ')
    .slice(0, 2000);
  const haystack = `${alertText} ${bodyText}`;
  const errorKind: PageStateProbe['error_kind'] = CREDENTIAL_ERROR.test(haystack)
    ? 'credentials'
    : GENERIC_ERROR.test(alertText)
      ? 'generic'
      : null;

  return {
    href: location.href,
    has_password_field: hasPassword,
    error_kind: errorKind,
    mfa,
    captcha,
  };
}

/** Wipe values we wrote and drop the markers. Used when submission stalled. */
function clearSensitiveSource(selectors: string[], sensitiveAttr: string): { cleared: number } {
  let cleared = 0;
  const seen = new Set<Element>();
  for (const sel of selectors) {
    let el: Element | null = null;
    try {
      el = document.querySelector(sel);
    } catch {
      el = null;
    }
    if (!el || seen.has(el)) continue;
    seen.add(el);
    if (el instanceof HTMLInputElement) {
      const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
      const nativeSetter = desc?.set;
      if (nativeSetter) nativeSetter.call(el, '');
      else el.value = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      cleared++;
    }
    el.removeAttribute(sensitiveAttr);
  }
  // Belt and braces: anything still carrying the marker gets emptied too.
  for (const el of Array.from(document.querySelectorAll(`[${sensitiveAttr}]`))) {
    if (seen.has(el)) continue;
    if (el instanceof HTMLInputElement) {
      const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
      const nativeSetter = desc?.set;
      if (nativeSetter) nativeSetter.call(el, '');
      else el.value = '';
      cleared++;
    }
    el.removeAttribute(sensitiveAttr);
  }
  return { cleared };
}

// ── Handler ─────────────────────────────────────────────────────────────────

/**
 * The one exit point. Guarantees the envelope handed to the agent carries
 * only the fixed status enum plus static, non-secret metadata.
 */
function safeResult(
  status: CredentialLoginStatus,
  extra: { reason?: string; message?: string; choices?: SafeChoice[] } = {},
): CredentialLoginResult {
  const out: CredentialLoginResult = { status };
  if (extra.reason) out.reason = extra.reason;
  if (extra.message) out.message = extra.message;
  if (extra.choices) out.choices = extra.choices;
  return out;
}

function failureResult(failure: VaultCallFailure, op: string): CredentialLoginResult {
  if (failure.kind === 'sign_in_required') {
    return safeResult('unknown', {
      reason: 'matrx_sign_in_required',
      message:
        'Sign in to Matrx in the extension side panel before using credential_login. The vault does not accept anonymous identities.',
    });
  }
  if (failure.kind === 'forbidden') {
    return safeResult('unknown', {
      reason: 'vault_access_denied',
      message:
        'The vault refused this request. The item may not be shared with you, or browser fill may be disabled on it.',
    });
  }
  return safeResult('unknown', { reason: `vault_${op}_failed_${failure.status}` });
}

async function injectTopFrame<T>(
  tabId: number,
  func: (...args: never[]) => T,
  args: unknown[],
): Promise<T | null> {
  const [first] = await chrome.scripting.executeScript({
    // frameIds: [0] is the top frame. Never fill inside a cross-origin
    // iframe — the tab URL the vault authorized against is the TOP frame's.
    target: { tabId, frameIds: [0] },
    func: func as (...a: unknown[]) => T,
    args,
  });
  return (first?.result as T | undefined) ?? null;
}

export const credential_login: ToolHandler<CredentialLoginArgs, CredentialLoginResult> = {
  name: 'credential_login',
  tier: 'action',
  argsSchema: CredentialLoginArgs,
  supportedBrowsers: ['chrome'],
  // NOTE: no `admin_only`. The DB is the source of truth (Rule 7,
  // docs/TOOL_SOURCE_OF_TRUTH.md) and `tool.definition.credential_login` says
  // `admin_only = false`, `tier = 'action'`, `category = 'credentials'`.
  // Agent advertisement is gated by `tool.surface_defaults.always_include_tools`
  // — no surface lists this tool yet, which is the Phase 5 activation switch.
  // Do not re-add a code-side gate; change the DB instead.
  run: async (args, ctx) => {
    // ── 1. A real signed-in user, or nothing ───────────────────────────────
    if (!(await hasRealUserToken())) {
      return safeResult('unknown', {
        reason: 'matrx_sign_in_required',
        message:
          'Sign in to Matrx in the extension side panel before using credential_login. The vault does not accept anonymous identities.',
      });
    }

    // ── 2. The REAL assigned tab — never an agent-supplied URL ─────────────
    const tab = await getAssignedTab(ctx);
    if (!tab?.id || !tab.url) {
      return safeResult('unknown', { reason: 'no_active_tab' });
    }
    const tabId = tab.id;
    let pageUrl: URL;
    try {
      pageUrl = new URL(tab.url);
    } catch {
      return safeResult('unsafe_destination', { reason: 'unparsable_url' });
    }
    if (!isSafeDestination(pageUrl)) {
      return safeResult('unsafe_destination', {
        reason: 'insecure_scheme',
        message: 'Browser login requires https (or an explicit localhost destination).',
      });
    }

    // ── 3. Detect the login fields (top frame only, values never read) ─────
    let probe: LoginFormProbe | null;
    try {
      probe = await injectTopFrame<LoginFormProbe>(tabId, probeLoginFormSource, []);
    } catch {
      return safeResult('unknown', { reason: 'page_not_scriptable' });
    }
    if (!probe) return safeResult('unknown', { reason: 'page_probe_failed' });
    if (!probe.is_top_frame) {
      return safeResult('unsafe_destination', { reason: 'not_top_frame' });
    }
    if (probe.origin !== pageUrl.origin) {
      // The tab navigated between reading tab.url and injecting.
      return safeResult('unsafe_destination', { reason: 'origin_changed_during_probe' });
    }
    if (!probe.password_selector && !probe.username_selector) {
      return safeResult('unknown', {
        reason: 'no_login_form_detected',
        message: 'No username or password field was found in the top frame of this page.',
      });
    }

    const normalizedPageUrl = `${pageUrl.origin}${pageUrl.pathname}`;

    // ── 4. Resolve which item to use ───────────────────────────────────────
    let itemId = args.credential_item_id ?? null;
    if (!itemId) {
      const matches = await fetchBrowserLoginMatches(normalizedPageUrl);
      if (!matches.ok) return failureResult(matches.failure, 'matches');
      const list = matches.data.matches;
      if (list.length === 0) {
        return safeResult('no_matching_login', {
          message: 'No saved login is enabled for browser fill on this destination.',
        });
      }
      if (list.length > 1) {
        // Safe ids + titles only. Nothing is decrypted on this path.
        return safeResult('selection_required', {
          message:
            'Several saved logins match this destination. Ask the user which one, then call credential_login again with that credential_item_id.',
          choices: list.map((m) => ({
            credential_item_id: m.item_id,
            display_name: m.display_name,
          })),
        });
      }
      const only = list[0];
      if (!only) return safeResult('no_matching_login');
      itemId = only.item_id;
    }

    // ── 5. Materialize (PLAINTEXT — local scope only from here) ────────────
    const materialized = await materializeBrowserLogin(itemId, {
      pageUrl: normalizedPageUrl,
      toolInvocationId: ctx.callId,
      clientBuild: chrome.runtime.getManifest().version,
    });
    if (!materialized.ok) return failureResult(materialized.failure, 'materialize');
    const credential = materialized.data;

    // Defence in depth: the server already re-ran the matcher, but a mismatch
    // here means something is wrong on the wire. Refuse rather than fill.
    if (credential.origin !== pageUrl.origin) {
      await reportBrowserLoginResult(itemId, {
        status: 'unsafe_destination',
        pageUrl: normalizedPageUrl,
        toolInvocationId: ctx.callId,
      });
      return safeResult('unsafe_destination', { reason: 'origin_mismatch' });
    }

    // Everything past this point must finish through `finish()` so the
    // outcome is audited and the plaintext reference is dropped.
    const filledSelectors: string[] = [];
    let status: CredentialLoginStatus = 'unknown';
    let reason: string | undefined;

    const finish = async (
      s: CredentialLoginStatus,
      opts: { reason?: string; message?: string; clear?: boolean } = {},
    ): Promise<CredentialLoginResult> => {
      status = s;
      reason = opts.reason;
      if (opts.clear && filledSelectors.length > 0) {
        try {
          await injectTopFrame(tabId, clearSensitiveSource, [filledSelectors, SENSITIVE_ATTR]);
          forgetSensitiveFields(tabId);
        } catch {
          // A page we can no longer script has already navigated away; the
          // filled values are gone with it.
        }
      }
      await reportBrowserLoginResult(itemId as string, {
        status: status as BrowserLoginResultStatus,
        pageUrl: normalizedPageUrl,
        toolInvocationId: ctx.callId,
      });
      // Status + reason only. Both are static strings from this file — no
      // page content, no credential, ever reaches the debug log.
      log.info('sw', `credential_login → ${status}${reason ? ` (${reason})` : ''}`);
      const out: { reason?: string; message?: string } = {};
      if (opts.reason) out.reason = opts.reason;
      if (opts.message) out.message = opts.message;
      return safeResult(status, out);
    };

    try {
      // ── 6. Fill ────────────────────────────────────────────────────────
      let passwordSelector = probe.password_selector;

      if (probe.username_selector && credential.username) {
        // Record identity BEFORE the fill — redaction must not depend on the
        // fill succeeding, or on the page keeping the marker attribute.
        rememberSensitiveFields(tabId, [probe.username_selector]);
        filledSelectors.push(probe.username_selector);
        const r = await injectTopFrame<{ ok: boolean }>(tabId, fillFieldSource, [
          probe.username_selector,
          credential.username,
          SENSITIVE_ATTR,
        ]);
        if (!r?.ok) return await finish('unknown', { reason: 'username_fill_failed', clear: true });
      }

      // Two-step flow: username first, then advance to reveal the password.
      if (!passwordSelector) {
        const advanced = await injectTopFrame<{ ok: boolean; mode: string }>(
          tabId,
          submitLoginSource,
          [probe.submit_selector],
        );
        if (!advanced?.ok) {
          return await finish('unknown', {
            reason: 'two_step_advance_failed',
            message: 'No password field and no way to advance past the username step.',
            clear: true,
          });
        }
        const deadline = Date.now() + WAIT_FOR_PASSWORD_MS;
        while (Date.now() < deadline && !passwordSelector) {
          await sleep(POLL_INTERVAL_MS);
          const again = await injectTopFrame<LoginFormProbe>(tabId, probeLoginFormSource, []).catch(
            () => null,
          );
          if (!again) continue;
          if (!again.is_top_frame || again.origin !== pageUrl.origin) {
            return await finish('unsafe_destination', { reason: 'origin_changed_mid_flow' });
          }
          if (again.password_selector) {
            passwordSelector = again.password_selector;
            probe = again;
          }
        }
        if (!passwordSelector) {
          const mid = await injectTopFrame<PageStateProbe>(tabId, pageStateSource, []).catch(
            () => null,
          );
          if (mid?.captcha) return await finish('captcha_or_takeover', { clear: true });
          if (mid?.mfa) return await finish('needs_mfa', { clear: true });
          if (mid?.error_kind === 'credentials') {
            return await finish('credentials_rejected', { clear: true });
          }
          return await finish('unknown', {
            reason: 'password_step_never_appeared',
            clear: true,
          });
        }
      }

      rememberSensitiveFields(tabId, [passwordSelector]);
      filledSelectors.push(passwordSelector);
      const pwFill = await injectTopFrame<{ ok: boolean }>(tabId, fillFieldSource, [
        passwordSelector,
        credential.password,
        SENSITIVE_ATTR,
      ]);
      if (!pwFill?.ok) {
        return await finish('unknown', { reason: 'password_fill_failed', clear: true });
      }

      // ── 7. Submit, then wait for navigation or a bounded state change ──
      const before = await injectTopFrame<PageStateProbe>(tabId, pageStateSource, []).catch(
        () => null,
      );
      const beforeHref = before?.href ?? probe.href;

      const submitted = await injectTopFrame<{ ok: boolean; mode: string }>(
        tabId,
        submitLoginSource,
        [probe.submit_selector],
      ).catch(() => null);
      if (!submitted?.ok) {
        return await finish('unknown', {
          reason: 'no_submit_affordance',
          message:
            'The credential was entered but no submit control could be found; it was cleared.',
          clear: true,
        });
      }

      let state: PageStateProbe | null = null;
      let progressed = false;
      const settleDeadline = Date.now() + WAIT_AFTER_SUBMIT_MS;
      while (Date.now() < settleDeadline) {
        await sleep(POLL_INTERVAL_MS);
        state = await injectTopFrame<PageStateProbe>(tabId, pageStateSource, []).catch(() => null);
        if (!state) continue; // mid-navigation the page is briefly unscriptable
        if (
          state.href !== beforeHref ||
          !state.has_password_field ||
          state.captcha ||
          state.mfa ||
          state.error_kind !== null
        ) {
          progressed = true;
          break;
        }
      }

      if (!progressed) {
        // Submission never took. Clear what we typed before handing back.
        return await finish('unknown', {
          reason: 'submission_did_not_proceed',
          message: 'The form did not react to submission; the filled fields were cleared.',
          clear: true,
        });
      }

      // Let a redirect chain settle before reading the auth state.
      await sleep(800);
      const final =
        (await injectTopFrame<PageStateProbe>(tabId, pageStateSource, []).catch(() => null)) ??
        state;

      // ── 8. Classify. Order matters: a takeover condition wins over any
      // optimistic "looks signed in" signal.
      if (final?.captcha) return await finish('captcha_or_takeover');
      if (final?.mfa) return await finish('needs_mfa');
      if (final?.error_kind === 'credentials') return await finish('credentials_rejected');

      const currentTab = await chrome.tabs.get(tabId).catch(() => null);
      const currentUrl = currentTab?.url ?? final?.href ?? pageUrl.href;
      const auth = await checkAuthState(tabId, currentUrl);
      if (
        (auth?.signed_in === 'yes' || auth?.signed_in === 'likely') &&
        final?.has_password_field !== true
      ) {
        return await finish('authenticated');
      }
      if (final?.has_password_field === true) {
        // Still sitting on a password form after a reaction — most likely a
        // rejection the page phrased in copy we do not recognise.
        return await finish('unknown', { reason: 'still_on_login_form' });
      }
      return await finish('unknown', { reason: 'auth_state_indeterminate' });
    } catch {
      // Never surface the thrown error: an exception raised inside a fill can
      // carry the value in its message on some engines.
      return await finish('unknown', { reason: 'unexpected_failure', clear: true });
    }
    // `credential` goes out of scope here. No other reference to it exists.
  },
};

export const credential_handlers = [credential_login];
