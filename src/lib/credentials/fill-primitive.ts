/**
 * One closure-free page-realm dispatcher for every credential DOM operation.
 * Chrome serializes this function verbatim; runtime helpers intentionally live
 * inside it so injected operations cannot drift apart.
 */
export type CredentialFieldRef = string | { kind: 'registered_input'; id: string };

export interface BoundLoginGroup {
  anchor: CredentialFieldRef;
  username: CredentialFieldRef | null;
  password: CredentialFieldRef | null;
  usernameOnly: boolean;
  pageUrl: string;
  /** Exact Chrome document identity when any member is registry-backed. */
  documentId?: string;
}
export type ControlledCredentialField =
  | { selector: string; value: string | null }
  | { field: CredentialFieldRef; value: string | null };
export interface GeneratedPasswordConstraint {
  minLength: number | null;
  maxLength: number | null;
  pattern: string | null;
  autocomplete: string | null;
  roleEvidence: 'new_password' | 'confirmation';
}
export interface GeneratedPasswordTarget {
  id: string;
  openShadowPath: string[];
  constraint: GeneratedPasswordConstraint;
}
export interface GeneratedPasswordGroup {
  targets: GeneratedPasswordTarget[];
}
export type GeneratedPasswordFillStatus =
  | 'filled'
  | 'refused_unchanged'
  | 'rolled_back'
  | 'partial_manual_check';
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
  focused_group: { selector?: string; field?: CredentialFieldRef; documentId?: string; requirePanelFocus?: boolean; requireDocumentFocus?: boolean };
  attempt_probe: { fieldSelectors: string[]; controlSelectors: string[] };
  auto_probe: {};
  fill: {
    expected: BoundLoginGroup | null;
    requested: ControlledCredentialField[];
    sensitiveAttr: string;
    preserveLegacyFieldBehavior: boolean;
    requirePanelFocus?: boolean;
  };
  discover_new_password_groups: { documentId: string; expiresAt: number };
  fill_new_password_group: {
    documentId: string;
    expiresAt: number;
    targets: GeneratedPasswordTarget[];
    value: string;
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
  discover_new_password_groups: { groups: GeneratedPasswordGroup[]; reason?: 'registry_unavailable' };
  fill_new_password_group: { status: GeneratedPasswordFillStatus; reason?: string };
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
  function focused(ref: CredentialFieldRef, documentId?: string, requirePanelFocus = false, requireDocumentFocus = false): BoundLoginGroup | null {
    const selector = typeof ref === 'string' ? ref : null;
    const deepActive = (): Element | null => {
      let active: Element | null = document.activeElement;
      while (active instanceof HTMLElement && active.shadowRoot?.mode === 'open') active = active.shadowRoot.activeElement;
      return active;
    };
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
      if (selector) {
        const matches = document.querySelectorAll(selector);
        if (matches.length !== 1 || !(matches[0] instanceof HTMLInputElement)) return null;
        anchor = matches[0];
      } else {
        anchor = documentId ? window.__matrx_generation_target_registry__?.resolveInput((ref as { id: string }).id, documentId) ?? null : null;
        if (!anchor) return null;
      }
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
    const inputs = (scope instanceof HTMLFormElement
      ? Array.from(scope.elements).filter(
          (node): node is HTMLInputElement =>
            node instanceof HTMLInputElement &&
            node.form === scope &&
            node.ownerDocument === document &&
            node.isConnected &&
            node.getRootNode() === scope.getRootNode(),
        )
      : Array.from(scope.querySelectorAll<HTMLInputElement>('input'))
    ).filter(visibleEditable);
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
    const registry = window.__matrx_generation_target_registry__;
    const refFor = (input: HTMLInputElement | null): CredentialFieldRef | null => {
      if (!input) return null;
      if (input === anchor) return ref;
      if (typeof ref !== 'string') {
        const id = registry?.registerInput(input);
        return id ? { kind: 'registered_input', id } : null;
      }
      const selector = selectorFor(input);
      return selector;
    };
    const anchorSelector: CredentialFieldRef = ref;
    const usernameSelector = refFor(username);
    const passwordSelector = refFor(password);
    if ((username && !usernameSelector) || (password && !passwordSelector)) return null;
    if (
      requirePanelFocus &&
      (deepActive() !== anchor && deepActive() !== username && deepActive() !== password)
    )
      return null;
    if (requireDocumentFocus && !document.hasFocus()) return null;
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
      ...(typeof ref !== 'string' && documentId ? { documentId } : {}),
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
  function generatedPasswordGroups(documentId: string, expiresAt: number): {
    groups: GeneratedPasswordGroup[];
    reason?: 'registry_unavailable';
  } {
    const registry = window.__matrx_generation_target_registry__;
    if (!registry || !documentId || !Number.isFinite(expiresAt) || expiresAt <= Date.now())
      return { groups: [], reason: 'registry_unavailable' };
    const visibleEditable = (input: HTMLInputElement) => {
      const rect = input.getBoundingClientRect();
      const style = getComputedStyle(input);
      return (
        input.isConnected &&
        !input.disabled &&
        !input.readOnly &&
        input.type.toLowerCase() === 'password' &&
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== 'none' &&
        style.visibility !== 'hidden'
      );
    };
    const pathFor = (input: HTMLInputElement): string[] => {
      const path: string[] = [];
      let root: Node = input.getRootNode();
      while (root instanceof ShadowRoot) {
        const host = root.host;
        const parent = host.parentElement;
        if (!parent) return [];
        const index = Array.from(parent.children).indexOf(host);
        path.unshift(`${host.tagName.toLowerCase()}:${index}`);
        root = host.getRootNode();
      }
      return path;
    };
    const candidates: HTMLInputElement[] = [];
    const visit = (root: Document | ShadowRoot) => {
      for (const input of Array.from(root.querySelectorAll<HTMLInputElement>('input[type="password"]')))
        if (visibleEditable(input)) candidates.push(input);
      for (const host of Array.from(root.querySelectorAll<HTMLElement>('*')))
        if (host.shadowRoot) visit(host.shadowRoot);
    };
    visit(document);
    const description = (input: HTMLInputElement) =>
      `${input.name} ${input.id} ${input.placeholder} ${input.getAttribute('aria-label') ?? ''} ${
        Array.from(input.labels ?? []).map((label) => label.textContent ?? '').join(' ')
      }`.toLowerCase();
    const excluded = (input: HTMLInputElement): boolean => {
      const auto = input.autocomplete.toLowerCase();
      const text = description(input);
      return auto === 'current-password' || auto === 'one-time-code' || /\b(otp|mfa|2fa|verification)\b/.test(text);
    };
    const role = (input: HTMLInputElement): 'new_password' | 'confirmation' | null => {
      const auto = input.autocomplete.toLowerCase();
      const text = description(input);
      if (excluded(input)) return null;
      const confirmation = /\b(confirm|confirmation|repeat|re-enter|reenter|again)\b/.test(text);
      if (auto === 'new-password') return confirmation ? 'confirmation' : 'new_password';
      return !confirmation && /\b(new|create|choose|set|reset|change)\b/.test(text) && /password|passcode/.test(text)
        ? 'new_password'
        : confirmation && /password|passcode/.test(text)
          ? 'confirmation'
          : null;
    };
    const scopeFor = (input: HTMLInputElement): Element | null =>
      input.closest('fieldset,[role="group"],[data-password-group]') ?? input.form;
    const groups: GeneratedPasswordGroup[] = [];
    const seen = new Set<Element>();
    for (const primary of candidates.filter((input) => role(input) === 'new_password')) {
      const scope = scopeFor(primary);
      if (!scope || seen.has(scope)) continue;
      seen.add(scope);
      const scoped = candidates.filter((candidate) => scopeFor(candidate) === scope);
      const primaries = scoped.filter((candidate) => role(candidate) === 'new_password');
      const confirmations = scoped.filter((candidate) => role(candidate) === 'confirmation');
      // A second possible primary or an unclassified password is ambiguous.
      if (
        primaries.length !== 1 ||
        scoped.some((candidate) => role(candidate) === null && !excluded(candidate)) ||
        confirmations.some((candidate) => candidate.autocomplete.toLowerCase() === 'current-password')
      )
        continue;
      // The selected controls may be explicitly associated with a different
      // form than their visual group. Every destination must therefore be
      // admitted through the same classifier used by saved-login fill.
      const selectedInputs = [primaries[0], ...confirmations].filter(
        (input): input is HTMLInputElement => Boolean(input),
      );
      if (selectedInputs.some((input) => classify(input.form, null).kind === 'unsafe')) continue;
      const targets: GeneratedPasswordTarget[] = [];
      for (const input of selectedInputs) {
        const targetId = registry.register(input, scope, documentId, expiresAt);
        if (!targetId) {
          registry.invalidate(targets.map((target) => target.id));
          return { groups: [], reason: 'registry_unavailable' };
        }
        targets.push({
          id: targetId,
          openShadowPath: pathFor(input),
          constraint: {
            minLength: input.minLength >= 0 ? input.minLength : null,
            maxLength: input.maxLength >= 0 ? input.maxLength : null,
            pattern: input.getAttribute('pattern'),
            autocomplete: input.autocomplete || null,
            roleEvidence: role(input) as 'new_password' | 'confirmation',
          },
        });
      }
      if (!registry.bindGroup(targets.map((target) => target.id))) {
        registry.invalidate(targets.map((target) => target.id));
        return { groups: [], reason: 'registry_unavailable' };
      }
      groups.push({ targets });
    }
    return { groups };
  }
  function fillGeneratedPasswordGroup(
    documentId: string,
    expiresAt: number,
    targets: GeneratedPasswordTarget[],
    value: string,
  ): { status: GeneratedPasswordFillStatus; reason?: string } {
    const registry = window.__matrx_generation_target_registry__;
    if (!registry || !documentId || !Number.isFinite(expiresAt) || expiresAt <= Date.now() || expiresAt - Date.now() > 30_000)
      return { status: 'refused_unchanged', reason: 'expired_or_unavailable' };
    if (!value || !Array.isArray(targets) || targets.length === 0)
      return { status: 'refused_unchanged', reason: 'invalid_request' };
    if (typeof registry.markSensitive !== 'function')
      return { status: 'refused_unchanged', reason: 'registry_unavailable' };
    if (!registry.claim(targets.map((target) => target.id), documentId, expiresAt))
      return { status: 'refused_unchanged', reason: 'already_used_or_changed' };
    const resolved = targets.map((target) => registry.resolve(target.id, documentId, expiresAt));
    if (resolved.some((input) => !input))
      return { status: 'refused_unchanged', reason: 'target_changed' };
    const inputs = resolved as HTMLInputElement[];
    const textFor = (input: HTMLInputElement) =>
      `${input.name} ${input.id} ${input.placeholder} ${input.getAttribute('aria-label') ?? ''} ${
        Array.from(input.labels ?? []).map((label) => label.textContent ?? '').join(' ')
      }`.toLowerCase();
    const roleFor = (input: HTMLInputElement): 'new_password' | 'confirmation' | null => {
      const text = textFor(input);
      const auto = input.autocomplete.toLowerCase();
      if (auto === 'current-password' || auto === 'one-time-code' || /\b(otp|mfa|2fa|verification)\b/.test(text)) return null;
      const confirmation = /\b(confirm|confirmation|repeat|re-enter|reenter|again)\b/.test(text);
      if (auto === 'new-password') return confirmation ? 'confirmation' : 'new_password';
      return !confirmation && /\b(new|create|choose|set|reset|change)\b/.test(text) && /password|passcode/.test(text)
        ? 'new_password'
        : confirmation && /password|passcode/.test(text) ? 'confirmation' : null;
    };
    const scopeFor = (input: HTMLInputElement): Element | null =>
      input.closest('fieldset,[role="group"],[data-password-group]') ?? input.form;
    const shadowPathFor = (input: HTMLInputElement): string[] => {
      const path: string[] = [];
      let root: Node = input.getRootNode();
      while (root instanceof ShadowRoot) {
        const host = root.host;
        const parent = host.parentElement;
        if (!parent) return [];
        path.unshift(`${host.tagName.toLowerCase()}:${Array.from(parent.children).indexOf(host)}`);
        root = host.getRootNode();
      }
      return path;
    };
    const samePath = (left: string[], right: string[]) =>
      left.length === right.length && left.every((part, index) => part === right[index]);
    const group = scopeFor(inputs[0]!);
    const destinationsValid = () =>
      inputs.every((input) => classify(input.form, null).kind !== 'unsafe');
    const wholeGroupValid = () => {
      if (!group) return false;
      const currentMembers = group
        ? Array.from(group.querySelectorAll<HTMLInputElement>('input[type="password"]')).filter((input) => {
            const text = textFor(input);
            return input.isConnected && input.type.toLowerCase() === 'password' &&
              input.autocomplete.toLowerCase() !== 'current-password' && input.autocomplete.toLowerCase() !== 'one-time-code' &&
              !/\b(otp|mfa|2fa|verification)\b/.test(text);
          })
        : [];
      if (currentMembers.length !== inputs.length || currentMembers.some((input) => !inputs.includes(input))) return false;
      return inputs.every((input, index) =>
        registry.belongsTo(targets[index]!.id, input, group) &&
        scopeFor(input) === group &&
        roleFor(input) === targets[index]!.constraint.roleEvidence &&
        samePath(shadowPathFor(input), targets[index]!.openShadowPath),
      ) &&
      targets.filter((target) => target.constraint.roleEvidence === 'new_password').length === 1;
    };
    if (!wholeGroupValid() || !destinationsValid())
      return { status: 'refused_unchanged', reason: 'ambiguous_group' };
    const visibleEditable = (input: HTMLInputElement) => {
      const rect = input.getBoundingClientRect();
      const style = getComputedStyle(input);
      return input.isConnected && !input.disabled && !input.readOnly && input.type.toLowerCase() === 'password' && rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const compatible = (input: HTMLInputElement): boolean => {
      if (!visibleEditable(input) || input.autocomplete.toLowerCase() === 'current-password' || input.autocomplete.toLowerCase() === 'one-time-code') return false;
      if ((input.minLength >= 0 && value.length < input.minLength) || (input.maxLength >= 0 && value.length > input.maxLength)) return false;
      const pattern = input.getAttribute('pattern');
      if (pattern !== null) {
        try {
          if (!(new RegExp(`^(?:${pattern})$`, 'v')).test(value)) return false;
        } catch {
          return false;
        }
      }
      return true;
    };
    const hasUnsupportedPattern = inputs.some((input) => {
      const pattern = input.getAttribute('pattern');
      if (pattern === null) return false;
      try { new RegExp(`^(?:${pattern})$`, 'v'); return false; } catch { return true; }
    });
    if (hasUnsupportedPattern) return { status: 'refused_unchanged', reason: 'unsupported_constraint' };
    if (!inputs.every(compatible)) return { status: 'refused_unchanged', reason: 'constraint_changed' };
    const originals = inputs.map((input) => input.value);
    const setValue = (input: HTMLInputElement, next: string): boolean => {
      try {
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set;
        if (setter) setter.call(input, next);
        else input.value = next;
        return true;
      } catch { return false; }
    };
    const dispatchOne = (input: HTMLInputElement, type: 'input' | 'change'): boolean => {
      try {
        input.dispatchEvent(new Event(type, { bubbles: true }));
        return true;
      } catch {
        return false;
      }
    };
    const current = () => targets.map((target) => registry.resolve(target.id, documentId, expiresAt));
    const attempted: number[] = [];
    const rollback = (): GeneratedPasswordFillStatus => {
      let complete = true;
      for (const index of attempted) {
        const input = inputs[index];
        const original = originals[index];
        if (!input || original === undefined || current()[index] !== input || input.value !== value) {
          complete = false;
          continue;
        }
        if (!setValue(input, original) || input.value !== original || !dispatchOne(input, 'input') || current()[index] !== input || input.value !== original || !dispatchOne(input, 'change') || current()[index] !== input || input.value !== original) complete = false;
      }
      if (attempted.some((index) => current()[index] !== inputs[index] || inputs[index]?.value !== originals[index])) complete = false;
      return complete ? 'rolled_back' : 'partial_manual_check';
    };
    for (let index = 0; index < inputs.length; index++) {
      const input = inputs[index];
      if (!input || current()[index] !== input || !wholeGroupValid() || !destinationsValid() || !inputs.every(compatible))
        return attempted.length ? { status: rollback() } : { status: 'refused_unchanged', reason: 'target_changed' };
      if (!registry.markSensitive(input))
        return attempted.length ? { status: rollback() } : { status: 'refused_unchanged', reason: 'registry_unavailable' };
      // Record before the setter: a controlled setter may mutate then throw.
      attempted.push(index);
      if (!setValue(input, value) || current()[index] !== input || !wholeGroupValid() || !destinationsValid() || !inputs.every(compatible) || input.value !== value)
        return { status: rollback() };
      if (!dispatchOne(input, 'input') || current()[index] !== input || !wholeGroupValid() || !destinationsValid() || !inputs.every(compatible) || attempted.some((attemptedIndex) => inputs[attemptedIndex]?.value !== value))
        return { status: rollback() };
      if (!dispatchOne(input, 'change')) return { status: rollback() };
      if (
        current()[index] !== input ||
        !wholeGroupValid() ||
        !destinationsValid() ||
        !inputs.every(compatible) ||
        attempted.some((attemptedIndex) => inputs[attemptedIndex]?.value !== value)
      )
        return { status: rollback() };
    }
    registry.invalidate(targets.map((target) => target.id));
    return { status: 'filled' };
  }
  function fill(
    expected: BoundLoginGroup | null,
    requested: ControlledCredentialField[],
    sensitiveAttr: string,
    preserveLegacyFieldBehavior: boolean,
    requirePanelFocus = false,
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
    function inputFor(ref: CredentialFieldRef | null, documentId?: string): HTMLInputElement | null {
      if (!ref) return null;
      if (typeof ref !== 'string') return documentId ? window.__matrx_generation_target_registry__?.resolveInput(ref.id, documentId) ?? null : null;
      try { const node = document.querySelector(ref); return node instanceof HTMLInputElement ? node : null; } catch { return null; }
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
      const input = inputFor('field' in field ? field.field : field.selector);
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
    const documentId = group.documentId;
    const anchor = inputFor(group.anchor, documentId);
    const username = inputFor(group.username, documentId);
    const password = inputFor(group.password, documentId);
    const originals = { anchor, username, password };

    function sameNode(ref: CredentialFieldRef | null, node: HTMLInputElement | null): boolean {
      if (ref === null) return node === null;
      if (!node?.isConnected) return false;
      if (typeof ref !== 'string') return !!documentId && window.__matrx_generation_target_registry__?.isRegisteredInput(ref.id, node) === true;
      try { return document.querySelector(ref) === node; } catch { return false; }
    }
    const originalScope = anchor?.form ?? anchor?.parentElement ?? document.body;
    function safeGroup(): boolean {
      if (`${location.origin}${location.pathname}` !== group.pageUrl) return false;
      const currentAnchor = originals.anchor;
      if (!sameNode(group.anchor, currentAnchor)) return false;
      // Optional field references can be absent at the injected boundary. An
      // absent reference has the same one-field shape as null; the anchor
      // remains strict and every resolved field is still bound to its node.
      if (!sameNode(group.username ?? null, originals.username)) return false;
      if (!sameNode(group.password ?? null, originals.password)) return false;
      if (!visibleEditable(currentAnchor)) return false;
      if (requirePanelFocus && document.visibilityState !== 'visible') return false;
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
      // A selector can continue to resolve after a site moves the same node.
      // Its original group root is part of the bound ownership contract.
      if (scope !== originalScope) return false;
      const inputs = (scope instanceof HTMLFormElement
        ? Array.from(scope.elements).filter(
            (node): node is HTMLInputElement =>
              node instanceof HTMLInputElement &&
              node.form === scope &&
              node.ownerDocument === document &&
              node.isConnected &&
              node.getRootNode() === scope.getRootNode(),
          )
        : Array.from(scope.querySelectorAll('input'))
      ).filter((node): node is HTMLInputElement => node instanceof HTMLInputElement && visibleEditable(node));
      const passwords = inputs.filter((node) => (node.type || '').toLowerCase() === 'password');
      if (passwords.length !== (group.password ? 1 : 0)) return false;
      if (passwords.some((node) => node.autocomplete.toLowerCase() === 'new-password'))
        return false;
      if (group.password && passwords[0] !== originals.password) return false;
      let active: Element | null = document.activeElement;
      while (active instanceof HTMLElement && active.shadowRoot?.mode === 'open')
        active = active.shadowRoot.activeElement;
      if (
        requirePanelFocus &&
        active !== originals.anchor &&
        active !== originals.username &&
        active !== originals.password
      )
        return false;
      const form = currentAnchor.form;
      if (classify(form, null).kind === 'unsafe') return false;
      return true;
    }

    const refKey = (ref: CredentialFieldRef) => typeof ref === 'string' ? `selector:${ref}` : `registered:${ref.id}`;
    const requestedBySelector = new Map(requested.map((field) => [refKey('field' in field ? field.field : field.selector), field.value]));
    const fields: Array<{
      input: HTMLInputElement;
      selector: CredentialFieldRef;
      value: string;
      original: string;
      attempted: boolean;
    }> = [];
    const usernameValue = group.username ? requestedBySelector.get(refKey(group.username)) : undefined;
    const passwordValue = group.password ? requestedBySelector.get(refKey(group.password)) : undefined;
    if (
      group.username &&
      usernameValue !== undefined &&
      usernameValue !== null &&
      originals.username
    )
      fields.push({
        input: originals.username,
        selector: group.username,
        value: usernameValue,
        original: originals.username.value,
        attempted: false,
      });
    if (
      group.password &&
      passwordValue !== undefined &&
      passwordValue !== null &&
      originals.password
    )
      fields.push({
        input: originals.password,
        selector: group.password,
        value: passwordValue,
        original: originals.password.value,
        attempted: false,
      });
    if (!safeGroup() || fields.length === 0 || (group.password && passwordValue == null))
      return { ok: false };
    const registry = window.__matrx_generation_target_registry__;
    for (const field of fields) {
      if (typeof field.selector !== 'string' && !registry?.markSensitive(field.input))
        return { ok: false };
      if (sensitiveAttr) field.input.setAttribute(sensitiveAttr, '');
    }

    const safely = (predicate: () => boolean): boolean => {
      try {
        return predicate();
      } catch {
        return false;
      }
    };
    const safeGroupNow = () => safely(safeGroup);
    const sameField = (field: (typeof fields)[number]) =>
      safely(
        () =>
          field.input.isConnected &&
          (field.input.form ?? field.input.parentElement ?? document.body) === originalScope &&
          sameNode(field.selector, field.input),
      );
    const exactWritten = (field: (typeof fields)[number]) =>
      safely(() => sameField(field) && field.input.value === field.value);
    const exactOriginal = (field: (typeof fields)[number]) =>
      safely(() => sameField(field) && field.input.value === field.original);
    const setBoundValue = (input: HTMLInputElement, value: string): boolean => {
      try {
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set;
        if (setter) setter.call(input, value);
        else input.value = value;
        return true;
      } catch {
        return false;
      }
    };
    const dispatchBound = (input: HTMLInputElement, type: 'input' | 'change'): boolean => {
      try {
        input.dispatchEvent(new Event(type, { bubbles: true }));
        return true;
      } catch {
        return false;
      }
    };
    const stillWritten = () => fields.filter((field) => field.attempted).every(exactWritten);
    let unattemptedChanged = false;
    const unattemptedOriginal = () => {
      const unchanged = fields.filter((field) => !field.attempted).every(exactOriginal);
      if (!unchanged) unattemptedChanged = true;
      return unchanged;
    };
    const writeField = (field: (typeof fields)[number]): boolean => {
      if (!unattemptedOriginal()) return false;
      // Set this before the setter: a controlled setter may mutate then throw.
      field.attempted = true;
      if (
        !setBoundValue(field.input, field.value) ||
        !safeGroupNow() ||
        !exactWritten(field) ||
        !stillWritten() ||
        !unattemptedOriginal()
      )
        return false;
      if (
        !dispatchBound(field.input, 'input') ||
        !safeGroupNow() ||
        !exactWritten(field) ||
        !stillWritten() ||
        !unattemptedOriginal()
      )
        return false;
      return (
        dispatchBound(field.input, 'change') &&
        safeGroupNow() &&
        exactWritten(field) &&
        stillWritten() &&
        unattemptedOriginal()
      );
    };
    const rollback = (): { ok: false; reason?: string } => {
      let complete = true;
      for (const field of fields.filter((candidate) => candidate.attempted)) {
        // A replacement or a site edit is no longer extension-owned. Preserve it.
        if (!exactWritten(field)) {
          complete = false;
          continue;
        }
        const setterRestored = setBoundValue(field.input, field.original);
        if (!setterRestored || !exactOriginal(field)) {
          complete = false;
          continue;
        }
        const inputRestored = dispatchBound(field.input, 'input');
        if (!inputRestored || !exactOriginal(field)) {
          complete = false;
          continue;
        }
        const changeRestored = dispatchBound(field.input, 'change');
        if (!changeRestored || !exactOriginal(field)) complete = false;
      }
      if (
        unattemptedChanged ||
        fields.some((field) => !exactOriginal(field))
      )
        complete = false;
      return complete ? { ok: false } : { ok: false, reason: 'partial_manual_check' };
    };
    for (const field of fields) {
      if (
        !safeGroupNow() ||
        !stillWritten() ||
        !unattemptedOriginal() ||
        !writeField(field)
      )
        return rollback();
    }
    return safeGroupNow() && stillWritten() ? { ok: true } : rollback();
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
      return result(
        request.field ? focused(request.field, request.documentId, request.requirePanelFocus, request.requireDocumentFocus) : request.selector ? focused(request.selector, request.documentId, request.requirePanelFocus, request.requireDocumentFocus) : null,
      ) as CredentialDomResultMap[CredentialDomOperation];
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
          request.requirePanelFocus,
        ),
      ) as CredentialDomResultMap[CredentialDomOperation];
    case 'discover_new_password_groups':
      return result(
        generatedPasswordGroups(request.documentId, request.expiresAt),
      ) as CredentialDomResultMap[CredentialDomOperation];
    case 'fill_new_password_group':
      return result(
        fillGeneratedPasswordGroup(
          request.documentId,
          request.expiresAt,
          request.targets,
          request.value,
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
