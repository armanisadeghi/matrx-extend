/**
 * `credential_login` — agent-safe destination login.
 *
 * The agent asks for a login. It never learns the credential.
 *
 * Contract (cross-repo plan:
 * /Users/armanisadeghi/code/common-docs/projects/credential-sharing-browser-login/PLAN.md
 * § "Agent-safe browser login" + Phase 4):
 *
 * The current contract has four strict actions: automatically use the saved
 * recipe, discover safe field names, submit one complete field-map attempt,
 * or report a leak/wrong verdict. There
 * is deliberately no agent-supplied destination URL or credential value. The
 * extension derives the real tab origin itself; an optional success URL prefix
 * is only a post-submit expectation. The server resolves field NAMES just in
 * time.
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
  materializeBrowserAuthenticator,
  materializeBrowserLogin,
  reportBrowserLoginResult,
  submitBrowserLoginReport,
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
  | 'discovery_ready'
  | 'report_received'
  | 'spec_incomplete'
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
  available_fields?: Array<{
    field_key: string;
    label: string;
    fillable: boolean;
    reason?: string;
  }>;
  non_secret_fields?: Array<{ key: string; label: string; value: string }>;
  verdict?: 'authenticated' | 'challenged' | 'rejected' | 'unknown' | 'refused';
  confidence?: number;
  signals?: LoginSignal[];
  evidence?: LoginEvidence;
  feedback: { how_to_report: string };
}

const FieldSpec = z
  .object({
    selector: z.string().min(1),
    field_key: z.string().min(1).optional(),
    literal: z.string().optional(),
    clear_first: z.boolean().default(true),
  })
  .superRefine((value, ctx) => {
    if ((value.field_key === undefined) === (value.literal === undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'exactly one of field_key or literal is required',
      });
    }
  });

const SubmitSpec = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('click'), selector: z.string().min(1) }),
  z.object({ kind: z.literal('press_enter'), selector: z.string().min(1) }),
  z.object({ kind: z.literal('none') }),
]);

const ExpectSpec = z
  .object({
    success_url_prefix: z.string().url().optional(),
    success_selector: z.string().min(1).optional(),
    failure_selector: z.string().min(1).optional(),
    challenge_selector: z.string().min(1).optional(),
    timeout_ms: z.number().int().min(1_000).max(60_000).default(30_000),
  })
  .default({ timeout_ms: 30_000 });

const AttemptStep = z.object({
  fields: z.array(z.string().min(1)).min(1),
  submit: SubmitSpec,
  wait_for: z
    .object({
      selector: z.string().min(1),
      timeout_ms: z.number().int().min(250).max(60_000).default(15_000),
    })
    .optional(),
});

const DiscoverArgs = z
  .object({
    action: z.literal('discover'),
    /** Server-owned Playwright target. Matrx Extend derives its assigned tab and ignores this. */
    session_id: z.string().min(1).optional(),
    credential_item_id: z.string().min(1).optional(),
  })
  .strict();

const AutoArgs = z
  .object({
    action: z.literal('auto'),
    session_id: z.string().min(1).optional(),
    credential_item_id: z.string().min(1).optional(),
  })
  .strict();

const AttemptArgs = z
  .object({
    action: z.literal('attempt'),
    session_id: z.string().min(1).optional(),
    credential_item_id: z.string().min(1).optional(),
    fields: z.array(FieldSpec).min(1),
    submit: SubmitSpec.optional(),
    steps: z.array(AttemptStep).min(1).optional(),
    expect: ExpectSpec,
    reason: z.string().min(1).max(1_000).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.fields.some((field) => field.field_key !== undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'an attempt must name at least one vault field',
        path: ['fields'],
      });
    }
    if (value.steps && value.submit) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'steps and top-level submit are mutually exclusive',
      });
    }
    if (!value.steps && !value.submit) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'submit is required' });
    }
    if (value.steps) {
      const selectors = new Set(value.fields.map((field) => field.selector));
      for (const [index, step] of value.steps.entries()) {
        for (const selector of step.fields) {
          if (!selectors.has(selector)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `step references undeclared field selector ${selector}`,
              path: ['steps', index, 'fields'],
            });
          }
        }
      }
    }
  });

const AuthenticatorArgs = z
  .object({
    action: z.literal('authenticator'),
    session_id: z.string().min(1).optional(),
    credential_item_id: z.string().min(1),
    code_selector: z.string().min(1),
    submit: SubmitSpec,
    expect: ExpectSpec,
  })
  .strict();

const ReportArgs = z
  .object({
    action: z.literal('report'),
    session_id: z.string().min(1).optional(),
    kind: z.enum(['secret_exposed', 'wrong_verdict', 'recipe_wrong', 'other']),
    where: z.string().min(1).max(500),
    attempt_id: z.string().min(1).optional(),
    description: z.string().min(1).max(4_000).optional(),
  })
  .strict();

/**
 * Provider-facing schemas are a flat parameter map in `tool.definition`, not
 * a top-level JSON-Schema `anyOf`. Keep that canonical flat shape here, then
 * enforce the exact per-action arms with strict schemas at parse time.
 */
const CredentialLoginArgs = z
  .object({
    action: z.enum(['auto', 'discover', 'attempt', 'authenticator', 'report']),
    session_id: z.string().min(1).optional(),
    credential_item_id: z.string().min(1).optional(),
    fields: z.array(FieldSpec).min(1).optional(),
    submit: SubmitSpec.optional(),
    steps: z.array(AttemptStep).min(1).optional(),
    expect: ExpectSpec.optional(),
    code_selector: z.string().min(1).optional(),
    reason: z.string().min(1).max(1_000).optional(),
    kind: z.enum(['secret_exposed', 'wrong_verdict', 'recipe_wrong', 'other']).optional(),
    where: z.string().min(1).max(500).optional(),
    attempt_id: z.string().min(1).optional(),
    description: z.string().min(1).max(4_000).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const schema =
      value.action === 'auto'
        ? AutoArgs
        : value.action === 'discover'
          ? DiscoverArgs
          : value.action === 'attempt'
            ? AttemptArgs
            : value.action === 'authenticator'
              ? AuthenticatorArgs
              : ReportArgs;
    const parsed = schema.safeParse(value);
    if (parsed.success) return;
    for (const issue of parsed.error.issues) ctx.addIssue(issue);
  });
type CredentialLoginArgs = z.infer<typeof CredentialLoginArgs>;
type CompleteAttemptArgs = z.infer<typeof AttemptArgs>;

interface LoginSignal {
  kind: string;
  direction: 'authenticated' | 'challenged' | 'rejected' | 'unknown';
  weight: number;
  source: 'generic' | 'agent_expectation';
}

interface EvidenceSnapshot {
  url: string;
  has_password_field: boolean;
  mfa: boolean;
  captcha: boolean;
  error_kind: 'credentials' | 'generic' | null;
}

interface LoginEvidence {
  before: EvidenceSnapshot;
  after?: EvidenceSnapshot;
  elapsed_ms: number;
}

const FEEDBACK = {
  how_to_report:
    "If you saw a password, token, or code in page content, a screenshot, or a tool result during this login — or the verdict was wrong — report it with credential_login({action:'report', ...}). Do not repeat the value; name where you saw it.",
} as const;

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
  form_method: string | null;
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
    form_method: form?.method.toLowerCase() ?? null,
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
  if (sensitiveAttr) el.setAttribute(sensitiveAttr, '');
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
      const buttonForm = btn.closest('form');
      if (buttonForm?.method.toLowerCase() === 'get') {
        return { ok: false, mode: 'unsafe_get' };
      }
      btn.click();
      return { ok: true, mode: 'click' };
    }
  }
  const pw = document.querySelector('input[type="password"]') as HTMLInputElement | null;
  const form = (pw ?? document.querySelector('input'))?.closest('form') ?? null;
  if (form) {
    if (form.method.toLowerCase() === 'get') return { ok: false, mode: 'unsafe_get' };
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

interface SpecProbe {
  is_top_frame: boolean;
  origin: string;
  fields: Record<string, { exists: boolean; form_method: string | null }>;
  controls: Record<string, boolean>;
}

/** Validate the ENTIRE declared attempt before requesting any secret. */
function probeAttemptSpecSource(fieldSelectors: string[], controlSelectors: string[]): SpecProbe {
  const fields: SpecProbe['fields'] = {};
  const controls: SpecProbe['controls'] = {};
  for (const selector of fieldSelectors) {
    let element: Element | null = null;
    try {
      element = document.querySelector(selector);
    } catch {
      element = null;
    }
    fields[selector] = {
      exists: element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement,
      form_method: element?.closest('form')?.method.toLowerCase() ?? null,
    };
  }
  for (const selector of controlSelectors) {
    try {
      controls[selector] = document.querySelector(selector) instanceof HTMLElement;
    } catch {
      controls[selector] = false;
    }
  }
  return { is_top_frame: window.top === window.self, origin: location.origin, fields, controls };
}

function explicitSubmitSource(
  kind: 'click' | 'press_enter' | 'none',
  selector: string | null,
): { ok: boolean; mode: string } {
  if (kind === 'none') return { ok: true, mode: 'none' };
  if (!selector) return { ok: false, mode: 'missing_selector' };
  const element = document.querySelector(selector) as HTMLElement | null;
  if (!element) return { ok: false, mode: 'not_found' };
  const form = element.closest('form');
  if (form?.method.toLowerCase() === 'get') return { ok: false, mode: 'unsafe_get' };
  if (kind === 'click') {
    element.click();
    return { ok: true, mode: 'click' };
  }
  element.focus();
  element.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }),
  );
  element.dispatchEvent(
    new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }),
  );
  if (form) {
    if (typeof form.requestSubmit === 'function') form.requestSubmit();
    else form.submit();
  }
  return { ok: true, mode: 'press_enter' };
}

// ── Handler ─────────────────────────────────────────────────────────────────

/**
 * The one exit point. Guarantees the envelope handed to the agent carries
 * only the fixed status enum plus static, non-secret metadata.
 */
function safeResult(
  status: CredentialLoginStatus,
  extra: Omit<Partial<CredentialLoginResult>, 'status' | 'feedback'> = {},
): CredentialLoginResult {
  const defaultVerdict: NonNullable<CredentialLoginResult['verdict']> =
    status === 'authenticated'
      ? 'authenticated'
      : status === 'needs_mfa' || status === 'captcha_or_takeover'
        ? 'challenged'
        : status === 'credentials_rejected'
          ? 'rejected'
          : [
                'selection_required',
                'no_matching_login',
                'unsafe_destination',
                'spec_incomplete',
              ].includes(status)
            ? 'refused'
            : 'unknown';
  const out: CredentialLoginResult = {
    status,
    verdict: extra.verdict ?? defaultVerdict,
    confidence: extra.confidence ?? (defaultVerdict === 'refused' ? 1 : 0),
    signals: extra.signals ?? [],
    feedback: FEEDBACK,
  };
  Object.assign(out, extra);
  return out;
}

function signal(
  kind: string,
  direction: LoginSignal['direction'],
  weight: number,
  source: LoginSignal['source'] = 'generic',
): LoginSignal {
  return { kind, direction, weight, source };
}

async function waitForSelector(
  tabId: number,
  selector: string,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = await injectTopFrame<boolean>(
      tabId,
      ((sel: string) => {
        try {
          return document.querySelector(sel) !== null;
        } catch {
          return false;
        }
      }) as (...args: never[]) => boolean,
      [selector],
    ).catch(() => false);
    if (found) return true;
    await sleep(POLL_INTERVAL_MS);
  }
  return false;
}

async function classifyExplicitAttempt(
  tabId: number,
  pageUrl: URL,
  expect: z.infer<typeof ExpectSpec>,
  before: PageStateProbe,
  startedAt: number,
): Promise<Pick<CredentialLoginResult, 'status' | 'confidence' | 'signals' | 'evidence'>> {
  const deadline = Date.now() + expect.timeout_ms;
  let after: PageStateProbe | null = null;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    after = await injectTopFrame<PageStateProbe>(tabId, pageStateSource, []).catch(() => null);
    if (!after) continue;
    if (
      after.href !== before.href ||
      after.has_password_field !== before.has_password_field ||
      after.mfa ||
      after.captcha ||
      after.error_kind !== null
    ) {
      break;
    }
  }
  after ??= before;
  const signals: LoginSignal[] = [];
  if (after.captcha) signals.push(signal('captcha_marker_present', 'challenged', 1));
  if (after.mfa) signals.push(signal('mfa_marker_present', 'challenged', 0.95));
  if (after.error_kind === 'credentials') {
    signals.push(signal('credential_error_present', 'rejected', 0.95));
  }
  if (!after.has_password_field && before.has_password_field) {
    signals.push(signal('login_form_gone', 'authenticated', 0.4));
  }
  if (expect.success_url_prefix && after.href.startsWith(expect.success_url_prefix)) {
    signals.push(signal('expected_success_url', 'authenticated', 0.85, 'agent_expectation'));
  }
  const expectationSelectors = [
    ['success_selector', expect.success_selector, 'authenticated', 0.8],
    ['failure_selector', expect.failure_selector, 'rejected', 0.9],
    ['challenge_selector', expect.challenge_selector, 'challenged', 0.9],
  ] as const;
  for (const [kind, selector, direction, weight] of expectationSelectors) {
    if (!selector) continue;
    const present = await waitForSelector(tabId, selector, 250);
    if (present) signals.push(signal(kind, direction, weight, 'agent_expectation'));
  }
  const currentTab = await chrome.tabs.get(tabId).catch(() => null);
  const currentUrl = currentTab?.url ?? after.href ?? pageUrl.href;
  const auth = await checkAuthState(tabId, currentUrl);
  if (auth?.signed_in === 'yes') signals.push(signal('auth_state_yes', 'authenticated', 0.8));
  if (auth?.signed_in === 'likely') {
    signals.push(signal('auth_state_likely', 'authenticated', 0.55));
  }

  const strongest = (direction: LoginSignal['direction']): number =>
    Math.min(
      1,
      signals
        .filter((item) => item.direction === direction)
        .reduce((total, item) => total + item.weight, 0),
    );
  const challenged = strongest('challenged');
  const rejected = strongest('rejected');
  const authenticated = strongest('authenticated');
  const status: CredentialLoginStatus =
    challenged > 0
      ? after.captcha
        ? 'captcha_or_takeover'
        : 'needs_mfa'
      : rejected > 0
        ? 'credentials_rejected'
        : authenticated >= 0.75
          ? 'authenticated'
          : 'unknown';
  const confidence =
    status === 'needs_mfa' || status === 'captcha_or_takeover'
      ? challenged
      : status === 'credentials_rejected'
        ? rejected
        : status === 'authenticated'
          ? authenticated
          : Math.max(authenticated, rejected, challenged);
  return {
    status,
    confidence,
    signals,
    evidence: {
      before: snapshot(before),
      after: snapshot(after),
      elapsed_ms: Date.now() - startedAt,
    },
  };
}

function snapshot(state: PageStateProbe): EvidenceSnapshot {
  let url = state.href;
  try {
    const parsed = new URL(state.href);
    url = `${parsed.origin}${parsed.pathname}`;
  } catch {
    url = '(unparseable)';
  }
  return {
    url,
    has_password_field: state.has_password_field,
    mfa: state.mfa,
    captcha: state.captcha,
    error_kind: state.error_kind,
  };
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

async function runCompleteAttempt(
  args: CompleteAttemptArgs,
  ctx: Parameters<typeof getAssignedTab>[0],
  tabId: number,
  pageUrl: URL,
  normalizedPageUrl: string,
): Promise<CredentialLoginResult> {
  let itemId = args.credential_item_id ?? null;
  if (!itemId) {
    const matches = await fetchBrowserLoginMatches(normalizedPageUrl, {
      includeFieldInventory: true,
    });
    if (!matches.ok) return failureResult(matches.failure, 'matches');
    if (matches.data.matches.length === 0) {
      return safeResult('no_matching_login', {
        message: 'No saved login is enabled for browser fill on this destination.',
      });
    }
    if (matches.data.matches.length > 1) {
      return safeResult('selection_required', {
        message: 'Several saved logins match this destination. Select one before attempting.',
        choices: matches.data.matches.map((match) => ({
          credential_item_id: match.item_id,
          display_name: match.display_name,
        })),
      });
    }
    itemId = matches.data.matches[0]?.item_id ?? null;
  }
  if (!itemId) return safeResult('no_matching_login');

  const fieldBySelector = new Map(args.fields.map((field) => [field.selector, field]));
  const fieldKeys = Array.from(
    new Set(args.fields.flatMap((field) => (field.field_key ? [field.field_key] : []))),
  );
  const steps = args.steps ?? [
    {
      fields: args.fields.map((field) => field.selector),
      submit: args.submit as z.infer<typeof SubmitSpec>,
    },
  ];
  const startedAt = Date.now();

  // Refuse a malformed first step before asking the Vault to decrypt anything.
  // Later-step selectors may legitimately appear only after the first submit,
  // so they are checked immediately before their own step below.
  const firstStep = steps[0];
  if (!firstStep) {
    return safeResult('spec_incomplete', { reason: 'attempt_has_no_steps' });
  }
  const firstControl = firstStep.submit.kind === 'none' ? null : firstStep.submit.selector;
  const firstProbe = await injectTopFrame<SpecProbe>(tabId, probeAttemptSpecSource, [
    firstStep.fields,
    firstControl ? [firstControl] : [],
  ]).catch(() => null);
  if (!firstProbe || !firstProbe.is_top_frame || firstProbe.origin !== pageUrl.origin) {
    return safeResult('unsafe_destination', { reason: 'origin_changed_before_attempt' });
  }
  const firstMissing = firstStep.fields.filter((selector) => !firstProbe.fields[selector]?.exists);
  if (firstControl && !firstProbe.controls[firstControl]) firstMissing.push(firstControl);
  if (firstMissing.length > 0) {
    return safeResult('spec_incomplete', {
      reason: 'selector_not_found',
      message: `The first step could not be found (${firstMissing.length} selector${firstMissing.length === 1 ? '' : 's'} missing). Nothing was decrypted or typed.`,
    });
  }
  if (firstStep.fields.some((selector) => firstProbe.fields[selector]?.form_method === 'get')) {
    return safeResult('unsafe_destination', { reason: 'unsafe_get_form' });
  }

  // Resolve every named field as one atomic authorization request BEFORE any
  // page mutation. A missing/inactive/sealed field refuses the whole attempt.
  const materialized = await materializeBrowserLogin(itemId, {
    pageUrl: normalizedPageUrl,
    toolInvocationId: ctx.callId,
    clientBuild: chrome.runtime.getManifest().version,
    fieldKeys,
  });
  if (!materialized.ok) {
    const failed = failureResult(materialized.failure, 'materialize');
    return safeResult('spec_incomplete', {
      reason: failed.reason ?? 'field_materialization_refused',
      message: 'The complete field set could not be authorized. Nothing was typed.',
    });
  }
  const credential = materialized.data;
  if (credential.origin !== pageUrl.origin || !credential.fields) {
    return safeResult('unsafe_destination', { reason: 'origin_or_field_map_mismatch' });
  }

  const before = await injectTopFrame<PageStateProbe>(tabId, pageStateSource, []).catch(() => null);
  if (!before) return safeResult('unknown', { reason: 'before_evidence_failed' });
  const filledSelectors: string[] = [];
  const finish = async (
    result: CredentialLoginResult,
    clear = false,
  ): Promise<CredentialLoginResult> => {
    if (clear && filledSelectors.length > 0) {
      await injectTopFrame(tabId, clearSensitiveSource, [filledSelectors, SENSITIVE_ATTR]).catch(
        () => null,
      );
      forgetSensitiveFields(tabId);
    }
    const auditableStatus: BrowserLoginResultStatus = [
      'authenticated',
      'needs_mfa',
      'captcha_or_takeover',
      'credentials_rejected',
      'selection_required',
      'no_matching_login',
      'unsafe_destination',
      'unknown',
    ].includes(result.status)
      ? (result.status as BrowserLoginResultStatus)
      : 'unknown';
    await reportBrowserLoginResult(itemId, {
      status: auditableStatus,
      pageUrl: normalizedPageUrl,
      toolInvocationId: ctx.callId,
    });
    return result;
  };

  for (const [stepIndex, step] of steps.entries()) {
    const specs = step.fields.map((selector) => fieldBySelector.get(selector));
    if (specs.some((entry) => !entry)) {
      return await finish(
        safeResult('spec_incomplete', {
          reason: 'step_references_undeclared_field',
          message: 'A step referenced a field that was not declared. Nothing else was typed.',
        }),
        true,
      );
    }
    const controlSelector = step.submit.kind === 'none' ? null : step.submit.selector;
    const probe = await injectTopFrame<SpecProbe>(tabId, probeAttemptSpecSource, [
      step.fields,
      controlSelector ? [controlSelector] : [],
    ]).catch(() => null);
    if (!probe || !probe.is_top_frame || probe.origin !== pageUrl.origin) {
      return await finish(
        safeResult('unsafe_destination', { reason: 'origin_changed_during_attempt' }),
        true,
      );
    }
    const missing = step.fields.filter((selector) => !probe.fields[selector]?.exists);
    if (controlSelector && !probe.controls[controlSelector]) missing.push(controlSelector);
    if (missing.length > 0) {
      return await finish(
        safeResult('spec_incomplete', {
          reason: 'selector_not_found',
          message: `The complete step could not be found (${missing.length} selector${missing.length === 1 ? '' : 's'} missing).`,
        }),
        true,
      );
    }
    if (step.fields.some((selector) => probe.fields[selector]?.form_method === 'get')) {
      return await finish(safeResult('unsafe_destination', { reason: 'unsafe_get_form' }), true);
    }

    for (const spec of specs) {
      if (!spec) continue;
      const value = spec.field_key ? credential.fields[spec.field_key] : spec.literal;
      if (typeof value !== 'string') {
        return await finish(
          safeResult('spec_incomplete', {
            reason: 'materialized_field_missing',
            message: 'The server did not return every authorized field. Nothing else was typed.',
          }),
          true,
        );
      }
      if (spec.field_key) {
        rememberSensitiveFields(tabId, [spec.selector]);
        filledSelectors.push(spec.selector);
      }
      const filled = await injectTopFrame<{ ok: boolean }>(tabId, fillFieldSource, [
        spec.selector,
        value,
        spec.field_key ? SENSITIVE_ATTR : '',
      ]).catch(() => null);
      if (!filled?.ok) {
        return await finish(
          safeResult('unknown', { reason: `step_${stepIndex}_fill_failed` }),
          true,
        );
      }
    }

    const submitted = await injectTopFrame<{ ok: boolean; mode: string }>(
      tabId,
      explicitSubmitSource,
      [step.submit.kind, controlSelector],
    ).catch(() => null);
    if (!submitted?.ok) {
      return await finish(
        safeResult(submitted?.mode === 'unsafe_get' ? 'unsafe_destination' : 'unknown', {
          reason: submitted?.mode === 'unsafe_get' ? 'unsafe_get_form' : 'submit_failed',
        }),
        true,
      );
    }
    if (step.wait_for) {
      const appeared = await waitForSelector(
        tabId,
        step.wait_for.selector,
        step.wait_for.timeout_ms,
      );
      if (!appeared) {
        return await finish(
          safeResult('unknown', { reason: `step_${stepIndex}_wait_timed_out` }),
          true,
        );
      }
    }
  }

  const classified = await classifyExplicitAttempt(tabId, pageUrl, args.expect, before, startedAt);
  return await finish(
    safeResult(classified.status, {
      ...(classified.confidence !== undefined ? { confidence: classified.confidence } : {}),
      ...(classified.signals !== undefined ? { signals: classified.signals } : {}),
      ...(classified.evidence !== undefined ? { evidence: classified.evidence } : {}),
    }),
  );
}

async function runAuthenticatorAttempt(
  args: z.infer<typeof AuthenticatorArgs>,
  ctx: Parameters<typeof getAssignedTab>[0],
  tabId: number,
  pageUrl: URL,
  normalizedPageUrl: string,
): Promise<CredentialLoginResult> {
  if (!ctx.conversationId) {
    return safeResult('unknown', { reason: 'conversation_binding_missing' });
  }
  const controlSelector = args.submit.kind === 'none' ? null : args.submit.selector;
  const probe = await injectTopFrame<SpecProbe>(tabId, probeAttemptSpecSource, [
    [args.code_selector],
    controlSelector ? [controlSelector] : [],
  ]).catch(() => null);
  if (!probe || !probe.is_top_frame || probe.origin !== pageUrl.origin) {
    return safeResult('unsafe_destination', { reason: 'origin_changed_before_authenticator' });
  }
  if (
    !probe.fields[args.code_selector]?.exists ||
    (controlSelector && !probe.controls[controlSelector])
  ) {
    return safeResult('spec_incomplete', {
      reason: 'authenticator_selector_not_found',
      message: 'The verification field or submit control was not found. No code was generated.',
    });
  }
  if (probe.fields[args.code_selector]?.form_method === 'get') {
    return safeResult('unsafe_destination', { reason: 'unsafe_get_form' });
  }

  const before = await injectTopFrame<PageStateProbe>(tabId, pageStateSource, []).catch(() => null);
  if (!before) return safeResult('unknown', { reason: 'before_evidence_failed' });
  const startedAt = Date.now();

  const materialized = await materializeBrowserAuthenticator(args.credential_item_id, {
    conversationId: ctx.conversationId,
    toolInvocationId: ctx.callId,
    pageUrl: normalizedPageUrl,
    codeSelector: args.code_selector,
    submit: args.submit,
    extensionInstanceId: chrome.runtime.id,
    clientBuild: chrome.runtime.getManifest().version,
  });
  if (!materialized.ok) return failureResult(materialized.failure, 'authenticator');
  const transient = materialized.data;
  if (transient.origin !== pageUrl.origin || Date.parse(transient.expires_at) <= Date.now()) {
    return safeResult('unsafe_destination', { reason: 'authenticator_origin_or_expiry_mismatch' });
  }

  rememberSensitiveFields(tabId, [args.code_selector]);
  let clear = true;
  let code = transient.code;
  transient.code = '';
  try {
    const filled = await injectTopFrame<{ ok: boolean }>(tabId, fillFieldSource, [
      args.code_selector,
      code,
      SENSITIVE_ATTR,
    ]).catch(() => null);
    code = '';
    // The transient response and the only local code reference are cleared
    // before submission/classification. Neither can reach a result, log,
    // receipt, capture, or persistent store.
    if (!filled?.ok) return safeResult('unknown', { reason: 'authenticator_fill_failed' });

    const submitted = await injectTopFrame<{ ok: boolean; mode: string }>(
      tabId,
      explicitSubmitSource,
      [args.submit.kind, controlSelector],
    ).catch(() => null);
    if (!submitted?.ok) {
      return safeResult(submitted?.mode === 'unsafe_get' ? 'unsafe_destination' : 'unknown', {
        reason:
          submitted?.mode === 'unsafe_get' ? 'unsafe_get_form' : 'authenticator_submit_failed',
      });
    }

    const classified = await classifyExplicitAttempt(
      tabId,
      pageUrl,
      args.expect,
      before,
      startedAt,
    );
    clear = classified.status !== 'authenticated';
    const result = safeResult(classified.status, {
      ...(classified.confidence !== undefined ? { confidence: classified.confidence } : {}),
      ...(classified.signals !== undefined ? { signals: classified.signals } : {}),
      ...(classified.evidence !== undefined ? { evidence: classified.evidence } : {}),
    });
    await reportBrowserLoginResult(args.credential_item_id, {
      status:
        result.status === 'authenticated'
          ? 'authenticated'
          : result.status === 'unsafe_destination'
            ? 'unsafe_destination'
            : result.status === 'credentials_rejected'
              ? 'credentials_rejected'
              : 'needs_mfa',
      pageUrl: normalizedPageUrl,
      toolInvocationId: ctx.callId,
    });
    return result;
  } finally {
    code = '';
    transient.code = '';
    if (clear) {
      await injectTopFrame(tabId, clearSensitiveSource, [
        [args.code_selector],
        SENSITIVE_ATTR,
      ]).catch(() => null);
      forgetSensitiveFields(tabId);
    }
  }
}

export const credential_login: ToolHandler<CredentialLoginArgs, CredentialLoginResult> = {
  name: 'credential_login',
  tier: 'action',
  argsSchema: CredentialLoginArgs,
  // Authenticator use always requires a fresh action-time click, even when
  // ordinary browser actions run in "act" mode. The agent sees only the
  // account/selector/submit spec; never a seed or code.
  tierFor: (args) => (args.action === 'authenticator' ? 'privileged' : 'action'),
  supportedBrowsers: ['chrome'],
  // NOTE: no `admin_only`. The DB is the source of truth (Rule 7,
  // docs/TOOL_SOURCE_OF_TRUTH.md) and `tool.definition.credential_login` says
  // `admin_only = false`, `tier = 'action'`, `category = 'credentials'`.
  // The live `chrome-extension` binding advertises this tool to Assistant and
  // Pilot. Do not re-add a code-side gate; change the DB binding instead.
  run: async (args, ctx) => {
    // ── 1. A real signed-in user, or nothing ───────────────────────────────
    if (!(await hasRealUserToken())) {
      return safeResult('unknown', {
        reason: 'matrx_sign_in_required',
        message:
          'Sign in to Matrx in the extension side panel before using credential_login. The vault does not accept anonymous identities.',
      });
    }

    if (args.action === 'report') {
      const report = ReportArgs.parse(args);
      const reported = await submitBrowserLoginReport({
        kind: report.kind,
        where: report.where,
        ...(report.attempt_id !== undefined ? { attempt_id: report.attempt_id } : {}),
        ...(report.description !== undefined ? { description: report.description } : {}),
      });
      if (!reported.ok) return failureResult(reported.failure, 'report');
      return safeResult('report_received', {
        reason: 'feedback_recorded',
        message: 'The credential-login report was recorded without including a secret value.',
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

    const normalizedPageUrl = `${pageUrl.origin}${pageUrl.pathname}`;

    if (args.action === 'discover') {
      const discover = DiscoverArgs.parse(args);
      const matches = await fetchBrowserLoginMatches(normalizedPageUrl, {
        includeFieldInventory: true,
      });
      if (!matches.ok) return failureResult(matches.failure, 'matches');
      const candidates = discover.credential_item_id
        ? matches.data.matches.filter((match) => match.item_id === discover.credential_item_id)
        : matches.data.matches;
      if (candidates.length === 0) return safeResult('no_matching_login');
      if (candidates.length > 1) {
        return safeResult('selection_required', {
          choices: candidates.map((match) => ({
            credential_item_id: match.item_id,
            display_name: match.display_name,
          })),
          message: 'Several saved logins match this destination. Select one before attempting.',
        });
      }
      const candidate = candidates[0];
      if (!candidate) return safeResult('no_matching_login');
      return safeResult('discovery_ready', {
        reason: 'safe_field_inventory',
        choices: [{ credential_item_id: candidate.item_id, display_name: candidate.display_name }],
        available_fields: candidate.available_fields ?? [],
        non_secret_fields: candidate.non_secret_fields ?? [],
        message: 'Build one complete attempt using field names only; never request their values.',
      });
    }

    if (args.action === 'attempt') {
      return await runCompleteAttempt(
        AttemptArgs.parse(args),
        ctx,
        tabId,
        pageUrl,
        normalizedPageUrl,
      );
    }

    if (args.action === 'authenticator') {
      return await runAuthenticatorAttempt(
        AuthenticatorArgs.parse(args),
        ctx,
        tabId,
        pageUrl,
        normalizedPageUrl,
      );
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
    if (probe.form_method === 'get') {
      return safeResult('unsafe_destination', {
        reason: 'unsafe_get_form',
        message:
          'This page would put the username or password in its URL. Browser login refused before accessing the credential.',
      });
    }

    // ── 4. Resolve which item to use ───────────────────────────────────────
    const automatic = AutoArgs.parse(args);
    let itemId = automatic.credential_item_id ?? null;
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
          const unsafeGet = advanced?.mode === 'unsafe_get';
          return await finish(unsafeGet ? 'unsafe_destination' : 'unknown', {
            reason: unsafeGet ? 'unsafe_get_form' : 'two_step_advance_failed',
            message: unsafeGet
              ? 'This page would put the username in its URL, so the filled field was cleared.'
              : 'No password field and no way to advance past the username step.',
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

      if (probe.form_method === 'get') {
        return await finish('unsafe_destination', {
          reason: 'unsafe_get_form',
          message:
            'This page would put the username or password in its URL, so the filled fields were cleared.',
          clear: true,
        });
      }

      const submitted = await injectTopFrame<{ ok: boolean; mode: string }>(
        tabId,
        submitLoginSource,
        [probe.submit_selector],
      ).catch(() => null);
      if (!submitted?.ok) {
        const unsafeGet = submitted?.mode === 'unsafe_get';
        return await finish(unsafeGet ? 'unsafe_destination' : 'unknown', {
          reason: unsafeGet ? 'unsafe_get_form' : 'no_submit_affordance',
          message: unsafeGet
            ? 'This page would put the username or password in its URL, so the filled fields were cleared.'
            : 'The credential was entered but no submit control could be found; it was cleared.',
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
