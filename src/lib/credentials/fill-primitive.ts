/**
 * Shared, self-contained page-realm primitive for value-bearing credential
 * writes. It intentionally has no module bindings so Chrome can serialize it.
 *
 * Both credential_login and inline saved-login selection use this one writer.
 * The former keeps its single-field focus/scroll/blur behavior; the latter
 * supplies a bound login group and gets exact-node revalidation before every
 * write.
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

export function fillControlledCredentialFieldsSource(
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
      rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'
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
    if (!sameNode(group.anchor, originals.anchor)) return false;
    if (!sameNode(group.username, originals.username)) return false;
    if (!sameNode(group.password, originals.password)) return false;
    if (!visibleEditable(originals.anchor)) return false;
    if (group.username && !visibleEditable(originals.username)) return false;
    if (group.password && !visibleEditable(originals.password)) return false;
    if (group.usernameOnly !== !group.password) return false;
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
    if (passwords.length !== (group.password ? 1 : 0)) return false;
    if (passwords.some((node) => node.autocomplete.toLowerCase() === 'new-password')) return false;
    if (group.password && passwords[0] !== originals.password) return false;
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
  if (group.username && usernameValue !== undefined && usernameValue !== null && originals.username)
    fields.push([originals.username, usernameValue]);
  if (group.password && passwordValue !== undefined && passwordValue !== null && originals.password)
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
