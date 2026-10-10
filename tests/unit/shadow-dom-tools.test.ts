import { click_element, type_into_element } from '@/lib/tools/handlers/action';
import { computer, form_input } from '@/lib/tools/handlers/canonical';
import { select_dropdown_option } from '@/lib/tools/handlers/forms';
import {
  find_text_on_page,
  get_element_details,
  inspect_element,
} from '@/lib/tools/handlers/inspect';
import { focus_element, press_keys } from '@/lib/tools/handlers/keyboard';
import { find, read_page } from '@/lib/tools/handlers/page-refs';
import { query_elements } from '@/lib/tools/handlers/read';
import type { ToolContext, ToolHandler } from '@/lib/tools/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/onbox-ai/client', () => ({
  quickPrompt: vi.fn(async () => ({ ok: false, reason: 'unavailable' })),
}));

const ctx = {
  assignedTabId: 17,
  conversationId: null,
  runId: 'shadow-controls',
  callId: 'swipe',
  agentName: null,
  permissionMode: 'act',
} as ToolContext;
async function run<A>(handler: ToolHandler<A, unknown>, args: unknown): Promise<any> {
  return handler.run(handler.argsSchema.parse(args), ctx);
}

// Real use case: save a social post through Matrx's injected swipe control.
// Only the Chrome IPC boundary is replaced: actual serialized handlers execute against DOM.
describe('browser tools on injected open shadow controls', () => {
  let save: HTMLButtonElement;
  let caption: HTMLInputElement;
  beforeEach(() => {
    document.body.innerHTML =
      '<button id="page-save">Save draft</button><div id="matrx-swipe-pill"></div>';
    const outer = document.querySelector('#matrx-swipe-pill')!.attachShadow({ mode: 'open' });
    outer.innerHTML = '<div id="capture-controls"></div>';
    const nested = outer.querySelector('#capture-controls')!.attachShadow({ mode: 'open' });
    nested.innerHTML =
      '<label for="caption">Capture notes</label><input id="caption"><button id="save">Save to swipe file</button>';
    save = nested.querySelector('button')!;
    caption = nested.querySelector('input')!;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      width: 120,
      height: 32,
      top: 0,
      bottom: 32,
      left: 0,
      right: 120,
      toJSON: () => ({}),
    });
    vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {});
    (globalThis as any).chrome.tabs = { get: async () => ({ id: 17, active: true }) };
    (globalThis as any).chrome.scripting = {
      executeScript: async ({ func, args = [] }: any) => {
        const detached = new Function(`return (${func.toString()})`)();
        return [{ result: await detached(...JSON.parse(JSON.stringify(args))) }];
      },
    };
  });

  it('read_page exposes nested shadow buttons with actionable refs alongside page controls', async () => {
    const result = await run(read_page, {});
    expect(result.elements.map((e: any) => e.name ?? e.text)).toContain('Save to swipe file');
    expect(result.elements.map((e: any) => e.name ?? e.text)).toContain('Save draft');
    const button = result.elements.find((e: any) => (e.name ?? e.text) === 'Save to swipe file');
    let clicks = 0;
    save.addEventListener('click', () => clicks++);
    expect(await run(click_element, { ref: button.ref })).toMatchObject({ ok: true });
    expect(clicks).toBe(1);
  });

  it('find locates injected controls when on-device AI is unavailable', async () => {
    const result = await run(find, { query: 'Save to swipe file' });
    expect(result.matches.some((m: any) => (m.name ?? m.text) === 'Save to swipe file')).toBe(true);
  });

  it('text search returns a selector resolving the precise nested shadow button', async () => {
    const result = await run(find_text_on_page, { query: 'Save to swipe file' });
    expect(result.count).toBe(1);
    expect(await run(inspect_element, { selector: result.matches[0].selector })).toMatchObject({
      ok: true,
      tag: 'button',
      text: 'Save to swipe file',
    });
  });

  it('inspect resolves shadow refs after read_page', async () => {
    const result = await run(read_page, {});
    const button = result.elements.find((e: any) => (e.name ?? e.text) === 'Save to swipe file');
    expect(button, 'shadow save button must be discoverable').toBeDefined();
    expect(await run(get_element_details, { ref: button.ref })).toMatchObject({
      ok: true,
      tag: 'button',
      text: 'Save to swipe file',
    });
  });

  it('typing through a shadow ref changes the actual input and emits input', async () => {
    const result = await run(read_page, {});
    const input = result.elements.find((e: any) => e.role === 'textbox');
    expect(input, 'shadow capture notes input must be discoverable').toBeDefined();
    expect(input.name).toBe('Capture notes');
    let valueAtEvent = '';
    caption.addEventListener('input', () => {
      valueAtEvent = caption.value;
    });
    expect(
      await run(type_into_element, { ref: input.ref, text: 'Product launch inspiration' }),
    ).toMatchObject({ ok: true });
    expect(valueAtEvent).toBe('Product launch inspiration');
    expect(caption.value).toBe('Product launch inspiration');
  });

  it('ordinary document selector clicks the original page button', async () => {
    let clicks = 0;
    document.querySelector('#page-save')!.addEventListener('click', () => clicks++);
    expect(await run(click_element, { selector: '#page-save' })).toMatchObject({ ok: true });
    expect(clicks).toBe(1);
  });
  it('inspection identifies an open shadow host instead of an unexplained empty div', async () => {
    expect(await run(inspect_element, { selector: '#matrx-swipe-pill' })).toMatchObject({
      ok: true,
      shadow_root: 'open',
      shadow_child_count: 1,
    });
  });

  it('read_page prioritizes a visible injected control over a long offscreen feed', async () => {
    const top = document.querySelector('#matrx-swipe-pill')!;
    for (let i = 0; i < 220; i++) {
      const button = document.createElement('button');
      button.textContent = 'Earlier post';
      button.getBoundingClientRect = () => ({
        x: 0,
        y: -400,
        width: 120,
        height: 32,
        top: -400,
        bottom: -368,
        left: 0,
        right: 120,
        toJSON: () => ({}),
      });
      document.body.insertBefore(button, top);
    }
    const result = await run(read_page, { max_nodes: 10 });
    expect(result.elements.map((e: any) => e.name ?? e.text)).toContain('Save to swipe file');
  });

  it('read_page excludes controls hidden by a shadow host', async () => {
    (document.querySelector('#matrx-swipe-pill') as HTMLElement).style.display = 'none';
    const result = await run(read_page, {});
    expect(result.elements.map((e: any) => e.name ?? e.text)).toEqual(['Save draft']);
  });

  it('shadow text selectors stay precise when the document has the same button id', async () => {
    const page = document.querySelector('#page-save')!;
    page.id = 'save';
    const matches = await run(find_text_on_page, { query: 'Save to swipe file' });
    let saved = 0;
    let pageClicks = 0;
    save.addEventListener('click', () => saved++);
    page.addEventListener('click', () => pageClicks++);
    expect(await run(click_element, { selector: matches.matches[0].selector })).toMatchObject({
      ok: true,
    });
    expect([saved, pageClicks]).toEqual([1, 0]);
  });

  it('dropdown refs select the actual shadow collection and emit change', async () => {
    const dropdown = document.createElement('select');
    dropdown.innerHTML =
      '<option value="brand">Brand inspiration</option><option value="launch">Launch ideas</option>';
    save.parentNode!.appendChild(dropdown);
    const result = await run(read_page, {});
    const entry = result.elements.find((e: any) => e.role === 'combobox');
    let changed = '';
    dropdown.addEventListener('change', () => {
      changed = dropdown.value;
    });
    expect(await run(select_dropdown_option, { ref: entry.ref, value: 'launch' })).toMatchObject({
      ok: true,
      selected: { value: 'launch' },
    });
    expect(changed).toBe('launch');
  });

  it('canonical form input routes a shadow ref into the actual editable control', async () => {
    const result = await run(read_page, {});
    const input = result.elements.find((e: any) => e.role === 'textbox');
    expect(
      await run(form_input, { tab_id: '17', ref: input.ref, value: 'Brand campaign reference' }),
    ).toMatchObject({ ok: true });
    expect(caption.value).toBe('Brand campaign reference');
  });

  it('focused shadow input receives keyboard events instead of its outer host', async () => {
    const result = await run(read_page, {});
    const input = result.elements.find((e: any) => e.role === 'textbox');
    expect(await run(focus_element, { ref: input.ref })).toMatchObject({ ok: true, focused: true });
    let key = '';
    caption.addEventListener('keydown', (event) => {
      key = event.key;
    });
    expect(await run(press_keys, { keys: 'Enter' })).toMatchObject({ ok: true });
    expect(key).toBe('Enter');
    expect(
      await run(computer, { tab_id: '17', action: 'type', text: 'Notes for next campaign' }),
    ).toMatchObject({ ok: true });
    expect(caption.value).toBe('Notes for next campaign');
  });

  it('query_elements reads the injected shadow control through the shared seam', async () => {
    const result = await run(query_elements, { selector: '#save' });
    expect(result).toMatchObject({ total: 1, items: [{ text: 'Save to swipe file' }] });
  });

  it('shadow password values remain masked in read_page and element details', async () => {
    caption.type = 'password';
    caption.setAttribute('value', 'sensitive-capture-value');
    const result = await run(read_page, {});
    const input = result.elements.find((e: any) => e.role === 'textbox');
    expect(input).toMatchObject({ masked: true, value: '***' });
    const details = await run(get_element_details, { ref: input.ref, include_html: true });
    expect(details.attrs.value).toBe('***');
    expect(JSON.stringify(details)).not.toContain('sensitive-capture-value');
  });
  it('input events from a shadow ref reach delegated listeners outside the root', async () => {
    const result = await run(read_page, {});
    const input = result.elements.find((e: any) => e.role === 'textbox');
    let delegatedInput = 0;
    const listener = () => {
      delegatedInput++;
    };
    document.addEventListener('input', listener);
    try {
      await run(type_into_element, { ref: input.ref, text: 'Customer story reference' });
      expect(delegatedInput).toBe(1);
    } finally {
      document.removeEventListener('input', listener);
    }
  });

  it('ordinary CSS attribute values containing arrows retain their meaning', async () => {
    save.setAttribute('data-note', 'idea >>> captured');
    let clicks = 0;
    save.addEventListener('click', () => clicks++);
    expect(await run(click_element, { selector: '[data-note="idea >>> captured"]' })).toMatchObject(
      { ok: true },
    );
    expect(clicks).toBe(1);
  });

  it('text search retains text under boxless display-contents wrappers', async () => {
    const wrapper = document.createElement('span');
    wrapper.textContent = 'Saved to launch collection';
    wrapper.style.display = 'contents';
    wrapper.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      top: 0,
      bottom: 0,
      left: 0,
      right: 0,
      toJSON: () => ({}),
    });
    save.parentNode!.appendChild(wrapper);
    expect(await run(find_text_on_page, { query: 'Saved to launch collection' })).toMatchObject({
      count: 1,
    });
  });
});
