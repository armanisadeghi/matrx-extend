import { credentialDomSource } from '@/lib/credentials/fill-primitive';
import { describe, expect, it } from 'vitest';

// Execute the serializable production dispatcher, as Chrome injection does.
const serialized = new Function(
  `return (${credentialDomSource.toString()});`,
)() as typeof credentialDomSource;

function mount() {
  document.body.innerHTML =
    '<form method="post" action="/login"><input id="username" autocomplete="username"><input id="password" type="password" autocomplete="current-password"><button type="submit">Sign in</button></form>';
  const form = document.querySelector('form') as HTMLFormElement;
  const username = document.querySelector('#username') as HTMLInputElement;
  const password = document.querySelector('#password') as HTMLInputElement;
  for (const input of [username, password])
    Object.defineProperty(input, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ width: 120, height: 24, top: 0, left: 0, bottom: 24 }),
    });
  return { form, username, password };
}

function fill() {
  return serialized({
    operation: 'fill',
    expected: {
      anchor: '#password',
      username: '#username',
      password: '#password',
      usernameOnly: false,
      pageUrl: `${location.origin}${location.pathname}`,
    },
    requested: [
      { selector: '#username', value: 'credential-user-fixture' },
      { selector: '#password', value: 'credential-password-fixture' },
    ],
    sensitiveAttr: '',
    preserveLegacyFieldBehavior: false,
  });
}

function mutatingThrow(input: HTMLInputElement, once = false) {
  const prototype = Object.getPrototypeOf(input);
  const native = Object.getOwnPropertyDescriptor(prototype, 'value');
  if (!native?.get || !native.set) throw new Error('native_value_descriptor_missing');
  let threw = false;
  const controlled = Object.create(prototype);
  Object.defineProperty(controlled, 'value', {
    get: native.get,
    set(value: string) {
      native.set!.call(this, value);
      if (!once || !threw) {
        threw = true;
        throw new Error('setter_mutated_then_threw');
      }
    },
  });
  Object.setPrototypeOf(input, controlled);
}

describe('bound credential fill rollback', () => {
  it('restores non-empty originals when the first setter throws only for the attempted write', () => {
    const { form, username, password } = mount();
    username.value = 'original-username';
    password.value = 'original-password';
    let submits = 0;
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      submits++;
    });
    mutatingThrow(username, true);
    expect(fill()).toEqual({ ok: false });
    expect(username.value).toBe('original-username');
    expect(password.value).toBe('original-password');
    expect(submits).toBe(0);
  });

  it('restores the first field when the second setter mutates then throws', () => {
    const { form, username, password } = mount();
    let submits = 0;
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      submits++;
    });
    mutatingThrow(password);
    expect(fill()).toEqual({ ok: false, reason: 'partial_manual_check' });
    expect(username.value).toBe('');
    expect(password.value).toBe('');
    expect(submits).toBe(0);
  });

  it('preserves a same-node site edit after input makes the destination unsafe', () => {
    const { form, username, password } = mount();
    username.addEventListener(
      'input',
      () => {
        username.value = 'site-owned-value';
        form.method = 'get';
      },
      { once: true },
    );
    expect(fill()).toEqual({ ok: false, reason: 'partial_manual_check' });
    expect(username.value).toBe('site-owned-value');
    expect(password.value).toBe('');
  });

  it('does not overwrite a site-owned sibling changed during the first input event', () => {
    const { form, username, password } = mount();
    let submits = 0;
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      submits++;
    });
    username.addEventListener(
      'input',
      () => {
        password.value = 'site-owned-value';
      },
      { once: true },
    );
    expect(fill()).toEqual({ ok: false, reason: 'partial_manual_check' });
    expect(username.value).toBe('');
    expect(password.value).toBe('site-owned-value');
    expect(submits).toBe(0);
  });

  it('preserves an attempted field moved outside its original group root', () => {
    const { form, username, password } = mount();
    username.addEventListener(
      'input',
      () => {
        const movedForm = document.createElement('form');
        movedForm.method = 'post';
        movedForm.append(username);
        document.body.append(movedForm);
      },
      { once: true },
    );
    expect(fill()).toEqual({ ok: false, reason: 'partial_manual_check' });
    expect(username.value).toBe('credential-user-fixture');
    expect(password.value).toBe('');
    expect(form.contains(username)).toBe(false);
  });

  it('preserves a replacement control after input makes the destination unsafe', () => {
    const { form, username, password } = mount();
    username.addEventListener(
      'input',
      () => {
        const replacement = document.createElement('input');
        replacement.id = 'username';
        replacement.autocomplete = 'username';
        replacement.value = 'site-owned-value';
        Object.defineProperty(replacement, 'getBoundingClientRect', {
          value: () => ({ width: 120, height: 24, top: 0, left: 0, bottom: 24 }),
        });
        username.replaceWith(replacement);
        form.method = 'get';
      },
      { once: true },
    );
    expect(fill()).toEqual({ ok: false, reason: 'partial_manual_check' });
    expect((document.querySelector('#username') as HTMLInputElement).value).toBe(
      'site-owned-value',
    );
    expect(password.value).toBe('');
  });

  it.each(['forward input', 'rollback input'] as const)(
    'reports a changed unattempted sibling during %s even when the destination is unsafe',
    (phase) => {
      const { form, username, password } = mount();
      let inputs = 0;
      let submits = 0;
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        submits++;
      });
      username.addEventListener('input', () => {
        inputs++;
        if (inputs === 1) form.method = 'get';
        if (inputs === (phase === 'forward input' ? 1 : 2))
          password.value = 'site-owned-sibling-value';
      });
      expect(fill()).toEqual({ ok: false, reason: 'partial_manual_check' });
      expect(username.value).toBe('');
      expect(password.value).toBe('site-owned-sibling-value');
      expect(submits).toBe(0);
    },
  );

  it('refuses normally after an unsafe action mutation when values restore', () => {
    const { form, username, password } = mount();
    username.addEventListener(
      'input',
      () => {
        form.method = 'get';
      },
      { once: true },
    );
    expect(fill()).toEqual({ ok: false });
    expect(username.value).toBe('');
    expect(password.value).toBe('');
  });

  it('preserves a site edit made by a rollback event handler', () => {
    const { form, username, password } = mount();
    let inputs = 0;
    username.addEventListener('input', () => {
      inputs++;
      if (inputs === 1) form.method = 'get';
      if (inputs === 2) username.value = 'site-owned-value';
    });
    expect(fill()).toEqual({ ok: false, reason: 'partial_manual_check' });
    expect(username.value).toBe('site-owned-value');
    expect(password.value).toBe('');
  });

  it('fills a stable bound group without submitting', () => {
    const { form, username, password } = mount();
    let submits = 0;
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      submits++;
    });
    expect(fill()).toEqual({ ok: true });
    expect(username.value).toBe('credential-user-fixture');
    expect(password.value).toBe('credential-password-fixture');
    expect(submits).toBe(0);
  });
});
