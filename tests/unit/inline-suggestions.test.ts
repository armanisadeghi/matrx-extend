import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let contentListener: ((message: unknown) => boolean) | null = null;
let queryCount = 0;
let fillCount = 0;
let matches = [{ item_id: 'item-1', display_name: 'Work account' }];
let queryResponse: unknown;
let pendingQueryResolve: ((response: unknown) => void) | null = null;
let openVaultCount = 0;
let unmount: (() => void) | null = null;
const originalAttachShadow = HTMLElement.prototype.attachShadow;
const originalInnerHeight = window.innerHeight;

beforeEach(() => {
  queryCount = 0;
  fillCount = 0;
  matches = [{ item_id: 'item-1', display_name: 'Work account' }];
  queryResponse = undefined;
  pendingQueryResolve = null;
  openVaultCount = 0;
  document.body.innerHTML =
    '<form><input id="password" type="password" autocomplete="current-password"><input id="plain-text" type="text"><input id="search" type="search"><input id="contact" type="email"><button>Continue</button></form>';
  const input = document.querySelector('#password') as HTMLInputElement;
  Object.defineProperty(input, 'getBoundingClientRect', {
    value: () => ({ width: 120, height: 24, top: 10, left: 10, bottom: 34 }),
  });
  vi.spyOn(HTMLElement.prototype, 'attachShadow').mockImplementation(function (
    this: HTMLElement,
    init,
  ) {
    return originalAttachShadow.call(this, { ...init, mode: 'open' });
  });
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      sendMessage: async (message: { kind: string }) => {
        if (message.kind === 'credential-suggestions:query') {
          queryCount++;
          if (queryResponse) return queryResponse;
          if (pendingQueryResolve !== null) {
            return new Promise((resolve) => {
              pendingQueryResolve = resolve;
            });
          }
          return { status: 'ready', offerId: `offer-${queryCount}`, matches };
        }
        if (message.kind === 'credential-suggestions:fill') {
          fillCount++;
          return { status: 'filled', message: 'Filled. Matrx did not submit the form.' };
        }
        if (message.kind === 'credential-suggestions:open-vault') openVaultCount++;
        return { ok: true };
      },
      onMessage: {
        addListener: (listener: typeof contentListener) => {
          contentListener = listener;
        },
        removeListener: (listener: typeof contentListener) => {
          if (contentListener === listener) contentListener = null;
        },
      },
    },
  };
});

afterEach(() => {
  unmount?.();
  unmount = null;
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalInnerHeight });
  document.querySelector('#matrx-inline-login-suggestion')?.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  contentListener = null;
  vi.resetModules();
  document.body.innerHTML = '';
});

async function mountReadyChooser(): Promise<{
  target: HTMLInputElement;
  host: HTMLElement;
  title: HTMLButtonElement;
  account: HTMLButtonElement;
  card: HTMLElement;
}> {
  const { mountInlineCredentialSuggestions } = await import('@/lib/credentials/inline-suggestions');
  unmount = mountInlineCredentialSuggestions();
  const target = document.querySelector('#password') as HTMLInputElement;
  target.focus();
  await Promise.resolve();
  await Promise.resolve();
  const host = document.querySelector('#matrx-inline-login-suggestion') as HTMLElement;
  return {
    target,
    host,
    title: host.shadowRoot?.querySelector('button') as HTMLButtonElement,
    account: host.shadowRoot?.querySelectorAll('button')[1] as HTMLButtonElement,
    card: host.shadowRoot?.querySelector('[role="dialog"]') as HTMLElement,
  };
}

describe('inline saved-login chooser', () => {
  it.each([
    { status: 'no_matches', message: 'No saved login is available for this form.' },
    { status: 'sign_in_required', message: 'Sign in to Matrx to use saved logins.' },
    { status: 'organization_required', message: 'Choose an organization first.' },
    { status: 'unavailable', message: 'Saved logins are unavailable right now.' },
    { status: 'unsafe_destination', message: 'This form cannot be filled safely.' },
  ])('does not place an unsolicited overlay for a $status lookup', async (response) => {
    queryResponse = response;
    const { mountInlineCredentialSuggestions } = await import(
      '@/lib/credentials/inline-suggestions'
    );
    unmount = mountInlineCredentialSuggestions();
    const continueButton = document.querySelector('form button') as HTMLButtonElement;
    let pageClickCount = 0;
    continueButton.addEventListener('click', () => {
      pageClickCount++;
    });

    for (const selector of ['#plain-text', '#search', '#contact']) {
      (document.querySelector(selector) as HTMLInputElement).focus();
      await Promise.resolve();
      await Promise.resolve();
      expect(document.querySelector('#matrx-inline-login-suggestion')).toBeNull();
    }

    continueButton.click();
    expect(pageClickCount).toBe(1);
    expect(openVaultCount).toBe(0);
  });

  it('does not render a delayed saved-login chooser after the person starts typing', async () => {
    pendingQueryResolve = () => undefined;
    const { mountInlineCredentialSuggestions } = await import(
      '@/lib/credentials/inline-suggestions'
    );
    unmount = mountInlineCredentialSuggestions();
    const target = document.querySelector('#password') as HTMLInputElement;

    target.focus();
    await Promise.resolve();
    target.dispatchEvent(
      new InputEvent('input', { bubbles: true, data: 'x', inputType: 'insertText' }),
    );
    pendingQueryResolve?.({
      status: 'ready',
      offerId: 'late-offer',
      matches: [{ item_id: 'item-1', display_name: 'Work account' }],
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(document.querySelector('#matrx-inline-login-suggestion')).toBeNull();
  });

  it.each(['pushState', 'replaceState'] as const)(
    'does not render a delayed chooser after same-document history.%s',
    async (method) => {
      pendingQueryResolve = () => undefined;
      const { mountInlineCredentialSuggestions } = await import(
        '@/lib/credentials/inline-suggestions'
      );
      unmount = mountInlineCredentialSuggestions();
      const target = document.querySelector('#password') as HTMLInputElement;

      target.focus();
      await Promise.resolve();
      history[method]({}, '', `/inline-suggestions-${method}`);
      pendingQueryResolve?.({
        status: 'ready',
        offerId: 'late-offer',
        matches: [{ item_id: 'item-1', display_name: 'Work account' }],
      });
      await Promise.resolve();
      await Promise.resolve();

      expect(document.querySelector('#matrx-inline-login-suggestion')).toBeNull();
    },
  );

  it('dismisses a visible chooser on a Navigation API entry change', async () => {
    const navigationEvents = new EventTarget();
    vi.stubGlobal('navigation', navigationEvents);
    const chooser = await mountReadyChooser();

    expect(chooser.host.isConnected).toBe(true);
    navigationEvents.dispatchEvent(new Event('currententrychange'));

    expect(document.querySelector('#matrx-inline-login-suggestion')).toBeNull();
  });

  it.each([
    [
      'Escape',
      (target: HTMLInputElement) =>
        target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
    ],
    [
      'an outside pointer',
      () =>
        document.body.dispatchEvent(new Event('pointerdown', { bubbles: true, composed: true })),
    ],
    ['page navigation', () => window.dispatchEvent(new Event('pagehide'))],
    [
      'focus loss',
      (target: HTMLInputElement) =>
        (target.form?.querySelector('button') as HTMLButtonElement).focus(),
    ],
    ['field removal', (target: HTMLInputElement) => target.remove()],
  ])('drops a delayed chooser after %s', async (_reason, endInteraction) => {
    pendingQueryResolve = () => undefined;
    const { mountInlineCredentialSuggestions } = await import(
      '@/lib/credentials/inline-suggestions'
    );
    unmount = mountInlineCredentialSuggestions();
    const target = document.querySelector('#password') as HTMLInputElement;

    target.focus();
    await Promise.resolve();
    endInteraction(target);
    pendingQueryResolve?.({
      status: 'ready',
      offerId: 'late-offer',
      matches: [{ item_id: 'item-1', display_name: 'Work account' }],
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(document.querySelector('#matrx-inline-login-suggestion')).toBeNull();
  });

  it('does not render an empty ready lookup', async () => {
    queryResponse = { status: 'ready', offerId: 'empty-offer', matches: [] };
    const { mountInlineCredentialSuggestions } = await import(
      '@/lib/credentials/inline-suggestions'
    );
    unmount = mountInlineCredentialSuggestions();

    (document.querySelector('#password') as HTMLInputElement).focus();
    await Promise.resolve();
    await Promise.resolve();

    expect(document.querySelector('#matrx-inline-login-suggestion')).toBeNull();
  });

  it('uses trusted ArrowDown to enter choices, refuses synthetic entry, and keeps fills deliberate', async () => {
    matches = [
      { item_id: 'item-1', display_name: 'Work account' },
      { item_id: 'item-2', display_name: 'Personal account' },
    ];
    const captured = {} as { listener?: (event: KeyboardEvent) => void };
    const target = document.querySelector('#password') as HTMLInputElement;
    const originalAdd = target.addEventListener.bind(target);
    vi.spyOn(target, 'addEventListener').mockImplementation((type, listener, options) => {
      if (type === 'keydown' && options === true)
        captured.listener = listener as (event: KeyboardEvent) => void;
      originalAdd(type, listener, options);
    });

    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 96 });
    const chooser = await mountReadyChooser();
    expect(chooser.title.textContent).toContain('Arrow Down');
    expect(chooser.title.getAttribute('aria-label')).toContain('Arrow Down');
    expect(chooser.host.style.getPropertyValue('--matrx-inline-max-height')).toBe('48px');
    expect(chooser.card.style.maxHeight).toContain('--matrx-inline-max-height');
    expect(chooser.account.hidden).toBe(true);

    const synthetic = new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      bubbles: true,
      cancelable: true,
    });
    chooser.target.dispatchEvent(synthetic);
    expect(synthetic.defaultPrevented).toBe(false);
    expect(chooser.account.hidden).toBe(true);
    expect(fillCount).toBe(0);
    expect(captured.listener).toBeTypeOf('function');

    let prevented = false;
    captured.listener?.({
      isTrusted: true,
      key: 'ArrowDown',
      preventDefault: () => {
        prevented = true;
      },
    } as KeyboardEvent);
    expect(prevented).toBe(true);
    expect(chooser.account.hidden).toBe(false);
    expect(chooser.host.shadowRoot?.activeElement).toBe(chooser.account);
    expect(fillCount).toBe(0);

    const second = chooser.host.shadowRoot?.querySelectorAll('button')[2] as HTMLButtonElement;
    chooser.account.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
    );
    expect(chooser.host.shadowRoot?.activeElement).toBe(second);
    second.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(document.activeElement).toBe(chooser.target);
    expect(document.querySelector('#matrx-inline-login-suggestion')).toBeNull();
    expect(fillCount).toBe(0);

    (document.querySelector('form button') as HTMLButtonElement).focus();
    chooser.target.focus();
    await Promise.resolve();
    await Promise.resolve();
    const reopenedHost = document.querySelector('#matrx-inline-login-suggestion') as HTMLElement;
    const reopenedTitle = reopenedHost.shadowRoot?.querySelector('button') as HTMLButtonElement;
    const reopenedAccount = reopenedHost.shadowRoot?.querySelectorAll(
      'button',
    )[1] as HTMLButtonElement;
    reopenedTitle.click();
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    reopenedAccount.dispatchEvent(enter);
    await Promise.resolve();
    await Promise.resolve();
    expect(enter.defaultPrevented).toBe(true);
    expect(fillCount).toBe(1);
    expect(reopenedHost.isConnected).toBe(false);
  });
});
