/**
 * Shared, self-contained page-realm primitive for value-bearing credential
 * writes. It intentionally has no module bindings so Chrome can serialize it.
 */
export function fillSensitiveFieldSource(
  selector: string,
  value: string,
  sensitiveAttr: string,
): { ok: boolean; reason?: string } {
  const el = document.querySelector(selector) as HTMLInputElement | null;
  if (!el) return { ok: false, reason: 'field_not_found' };
  if (el.disabled || el.readOnly || el.type === 'hidden')
    return { ok: false, reason: 'field_not_fillable' };
  const rect = el.getBoundingClientRect();
  const style = getComputedStyle(el);
  if (
    rect.width === 0 ||
    rect.height === 0 ||
    style.display === 'none' ||
    style.visibility === 'hidden'
  )
    return { ok: false, reason: 'field_not_fillable' };
  // Preserve the legacy credential_login contract: some sites only validate
  // controlled fields after focus/blur, and agents expect the field in view.
  // Mark before any page-controlled event so redaction survives an interruption.
  if (sensitiveAttr) el.setAttribute(sensitiveAttr, '');
  el.scrollIntoView({ block: 'center', behavior: 'instant' });
  el.focus();
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.dispatchEvent(new Event('blur', { bubbles: true }));
  return { ok: true };
}

export interface BoundLoginGroup {
  anchor: string;
  username: string | null;
  password: string | null;
  usernameOnly: boolean;
  pageUrl: string;
}

/**
 * The value-bearing inline path. It is deliberately self-contained because
 * Chrome serializes it into the page realm. Resolve and bind every input once,
 * then require those exact nodes and the entire safe form classification before
 * every write. A page event must never redirect a later secret to a replacement
 * control.
 */
export function fillBoundLoginGroupSource(
  expected: BoundLoginGroup,
  usernameValue: string | null,
  passwordValue: string | null,
  sensitiveAttr: string,
): { ok: boolean } {
  function visibleEditable(input: HTMLInputElement | null): input is HTMLInputElement {
    if (!input || input.disabled || input.readOnly || input.type === 'hidden') return false;
    const rect = input.getBoundingClientRect();
    const style = getComputedStyle(input);
    return (
      rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'
    );
  }
  function inputFor(selector: string | null): HTMLInputElement | null {
    if (!selector) return null;
    const node = document.querySelector(selector);
    return node instanceof HTMLInputElement ? node : null;
  }
  const anchor = inputFor(expected.anchor);
  const username = inputFor(expected.username);
  const password = inputFor(expected.password);
  const originals = { anchor, username, password };

  function sameNode(selector: string | null, node: HTMLInputElement | null): boolean {
    return selector === null
      ? node === null
      : !!node && node.isConnected && document.querySelector(selector) === node;
  }
  function safeGroup(): boolean {
    if (`${location.origin}${location.pathname}` !== expected.pageUrl) return false;
    if (!sameNode(expected.anchor, originals.anchor)) return false;
    if (!sameNode(expected.username, originals.username)) return false;
    if (!sameNode(expected.password, originals.password)) return false;
    if (!visibleEditable(originals.anchor)) return false;
    if (expected.username && !visibleEditable(originals.username)) return false;
    if (expected.password && !visibleEditable(originals.password)) return false;
    if (expected.usernameOnly !== !expected.password) return false;
    const anchorAutocomplete = (originals.anchor.autocomplete || '').toLowerCase();
    const anchorType = (originals.anchor.type || 'text').toLowerCase();
    if (
      !(
        (anchorType === 'password' && anchorAutocomplete !== 'new-password') ||
        anchorAutocomplete === 'username'
      ) ||
      anchorAutocomplete === 'one-time-code' ||
      /otp|mfa|2fa|verification|confirm/i.test(
        `${originals.anchor.name} ${originals.anchor.id} ${originals.anchor.placeholder}`,
      )
    )
      return false;
    const scope =
      originals.anchor.closest('form') ?? originals.anchor.parentElement ?? document.body;
    const inputs = Array.from(scope.querySelectorAll('input')).filter(
      (node): node is HTMLInputElement => node instanceof HTMLInputElement && visibleEditable(node),
    );
    const passwords = inputs.filter((node) => (node.type || '').toLowerCase() === 'password');
    if (passwords.length !== (expected.password ? 1 : 0)) return false;
    if (passwords.some((node) => node.autocomplete.toLowerCase() === 'new-password')) return false;
    if (expected.password && passwords[0] !== originals.password) return false;
    const form = originals.anchor.closest('form');
    if (form) {
      const action = form.getAttribute('action');
      if ((form.method || 'get').toLowerCase() === 'get') return false;
      if (action) {
        const destination = new URL(action, location.href);
        const localhost = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
        if (
          destination.origin !== location.origin ||
          (destination.protocol !== 'https:' && !(destination.protocol === 'http:' && localhost))
        )
          return false;
      }
    }
    return true;
  }
  function clearOwned(written: HTMLInputElement[]): void {
    if (`${location.origin}${location.pathname}` !== expected.pageUrl) return;
    for (const input of written) {
      const selector = input === originals.username ? expected.username : expected.password;
      // Clear only an original node that still belongs to this document. A
      // replacement control is deliberately never touched.
      if (!sameNode(selector, input)) continue;
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set;
      if (setter) setter.call(input, '');
      else input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }
  const fields: Array<[HTMLInputElement, string]> = [];
  if (expected.username && usernameValue !== null && originals.username)
    fields.push([originals.username, usernameValue]);
  if (expected.password && passwordValue !== null && originals.password)
    fields.push([originals.password, passwordValue]);
  if (!safeGroup() || fields.length === 0 || (expected.password && passwordValue === null))
    return { ok: false };
  for (const [input] of fields) if (sensitiveAttr) input.setAttribute(sensitiveAttr, '');
  const written: HTMLInputElement[] = [];
  for (const [input, value] of fields) {
    if (!safeGroup()) {
      clearOwned(written);
      return { ok: false };
    }
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set;
    if (setter) setter.call(input, value);
    else input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    written.push(input);
  }
  if (safeGroup()) return { ok: true };
  clearOwned(written);
  return { ok: false };
}
