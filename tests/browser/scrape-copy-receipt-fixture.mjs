// Test-only CDP boundary fixture; no browser, network, profile, or artifact is opened.
import { Window } from 'happy-dom';
import { runNativeResourceAction } from './native-resource-boundary.mjs';
import { runGuestCopyMenus } from './scrape-guest-behavior-batch.mjs';
import { click } from './settings-panel-driver.mjs';

export async function exerciseCopyReceiptFailure(title) {
  if (!['Copy capture', 'Copy images'].includes(title)) throw new Error('unknown_copy_fixture');
  const window = new Window();
  window.document.body.innerHTML = `<button role="tab" title="Scrape" data-state="active" aria-controls="scrape-pane">Scrape</button>
    <section id="scrape-pane" role="tabpanel" data-state="active">
      ${title === 'Copy images' ? '<button aria-label="Copy capture">Copy</button>' : ''}
      <p>PRIVATE_PAGE_BODY_MUST_NOT_ENTER_RECEIPT</p>
    </section>`;
  let clipboard = '';
  Object.defineProperty(window.navigator, 'clipboard', {
    value: {
      writeText: async (value) => {
        clipboard = value;
      },
      readText: async () => clipboard,
    },
  });
  const panel = {
    send: async (method, params) => {
      if (method !== 'Runtime.evaluate') throw new Error('unexpected_native_input');
      return { result: { value: await window.eval(params.expression) } };
    },
  };
  return runGuestCopyMenus({
    panel,
    fixtureKey: title === 'Copy images' ? 'intake' : 'referrals',
    origin: 'http://127.0.0.1:65000',
    resourceAction: (action) => runNativeResourceAction(async () => {}, action),
    menus:
      title === 'Copy images'
        ? [
            ['Copy capture', null, ['Page URL']],
            [title, null, ['Markdown']],
          ]
        : [[title, null, ['Markdown']]],
    adapters: {
      // The CDP boundary supplies a successful browser copy followed by a real
      // target-resolution failure. Batch ordering, oracle and receipt stay real.
      click: async (target, kind, label) => {
        if (title === 'Copy images' && kind === 'title' && label === 'Copy capture') {
          const menu = window.document.createElement('div');
          menu.setAttribute('data-radix-popper-content-wrapper', '');
          menu.innerHTML = '<button><span class="truncate">Page URL</span></button>';
          window.document.body.append(menu);
          return;
        }
        if (title === 'Copy images' && kind === 'scrape-copy-option') {
          clipboard = 'http://127.0.0.1:65000/intake';
          window.document.querySelector('[data-radix-popper-content-wrapper]').remove();
          return;
        }
        return click(target, kind, label);
      },
      withClipboardReadPermission: async ({ read, evidence }) => {
        const result = await read();
        evidence.clipboardObservationPermissionRestored = true;
        return result;
      },
    },
  });
}
