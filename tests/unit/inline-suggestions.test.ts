import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let contentListener: ((message: unknown) => boolean) | null = null;
let queryCount = 0;
const originalAttachShadow = HTMLElement.prototype.attachShadow;

beforeEach(() => {
  queryCount = 0;
  document.body.innerHTML =
    '<form><input id="password" type="password" autocomplete="current-password"></form>';
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
          return {
            status: 'ready',
            offerId: `offer-${queryCount}`,
            matches: [{ item_id: 'item-1', display_name: 'Work account' }],
          };
        }
        if (message.kind === 'credential-suggestions:fill') {
          return { status: 'filled', message: 'Filled. Matrx did not submit the form.' };
        }
        return { ok: true };
      },
      onMessage: {
        addListener: (listener: typeof contentListener) => {
          contentListener = listener;
        },
      },
    },
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  contentListener = null;
  vi.resetModules();
  document.body.innerHTML = '';
});

describe('inline saved-login chooser', () => {
  it('keeps accounts behind a deliberate Matrx click, restores target focus, and re-queries after context recovery', async () => {
    const { mountInlineCredentialSuggestions } = await import(
      '@/lib/credentials/inline-suggestions'
    );
    mountInlineCredentialSuggestions();
    const target = document.querySelector('#password') as HTMLInputElement;
    target.focus();
    await Promise.resolve();
    await Promise.resolve();

    const host = document.querySelector('#matrx-inline-login-suggestion') as HTMLElement;
    const title = host.shadowRoot?.querySelector('button') as HTMLButtonElement;
    const account = host.shadowRoot?.querySelectorAll('button')[1] as HTMLButtonElement;
    expect(account.hidden).toBe(true);
    expect(account.style.display).toBe('');

    title.click();
    expect(account.hidden).toBe(false);
    expect(account.style.display).toBe('block');
    expect(account.style.outline).toContain('#2563eb');

    account.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(document.activeElement).toBe(target);
    expect(document.querySelector('#matrx-inline-login-suggestion')).toBeNull();

    target.focus();
    await Promise.resolve();
    contentListener?.({ __matrx: true, kind: 'credential-suggestions:context-changed' });
    await Promise.resolve();
    await Promise.resolve();
    expect(queryCount).toBe(2);
  });
});
