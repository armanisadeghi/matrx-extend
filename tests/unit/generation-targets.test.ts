import { credentialDomSource } from '@/lib/credentials/fill-primitive';
import {
  GENERATED_SECRET_TTL_MS,
  mountGenerationTargetRegistry,
} from '@/lib/credentials/generation-targets';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Execute the exact closure-free source Chrome receives. The registry is the
// only persistent isolated-world dependency, mounted exactly as bridge.ts does.
const dispatcher = new Function(`return (${credentialDomSource.toString()});`)() as typeof credentialDomSource;
const documentId = 'document-primitive-test';
const expiresAt = () => Date.now() + GENERATED_SECRET_TTL_MS;

function visible(input: HTMLInputElement): void {
  Object.defineProperty(input, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ width: 120, height: 24, top: 0, left: 0, bottom: 24, right: 120 }),
  });
}
function mount(html: string): HTMLFormElement {
  document.body.innerHTML = html;
  const form = document.querySelector('form') as HTMLFormElement;
  for (const input of Array.from(document.querySelectorAll('input'))) visible(input);
  return form;
}
function discover(expiry = expiresAt()) {
  return dispatcher({ operation: 'discover_new_password_groups', documentId, expiresAt: expiry });
}

afterEach(() => {
  document.body.innerHTML = '';
  window.__matrx_generation_target_registry__?.invalidate();
});

describe('generated password DOM primitive', () => {
  it('offers only a new-password field and its unambiguous confirmation without reading values', () => {
    mount(`
      <form method=post action="/change"><input id=current type=password autocomplete=current-password value=old>
      <input id=new type=password autocomplete=new-password minlength=12 maxlength=32 pattern="[A-Za-z0-9]+">
      <input id=confirm type=password autocomplete=new-password aria-label="Confirm new password"></form>
    `);
    mountGenerationTargetRegistry();
    const offer = discover();
    expect(offer.reason).toBeUndefined();
    expect(offer.groups).toHaveLength(1);
    expect(offer.groups[0]?.targets.map((target) => target.constraint.roleEvidence)).toEqual([
      'new_password',
      'confirmation',
    ]);
    expect(offer.groups[0]?.targets[0]?.constraint).toMatchObject({
      minLength: 12,
      maxLength: 32,
      autocomplete: 'new-password',
    });
    expect(JSON.stringify(offer)).not.toContain('old');
  });

  it('refuses current-password, OTP, and contradictory password groups', () => {
    mount(`
      <form method=post action="/change"><input type=password autocomplete=current-password>
      <input type=password autocomplete=one-time-code>
      <input type=password autocomplete=new-password>
      <input type=password aria-label="mystery password"></form>
    `);
    mountGenerationTargetRegistry();
    expect(discover().groups).toEqual([]);
  });

  it('refuses generated-password offers for unsafe form destinations and submitter overrides', () => {
    for (const html of [
      '<form><input type=password autocomplete=new-password></form>',
      '<form method=post action="https://elsewhere.example/change"><input type=password autocomplete=new-password></form>',
      '<form method=post action="/change"><input type=password autocomplete=new-password><button type=submit formaction="https://elsewhere.example/change">Save</button></form>',
    ]) {
      mount(html);
      mountGenerationTargetRegistry();
      expect(discover().groups, html).toEqual([]);
      window.__matrx_generation_target_registry__?.invalidate();
    }
    mount('<form id=visual method=post action="/change"><fieldset><input id=new type=password autocomplete=new-password form=external></fieldset></form><form id=external method=post action="https://elsewhere.example/change"></form>');
    const associated = document.querySelector('#external') as HTMLFormElement;
    const externallyAssociated = document.querySelector('#new') as HTMLInputElement;
    Object.defineProperty(externallyAssociated, 'form', { configurable: true, get: () => associated });
    mountGenerationTargetRegistry();
    expect(discover().groups).toEqual([]);
  });

  it('allows safe POST and React Action destinations', () => {
    for (const html of [
      '<form method=post action="/change"><input type=password autocomplete=new-password></form>',
      "<form action=\"javascript:throw new Error('React form unexpectedly submitted.')\"><input type=password autocomplete=new-password></form>",
    ]) {
      mount(html);
      mountGenerationTargetRegistry();
      const expiry = expiresAt();
      const targets = discover(expiry).groups[0]?.targets ?? [];
      expect(targets).toHaveLength(1);
      expect(dispatcher({ operation: 'fill_new_password_group', documentId, expiresAt: expiry, targets, value: 'abcdEFGH1234' }))
        .toEqual({ status: 'filled' });
      window.__matrx_generation_target_registry__?.invalidate();
    }
  });

  it('refuses an action changed after offer and rolls back when an input event changes the form association', () => {
    const form = mount('<form id=safe method=post action="/change"><fieldset><input id=new type=password autocomplete=new-password><input id=confirm type=password autocomplete=new-password aria-label="confirm password"></fieldset></form><form id=unsafe method=post action="https://elsewhere.example/change"></form>');
    mountGenerationTargetRegistry();
    const expiry = expiresAt();
    const targets = discover(expiry).groups[0]?.targets ?? [];
    form.action = 'https://elsewhere.example/change';
    expect(dispatcher({ operation: 'fill_new_password_group', documentId, expiresAt: expiry, targets, value: 'abcdEFGH1234' }))
      .toEqual({ status: 'refused_unchanged', reason: 'ambiguous_group' });

    form.action = '/change';
    const nextExpiry = expiresAt();
    const nextTargets = discover(nextExpiry).groups[0]?.targets ?? [];
    const first = document.querySelector('#new') as HTMLInputElement;
    const unsafe = document.querySelector('#unsafe') as HTMLFormElement;
    let associated: HTMLFormElement = form;
    Object.defineProperty(first, 'form', { configurable: true, get: () => associated });
    first.addEventListener('input', () => { associated = unsafe; }, { once: true });
    expect(dispatcher({ operation: 'fill_new_password_group', documentId, expiresAt: nextExpiry, targets: nextTargets, value: 'abcdEFGH1234' }))
      .toEqual({ status: 'rolled_back' });
    expect(first.value).toBe('');
    expect((document.querySelector('#confirm') as HTMLInputElement).value).toBe('');
  });

  it('keeps open-shadow targets as original weak identities across dispatcher calls', () => {
    const host = document.createElement('div');
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<fieldset><input id=new type=password autocomplete=new-password></fieldset>';
    document.body.append(host);
    const input = root.querySelector('input') as HTMLInputElement;
    visible(input);
    mountGenerationTargetRegistry();
    const expiry = expiresAt();
    const offer = discover(expiry);
    const target = offer.groups[0]?.targets[0];
    expect(target?.openShadowPath).toHaveLength(1);
    expect(target).toBeDefined();
    input.replaceWith(Object.assign(document.createElement('input'), { type: 'password', autocomplete: 'new-password' }));
    expect(
      dispatcher({ operation: 'fill_new_password_group', documentId, expiresAt: expiry, targets: [target!], value: 'abcdEFGH1234' }),
    ).toMatchObject({ status: 'refused_unchanged' });
  });

  it('prevalidates native constraints and does not truncate a generated value', () => {
    mount('<form method=post action="/change"><input id=new type=password autocomplete=new-password maxlength=8></form>');
    mountGenerationTargetRegistry();
    const expiry = expiresAt();
    const target = discover(expiry).groups[0]?.targets[0];
    const input = document.querySelector('#new') as HTMLInputElement;
    expect(
      dispatcher({ operation: 'fill_new_password_group', documentId, expiresAt: expiry, targets: [target!], value: 'abcdEFGH1234' }),
    ).toEqual({ status: 'refused_unchanged', reason: 'constraint_changed' });
    expect(input.value).toBe('');
  });

  it('treats an empty native pattern as a constraint instead of silently ignoring it', () => {
    mount('<form method=post action="/change"><input id=new type=password autocomplete=new-password pattern=""></form>');
    mountGenerationTargetRegistry();
    const expiry = expiresAt();
    const target = discover(expiry).groups[0]?.targets[0];
    expect(
      dispatcher({ operation: 'fill_new_password_group', documentId, expiresAt: expiry, targets: [target!], value: 'abcdEFGH1234' }),
    ).toEqual({ status: 'refused_unchanged', reason: 'constraint_changed' });
  });

  it('rolls back only its own write when an event changes constraints before the next target', () => {
    mount('<form method=post action="/change"><input id=new type=password autocomplete=new-password><input id=confirm type=password autocomplete=new-password aria-label="confirm password"></form>');
    mountGenerationTargetRegistry();
    const expiry = expiresAt();
    const targets = discover(expiry).groups[0]?.targets ?? [];
    const first = document.querySelector('#new') as HTMLInputElement;
    first.addEventListener('input', () => first.setAttribute('maxlength', '4'), { once: true });
    expect(
      dispatcher({ operation: 'fill_new_password_group', documentId, expiresAt: expiry, targets, value: 'abcdEFGH1234' }),
    ).toEqual({ status: 'rolled_back' });
    expect(first.value).toBe('');
    expect((document.querySelector('#confirm') as HTMLInputElement).value).toBe('');
  });

  it('does not erase a reentrant replacement value during rollback', () => {
    mount('<form method=post action="/change"><input id=new type=password autocomplete=new-password><input id=confirm type=password autocomplete=new-password aria-label="confirm password"></form>');
    mountGenerationTargetRegistry();
    const expiry = expiresAt();
    const targets = discover(expiry).groups[0]?.targets ?? [];
    const first = document.querySelector('#new') as HTMLInputElement;
    first.addEventListener('input', () => {
      first.value = 'site-owned-value';
      document.querySelector('#confirm')?.replaceWith(document.createElement('input'));
    }, { once: true });
    expect(
      dispatcher({ operation: 'fill_new_password_group', documentId, expiresAt: expiry, targets, value: 'abcdEFGH1234' }),
    ).toEqual({ status: 'partial_manual_check' });
    expect(first.value).toBe('site-owned-value');
  });

  it('refuses a moved original node and a changed confirmation role after synchronous events', () => {
    const form = mount('<form method=post action="/change"><fieldset id=group><input id=new type=password autocomplete=new-password><input id=confirm type=password autocomplete=new-password aria-label="confirm password"></fieldset></form>');
    mountGenerationTargetRegistry();
    const expiry = expiresAt();
    const targets = discover(expiry).groups[0]?.targets ?? [];
    const first = document.querySelector('#new') as HTMLInputElement;
    first.addEventListener('change', () => {
      const confirmation = document.querySelector('#confirm') as HTMLInputElement;
      confirmation.autocomplete = 'current-password';
      form.append(confirmation);
    }, { once: true });
    expect(
      dispatcher({ operation: 'fill_new_password_group', documentId, expiresAt: expiry, targets, value: 'abcdEFGH1234' }),
    ).toEqual({ status: 'rolled_back' });
    expect(first.value).toBe('');
  });

  it('claims target identities before the first write so a replay cannot fill', () => {
    mount('<form method=post action="/change"><input id=new type=password autocomplete=new-password></form>');
    mountGenerationTargetRegistry();
    const expiry = expiresAt();
    const targets = discover(expiry).groups[0]?.targets ?? [];
    const first = dispatcher({ operation: 'fill_new_password_group', documentId, expiresAt: expiry, targets, value: 'abcdEFGH1234' });
    const replay = dispatcher({ operation: 'fill_new_password_group', documentId, expiresAt: expiry, targets, value: 'abcdEFGH1234' });
    expect(first).toEqual({ status: 'filled' });
    expect(replay).toEqual({ status: 'refused_unchanged', reason: 'already_used_or_changed' });
  });

  it('refuses generated fill when the isolated registry cannot mark the target sensitive', () => {
    mount('<form method=post action="/change"><input id=new type=password autocomplete=new-password></form>');
    const registry = mountGenerationTargetRegistry();
    const expiry = expiresAt();
    const targets = discover(expiry).groups[0]?.targets ?? [];
    const markSensitive = registry.markSensitive;
    Object.defineProperty(registry, 'markSensitive', { configurable: true, value: undefined });
    const result = dispatcher({ operation: 'fill_new_password_group', documentId, expiresAt: expiry, targets, value: 'abcdEFGH1234' });
    Object.defineProperty(registry, 'markSensitive', { configurable: true, value: markSensitive });
    expect(result)
      .toEqual({ status: 'refused_unchanged', reason: 'registry_unavailable' });
    expect((document.querySelector('#new') as HTMLInputElement).value).toBe('');
  });

  it('keeps sensitive node identity after an offer expires or is discarded', async () => {
    const form = mount('<form method=post action="/change"><input id=new type=password autocomplete=new-password></form>');
    const input = document.querySelector('#new') as HTMLInputElement;
    const registry = mountGenerationTargetRegistry();
    const expiry = Date.now() + 5;
    const offer = registry.register(input, form, documentId, expiry);
    if (!offer) throw new Error('expected an offer');
    expect(registry.markSensitive(input)).toBe(true);
    registry.invalidate([offer]);
    expect(registry.isSensitive(input)).toBe(true);

    const expiringAt = Date.now() + 5;
    const expiringOffer = registry.register(input, form, documentId, expiringAt);
    if (!expiringOffer) throw new Error('expected an expiring offer');
    await new Promise((resolve) => window.setTimeout(resolve, 15));
    expect(registry.resolve(expiringOffer, documentId, expiringAt)).toBeNull();
    expect(registry.isSensitive(input)).toBe(true);
  });

  it('refuses a caller-supplied subset of an offered confirmation group', () => {
    mount('<form method=post action="/change"><input type=password autocomplete=new-password><input type=password autocomplete=new-password aria-label="confirm password"></form>');
    mountGenerationTargetRegistry();
    const expiry = expiresAt();
    const targets = discover(expiry).groups[0]?.targets ?? [];
    expect(dispatcher({ operation: 'fill_new_password_group', documentId, expiresAt: expiry, targets: targets.slice(0, 1), value: 'abcdEFGH1234' }))
      .toEqual({ status: 'refused_unchanged', reason: 'already_used_or_changed' });
  });

  it('offers explicit password groups separately and refuses an added member after discovery', () => {
    mount('<form method=post action="/change"><fieldset><input type=password autocomplete=new-password></fieldset><fieldset><input type=password autocomplete=new-password></fieldset></form>');
    mountGenerationTargetRegistry();
    const expiry = expiresAt();
    const groups = discover(expiry).groups;
    expect(groups).toHaveLength(2);
    const added = document.createElement('input'); added.type = 'password'; added.autocomplete = 'new-password'; visible(added);
    document.querySelector('fieldset')?.append(added);
    expect(dispatcher({ operation: 'fill_new_password_group', documentId, expiresAt: expiry, targets: groups[0]?.targets ?? [], value: 'abcdEFGH1234' }))
      .toEqual({ status: 'refused_unchanged', reason: 'ambiguous_group' });
  });

  it('does not read a password value while discovering metadata', () => {
    mount('<form method=post action="/change"><input id=new type=password autocomplete=new-password></form>');
    const input = document.querySelector('#new') as HTMLInputElement;
    Object.defineProperty(input, 'value', { configurable: true, get: () => { throw new Error('forbidden_value_read'); }, set: () => undefined });
    mountGenerationTargetRegistry();
    expect(discover().groups).toHaveLength(1);
  });

  it('refuses an expiry beyond the generator TTL ceiling', () => {
    mount('<form method=post action="/change"><input type=password autocomplete=new-password></form>');
    mountGenerationTargetRegistry();
    expect(discover(Date.now() + GENERATED_SECRET_TTL_MS * 2)).toMatchObject({ groups: [], reason: 'registry_unavailable' });
  });

  it('refuses expiry before any write', () => {
    mount('<form method=post action="/change"><input id=new type=password autocomplete=new-password></form>');
    mountGenerationTargetRegistry();
    const target = discover(expiresAt()).groups[0]?.targets[0];
    expect(
      dispatcher({ operation: 'fill_new_password_group', documentId, expiresAt: Date.now() - 1, targets: [target!], value: 'abcdEFGH1234' }),
    ).toEqual({ status: 'refused_unchanged', reason: 'expired_or_unavailable' });
    expect((document.querySelector('#new') as HTMLInputElement).value).toBe('');
  });

  it('stops before change when input removes the target and emits one event per phase', () => {
    mount('<form method=post action="/change"><input id=new type=password autocomplete=new-password></form>');
    mountGenerationTargetRegistry();
    const expiry = expiresAt(); const targets = discover(expiry).groups[0]?.targets ?? [];
    const input = document.querySelector('#new') as HTMLInputElement;
    let inputs = 0; let changes = 0;
    input.addEventListener('input', () => { inputs++; input.remove(); });
    input.addEventListener('change', () => changes++);
    expect(dispatcher({ operation: 'fill_new_password_group', documentId, expiresAt: expiry, targets, value: 'abcdEFGH1234' }).status)
      .toBe('partial_manual_check');
    expect({ inputs, changes }).toEqual({ inputs: 1, changes: 0 });
  });

  it('rolls back an operation value when the native controlled setter writes then throws', () => {
    mount('<form method=post action="/change"><input id=new type=password autocomplete=new-password value="original"></form>');
    mountGenerationTargetRegistry();
    const expiry = expiresAt(); const targets = discover(expiry).groups[0]?.targets ?? [];
    const input = document.querySelector('#new') as HTMLInputElement;
    const nativeDescriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')!;
    const native = nativeDescriptor.set!;
    const layer = Object.create(Object.getPrototypeOf(input));
    let throws = true;
    Object.defineProperty(layer, 'value', { set(next: string) { native.call(this, next); if (throws) { throws = false; throw new Error('setter_after_write'); } }, get() { return nativeDescriptor.get!.call(this); } });
    Object.setPrototypeOf(input, layer);
    const result = dispatcher({ operation: 'fill_new_password_group', documentId, expiresAt: expiry, targets, value: 'abcdEFGH1234' });
    expect(result).toEqual({ status: 'rolled_back' });
    expect(input.value).toBe('original');
  });

  it('preserves a site-owned replacement supplied by a rollback input reaction', () => {
    mount('<form method=post action="/change"><input id=new type=password autocomplete=new-password><input id=confirm type=password autocomplete=new-password aria-label="confirm password"></form>');
    mountGenerationTargetRegistry();
    const expiry = expiresAt(); const targets = discover(expiry).groups[0]?.targets ?? [];
    const input = document.querySelector('#new') as HTMLInputElement;
    let events = 0;
    input.addEventListener('input', () => {
      events++;
      if (events === 1) input.maxLength = 4;
      else input.value = 'site-owned-replacement';
    });
    const result = dispatcher({ operation: 'fill_new_password_group', documentId, expiresAt: expiry, targets, value: 'abcdEFGH1234' });
    expect(result.status).toBe('partial_manual_check');
    expect(input.value).toBe('site-owned-replacement');
    expect((document.querySelector('#confirm') as HTMLInputElement).value).toBe('');
  });
});

describe('registered input references', () => {
  it('binds an open-shadow input only to its exact document and refuses a moved host', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = host.attachShadow({ mode: 'open' });
    const input = document.createElement('input');
    input.type = 'password';
    root.append(input);
    const registry = mountGenerationTargetRegistry();
    const id = registry.registerInput(input);
    expect(id).toBeTruthy();
    expect(registry.resolveInput(id!, documentId)).toBe(input);
    // Repeated focus/query registration must reuse the same short-lived
    // identity; otherwise post-materialization revalidation sees a new ref.
    expect(registry.registerInput(input)).toBe(id);
    const replacement = document.createElement('div');
    document.body.append(replacement);
    replacement.attachShadow({ mode: 'open' }).append(input);
    expect(registry.resolveInput(id!, documentId)).toBeNull();
  });

  it('expires a repeated registered input identity at its original bounded TTL', async () => {
    vi.useFakeTimers();
    const host = document.createElement('div');
    const root = host.attachShadow({ mode: 'open' });
    const input = document.createElement('input');
    root.append(input);
    document.body.append(host);
    const registry = mountGenerationTargetRegistry();
    const id = registry.registerInput(input);
    expect(registry.registerInput(input)).toBe(id);
    await vi.advanceTimersByTimeAsync(60_001);
    expect(registry.resolveInput(id!, documentId)).toBeNull();
    vi.useRealTimers();
  });

  it('invalidates an old reference when its intact open-shadow host moves to another document parent', () => {
    const parent = document.createElement('section');
    const nextParent = document.createElement('section');
    const host = document.createElement('div');
    const root = host.attachShadow({ mode: 'open' });
    const input = document.createElement('input');
    root.append(input);
    parent.append(host);
    document.body.append(parent, nextParent);
    const registry = mountGenerationTargetRegistry();
    const id = registry.registerInput(input);
    expect(registry.resolveInput(id!, documentId)).toBe(input);
    nextParent.append(host);
    expect(registry.resolveInput(id!, documentId)).toBeNull();
  });

  function nestedOpenLogin(): {
    outer: HTMLDivElement;
    inner: HTMLDivElement;
    form: HTMLFormElement;
    username: HTMLInputElement;
    password: HTMLInputElement;
  } {
    const outer = document.createElement('div');
    const outerRoot = outer.attachShadow({ mode: 'open' });
    const inner = document.createElement('div');
    const innerRoot = inner.attachShadow({ mode: 'open' });
    const form = document.createElement('form');
    form.method = 'post';
    form.action = '/login';
    const username = document.createElement('input');
    username.autocomplete = 'username';
    const password = document.createElement('input');
    password.type = 'password';
    password.autocomplete = 'current-password';
    form.append(username, password);
    innerRoot.append(form);
    outerRoot.append(inner);
    document.body.append(outer);
    visible(username);
    visible(password);
    return { outer, inner, form, username, password };
  }

  it('fills a nested open-shadow saved-login group through serialized registered references without submit', () => {
    const { form, username, password } = nestedOpenLogin();
    const registry = mountGenerationTargetRegistry();
    const anchorId = registry.registerInput(password);
    expect(anchorId).toBeTruthy();
    const group = dispatcher({
      operation: 'focused_group',
      field: { kind: 'registered_input', id: anchorId! },
      documentId,
    });
    expect(group).not.toBeNull();
    if (!group) throw new Error('The nested open-shadow login group was not bound');
    let submits = 0;
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      submits++;
    });
    expect(
      dispatcher({
        operation: 'fill',
        expected: group,
        requested: [
          { field: group.username!, value: 'nested-user@example.test' },
          { field: group.password!, value: 'N3sted!Password' },
        ],
        sensitiveAttr: 'data-matrx-sensitive',
        preserveLegacyFieldBehavior: false,
      }),
    ).toEqual({ ok: true });
    expect(username.value).toBe('nested-user@example.test');
    expect(password.value).toBe('N3sted!Password');
    expect(submits).toBe(0);
  });

  it('binds a nested open-shadow focused input when panel focus is required', () => {
    const { password } = nestedOpenLogin();
    const registry = mountGenerationTargetRegistry();
    const id = registry.registerInput(password);
    password.focus();
    expect(
      dispatcher({
        operation: 'focused_group',
        field: { kind: 'registered_input', id: id! },
        documentId,
        requirePanelFocus: true,
      }),
    ).toMatchObject({ anchor: { kind: 'registered_input', id } });
  });

  it('binds form-associated siblings in the same open root and excludes a separate form', () => {
    const host = document.createElement('div');
    const root = host.attachShadow({ mode: 'open' });
    const form = document.createElement('form');
    form.id = 'login-form';
    form.method = 'post';
    form.action = '/login';
    const username = document.createElement('input');
    username.autocomplete = 'username';
    username.setAttribute('form', form.id);
    const password = document.createElement('input');
    password.type = 'password';
    password.autocomplete = 'current-password';
    password.setAttribute('form', form.id);
    const unrelated = document.createElement('form');
    unrelated.method = 'post';
    unrelated.append(Object.assign(document.createElement('input'), { type: 'password' }));
    root.append(form, username, password, unrelated);
    document.body.append(host);
    // happy-dom does not implement cross-shadow `form=` association. Model
    // the platform's native form association at the DOM boundary; the
    // dispatcher still owns enumeration, exact-root filtering, and binding.
    Object.defineProperty(username, 'form', { configurable: true, value: form });
    Object.defineProperty(password, 'form', { configurable: true, value: form });
    Object.defineProperty(form, 'elements', { configurable: true, value: [username, password] });
    visible(username);
    visible(password);
    visible(unrelated.querySelector('input') as HTMLInputElement);
    const registry = mountGenerationTargetRegistry();
    const id = registry.registerInput(password);
    const group = dispatcher({
      operation: 'focused_group',
      field: { kind: 'registered_input', id: id! },
      documentId,
    });
    expect(group).toMatchObject({
      anchor: { kind: 'registered_input', id },
      username: { kind: 'registered_input' },
      password: { kind: 'registered_input', id },
      usernameOnly: false,
    });
  });

  it.each(['replacement', 'moved-host', 'extra-password', 'unsafe-action'] as const)(
    'refuses a nested open-shadow group after %s without writing either field',
    (mutation) => {
      const { inner, form, username, password } = nestedOpenLogin();
      const registry = mountGenerationTargetRegistry();
      const anchorId = registry.registerInput(password);
      const group = dispatcher({
        operation: 'focused_group',
        field: { kind: 'registered_input', id: anchorId! },
        documentId,
      });
      if (!group) throw new Error('The nested open-shadow login group was not bound');
      if (mutation === 'replacement') {
        const replacement = document.createElement('input');
        replacement.autocomplete = 'username';
        visible(replacement);
        username.replaceWith(replacement);
      } else if (mutation === 'moved-host') {
        const replacementHost = document.createElement('div');
        replacementHost.attachShadow({ mode: 'open' }).append(inner);
        document.body.append(replacementHost);
      } else if (mutation === 'extra-password') {
        const extra = document.createElement('input');
        extra.type = 'password';
        extra.autocomplete = 'current-password';
        visible(extra);
        form.append(extra);
      } else {
        form.action = 'https://attacker.invalid/login';
      }
      expect(
        dispatcher({
          operation: 'fill',
          expected: group,
          requested: [
            { field: group.username!, value: 'nested-user@example.test' },
            { field: group.password!, value: 'N3sted!Password' },
          ],
          sensitiveAttr: 'data-matrx-sensitive',
          preserveLegacyFieldBehavior: false,
        }),
      ).toEqual({ ok: false });
      expect(username.value).toBe('');
      expect(password.value).toBe('');
    },
  );

  it('refuses a registered input inside a closed shadow root without writing it', () => {
    const host = document.createElement('div');
    const root = host.attachShadow({ mode: 'closed' });
    const input = document.createElement('input');
    input.type = 'password';
    input.autocomplete = 'current-password';
    root.append(input);
    document.body.append(host);
    visible(input);
    const id = mountGenerationTargetRegistry().registerInput(input);
    expect(id).toBeNull();
    expect(input.value).toBe('');
  });
});
