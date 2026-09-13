/**
 * One closure-free page-realm dispatcher for every credential DOM operation.
 * Chrome serializes this function verbatim; runtime helpers intentionally live
 * inside it so injected operations cannot drift apart.
 */
export interface BoundLoginGroup {
  anchor: string;
  username: string | null;
  password: string | null;
  usernameOnly: boolean;
  pageUrl: string;
}
export interface ControlledCredentialField {
  selector: string;
  value: string | null;
}
export type FormDestinationKind = 'safe_post' | 'react_action' | 'unsafe';
export interface FormDestination {
  kind: FormDestinationKind;
  reason?: 'method' | 'url' | 'origin' | 'scheme' | 'override';
}
export interface LoginFormProbe {
  is_top_frame: boolean;
  origin: string;
  href: string;
  username_selector: string | null;
  password_selector: string | null;
  submit_selector: string | null;
  destination_safe: boolean;
}
export interface SpecProbe {
  is_top_frame: boolean;
  origin: string;
  fields: Record<string, { exists: boolean; destination_safe: boolean }>;
  controls: Record<string, boolean>;
}
export interface CredentialDomRequestMap {
  classify_form: {
    form: HTMLFormElement | null;
    submitter: Element | null;
    currentUrl: string;
    baseUri: string;
  };
  focused_group: { selector: string };
  attempt_probe: { fieldSelectors: string[]; controlSelectors: string[] };
  auto_probe: {};
  fill: {
    expected: BoundLoginGroup | null;
    requested: ControlledCredentialField[];
    sensitiveAttr: string;
    preserveLegacyFieldBehavior: boolean;
  };
  submit_auto: { selector: string | null };
  submit_explicit: { kind: 'click' | 'press_enter' | 'none'; selector: string | null };
}
export type CredentialDomOperation = keyof CredentialDomRequestMap;
export type CredentialDomInjectedOperation = Exclude<CredentialDomOperation, 'classify_form'>;
export type CredentialDomRequest = {
  [O in CredentialDomOperation]: { operation: O } & CredentialDomRequestMap[O];
}[CredentialDomOperation];
export type CredentialDomInjectedRequest = {
  [O in CredentialDomInjectedOperation]: { operation: O } & CredentialDomRequestMap[O];
}[CredentialDomInjectedOperation];
export interface CredentialDomResultMap {
  classify_form: FormDestination;
  focused_group: BoundLoginGroup | null;
  attempt_probe: SpecProbe;
  auto_probe: LoginFormProbe;
  fill: { ok: boolean; reason?: string };
  submit_auto: { ok: boolean; mode: string };
  submit_explicit: { ok: boolean; mode: string };
}
export type CredentialDomResult<O extends CredentialDomOperation> = CredentialDomResultMap[O];

export function credentialDomSource<O extends CredentialDomOperation>(
  request: { operation: O } & CredentialDomRequestMap[O],
): CredentialDomResult<O>;
export function credentialDomSource(
  request: CredentialDomRequest,
): CredentialDomResultMap[CredentialDomOperation] {
  // Exact React DOM 19.2 and Next vendored literals. Unknown javascript: is unsafe.
  const reactLong =
    "javascript:throw new Error('A React form was unexpectedly submitted. If you called form.submit() manually, consider using form.requestSubmit() instead. If you\\'re trying to use event.stopPropagation() in a submit event handler, consider also calling event.preventDefault().')";
  const nextShort = "javascript:throw new Error('React form unexpectedly submitted.')";
  const result = <T>(value: T): T => value;
  function submitControl(
    control: Element | null,
    form: HTMLFormElement,
  ): control is HTMLButtonElement | HTMLInputElement {
    if (
      !(control instanceof HTMLButtonElement || control instanceof HTMLInputElement) ||
      control.form !== form
    )
      return false;
    const type = control.type.toLowerCase();
    return control instanceof HTMLButtonElement
      ? type === 'submit'
      : type === 'submit' || type === 'image';
  }
  function classifyOne(
    form: HTMLFormElement,
    control: Element | null,
    currentUrl: string,
    baseUri: string,
  ): FormDestination {
    const submitter = submitControl(control, form) ? control : null;
    const rawAction = submitter?.getAttribute('formaction') ?? form.getAttribute('action') ?? '';
    if (rawAction === reactLong || rawAction === nextShort) return { kind: 'react_action' };
    const rawMethod = submitter?.getAttribute('formmethod') ?? form.getAttribute('method') ?? 'get';
    if (rawMethod.toLowerCase() !== 'post') return { kind: 'unsafe', reason: 'method' };
    let target: URL;
    let current: URL;
    try {
      target = new URL(rawAction || currentUrl, rawAction ? baseUri : currentUrl);
      current = new URL(currentUrl);
    } catch {
      return { kind: 'unsafe', reason: 'url' };
    }
    const loopback = /^(localhost|127\.0\.0\.1|\[::1\]|::1)$/.test(target.hostname);
    if (target.origin !== current.origin) return { kind: 'unsafe', reason: 'origin' };
    if (target.protocol !== 'https:' && !(target.protocol === 'http:' && loopback))
      return { kind: 'unsafe', reason: 'scheme' };
    return { kind: 'safe_post' };
  }
  function classify(
    form: HTMLFormElement | null,
    submitter: Element | null,
    currentUrl = location.href,
    baseUri = document.baseURI,
  ): FormDestination {
    if (!form) return { kind: 'safe_post' };
    const selected = submitControl(submitter, form) ? submitter : null;
    const primary = classifyOne(form, selected, currentUrl, baseUri);
    if (primary.kind === 'unsafe') return primary;
    for (const candidate of Array.from(form.elements)) {
      if (!submitControl(candidate, form) || candidate.disabled || candidate === selected) continue;
      if (!candidate.hasAttribute('formaction') && !candidate.hasAttribute('formmethod')) continue;
      if (classifyOne(form, candidate, currentUrl, baseUri).kind === 'unsafe')
        return { kind: 'unsafe', reason: 'override' };
    }
    return primary;
  }
  function focused(selector: string): BoundLoginGroup | null {
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
    const scope = anchor.form ?? anchor.parentElement ?? document.body;
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
    if (classify(anchor.form, null).kind === 'unsafe') return null;
    return {
      anchor: anchorSelector,
      username: usernameSelector,
      password: passwordSelector,
      usernameOnly: !passwordSelector,
      pageUrl: `${location.origin}${location.pathname}`,
    };
  }
  function autoProbe(): LoginFormProbe {
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
      const scope = password.form ?? document.body;
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
    const form = anchor?.form ?? null;
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
      destination_safe: classify(form, submit).kind !== 'unsafe',
    };
  }
  function attemptProbe(fieldSelectors: string[], controlSelectors: string[]): SpecProbe {
    const controls: Record<string, boolean> = {};
    const selected: Record<string, Element | null> = {};
    for (const selector of controlSelectors) {
      try {
        const e = document.querySelector(selector);
        controls[selector] = e instanceof HTMLElement;
        selected[selector] = e;
      } catch {
        controls[selector] = false;
        selected[selector] = null;
      }
    }
    const fields: SpecProbe['fields'] = {};
    for (const selector of fieldSelectors) {
      let e: Element | null = null;
      try {
        e = document.querySelector(selector);
      } catch {}
      const form =
        e instanceof HTMLInputElement ||
        e instanceof HTMLTextAreaElement ||
        e instanceof HTMLButtonElement
          ? e.form
          : (e?.closest('form') ?? null);
      const submit =
        Object.values(selected).find((x) => x && submitControl(x, form as HTMLFormElement)) ?? null;
      fields[selector] = {
        exists: e instanceof HTMLInputElement || e instanceof HTMLTextAreaElement,
        destination_safe: classify(form, submit).kind !== 'unsafe',
      };
    }
    return { is_top_frame: window.top === window.self, origin: location.origin, fields, controls };
  }
  function fill(
    expected: BoundLoginGroup | null,
    requested: ControlledCredentialField[],
    sensitiveAttr: string,
    preserveLegacyFieldBehavior: boolean,
  ): { ok: boolean; reason?: string } {
    function visibleEditable(input: HTMLInputElement | null): input is HTMLInputElement {
      if (!input || input.disabled || input.readOnly || input.type === 'hidden') return false;
      const rect = input.getBoundingClientRect();
      const style = getComputedStyle(input);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== 'none' &&
        style.visibility !== 'hidden'
      );
    }
    function inputFor(selector: string | null): HTMLInputElement | null {
      if (!selector) return null;
      try {
        const node = document.querySelector(selector);
        return node instanceof HTMLInputElement ? node : null;
      } catch {
        return null;
      }
    }
    function write(input: HTMLInputElement, value: string): void {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set;
      if (setter) setter.call(input, value);
      else input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    if (!expected) {
      const field = requested[0];
      if (requested.length !== 1 || !field || field.value === null) return { ok: false };
      const value = field.value;
      const input = inputFor(field.selector);
      if (!visibleEditable(input)) return { ok: false, reason: 'field_not_fillable' };
      // Preserve credential_login's established controlled-field behavior.
      if (sensitiveAttr) input.setAttribute(sensitiveAttr, '');
      if (preserveLegacyFieldBehavior) {
        input.scrollIntoView({ block: 'center', behavior: 'instant' });
        input.focus();
        // Page handlers can mutate association or destination during focus.
        if (!visibleEditable(input) || classify(input.form, null).kind === 'unsafe')
          return { ok: false, reason: 'field_changed_during_focus' };
      }
      write(input, value);
      if (preserveLegacyFieldBehavior) input.dispatchEvent(new Event('blur', { bubbles: true }));
      return { ok: true };
    }

    const group = expected;
    const anchor = inputFor(group.anchor);
    const username = inputFor(group.username);
    const password = inputFor(group.password);
    const originals = { anchor, username, password };

    function sameNode(selector: string | null, node: HTMLInputElement | null): boolean {
      return selector === null
        ? node === null
        : !!node && node.isConnected && document.querySelector(selector) === node;
    }
    function safeGroup(): boolean {
      if (`${location.origin}${location.pathname}` !== group.pageUrl) return false;
      const currentAnchor = originals.anchor;
      if (!sameNode(group.anchor, currentAnchor)) return false;
      if (!sameNode(group.username, originals.username)) return false;
      if (!sameNode(group.password, originals.password)) return false;
      if (!visibleEditable(currentAnchor)) return false;
      if (group.username && !visibleEditable(originals.username)) return false;
      if (group.password && !visibleEditable(originals.password)) return false;
      if (group.usernameOnly !== !group.password) return false;
      const anchorAutocomplete = (currentAnchor.autocomplete || '').toLowerCase();
      const anchorType = (currentAnchor.type || 'text').toLowerCase();
      if (
        !(
          (anchorType === 'password' && anchorAutocomplete !== 'new-password') ||
          anchorAutocomplete === 'username'
        ) ||
        anchorAutocomplete === 'one-time-code' ||
        /otp|mfa|2fa|verification|confirm/i.test(
          `${currentAnchor.name} ${currentAnchor.id} ${currentAnchor.placeholder}`,
        )
      )
        return false;
      const scope = currentAnchor.form ?? currentAnchor.parentElement ?? document.body;
      const inputs = Array.from(scope.querySelectorAll('input')).filter(
        (node): node is HTMLInputElement =>
          node instanceof HTMLInputElement && visibleEditable(node),
      );
      const passwords = inputs.filter((node) => (node.type || '').toLowerCase() === 'password');
      if (passwords.length !== (group.password ? 1 : 0)) return false;
      if (passwords.some((node) => node.autocomplete.toLowerCase() === 'new-password'))
        return false;
      if (group.password && passwords[0] !== originals.password) return false;
      const form = currentAnchor.form;
      if (classify(form, null).kind === 'unsafe') return false;
      return true;
    }
    function clearOwned(written: HTMLInputElement[]): void {
      for (const input of written) {
        const selector = input === originals.username ? group.username : group.password;
        // A history mutation is still the same document, so clear the exact
        // connected node we wrote. Never clear a replacement control.
        if (!sameNode(selector, input)) continue;
        write(input, '');
      }
    }

    const requestedBySelector = new Map(requested.map((field) => [field.selector, field.value]));
    const fields: Array<[HTMLInputElement, string]> = [];
    const usernameValue = group.username ? requestedBySelector.get(group.username) : undefined;
    const passwordValue = group.password ? requestedBySelector.get(group.password) : undefined;
    if (
      group.username &&
      usernameValue !== undefined &&
      usernameValue !== null &&
      originals.username
    )
      fields.push([originals.username, usernameValue]);
    if (
      group.password &&
      passwordValue !== undefined &&
      passwordValue !== null &&
      originals.password
    )
      fields.push([originals.password, passwordValue]);
    if (!safeGroup() || fields.length === 0 || (group.password && passwordValue == null))
      return { ok: false };
    for (const [input] of fields) if (sensitiveAttr) input.setAttribute(sensitiveAttr, '');
    const written: HTMLInputElement[] = [];
    for (const [input, value] of fields) {
      if (!safeGroup()) {
        clearOwned(written);
        return { ok: false };
      }
      write(input, value);
      written.push(input);
    }
    if (safeGroup()) return { ok: true };
    clearOwned(written);
    return { ok: false };
  }
  function submitAuto(selector: string | null): { ok: boolean; mode: string } {
    let el: Element | null = null;
    try {
      el = selector ? document.querySelector(selector) : null;
    } catch {}
    const form =
      (el instanceof HTMLButtonElement || el instanceof HTMLInputElement
        ? el.form
        : el?.closest('form')) ??
      (document.querySelector('input[type="password"],input') as HTMLInputElement | null)?.form ??
      null;
    if (classify(form, el).kind === 'unsafe') return { ok: false, mode: 'unsafe_destination' };
    if (el instanceof HTMLElement && submitControl(el, form as HTMLFormElement)) {
      el.click();
      return { ok: true, mode: 'click' };
    }
    if (!form || typeof form.requestSubmit !== 'function') return { ok: false, mode: 'none' };
    form.requestSubmit();
    return { ok: true, mode: 'form' };
  }
  function explicit(
    kind: 'click' | 'press_enter' | 'none',
    selector: string | null,
  ): { ok: boolean; mode: string } {
    if (kind === 'none') return { ok: true, mode: 'none' };
    let el: Element | null = null;
    try {
      el = selector ? document.querySelector(selector) : null;
    } catch {}
    if (!el) return { ok: false, mode: 'not_found' };
    const form =
      el instanceof HTMLButtonElement || el instanceof HTMLInputElement
        ? el.form
        : el.closest('form');
    if (classify(form, el).kind === 'unsafe') return { ok: false, mode: 'unsafe_destination' };
    if (kind === 'click' && el instanceof HTMLElement) {
      el.click();
      return { ok: true, mode: 'click' };
    }
    if (!form || typeof form.requestSubmit !== 'function')
      return { ok: false, mode: 'request_submit_unavailable' };
    form.requestSubmit();
    return { ok: true, mode: 'press_enter' };
  }
  switch (request.operation) {
    case 'classify_form':
      return result(
        classify(request.form, request.submitter, request.currentUrl, request.baseUri),
      ) as CredentialDomResultMap[CredentialDomOperation];
    case 'focused_group':
      return result(focused(request.selector)) as CredentialDomResultMap[CredentialDomOperation];
    case 'attempt_probe':
      return result(
        attemptProbe(request.fieldSelectors, request.controlSelectors),
      ) as CredentialDomResultMap[CredentialDomOperation];
    case 'auto_probe':
      return result(autoProbe()) as CredentialDomResultMap[CredentialDomOperation];
    case 'fill':
      return result(
        fill(
          request.expected,
          request.requested,
          request.sensitiveAttr,
          request.preserveLegacyFieldBehavior,
        ),
      ) as CredentialDomResultMap[CredentialDomOperation];
    case 'submit_auto':
      return result(submitAuto(request.selector)) as CredentialDomResultMap[CredentialDomOperation];
    case 'submit_explicit':
      return result(
        explicit(request.kind, request.selector),
      ) as CredentialDomResultMap[CredentialDomOperation];
  }
}
