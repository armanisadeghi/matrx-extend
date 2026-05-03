/**
 * Form-aware tools — discovery + targeted setters that produce the same
 * input/change events frameworks expect.
 *
 *   get_form_fields  (read)   — discover every form on the page with its
 *                              inputs, labels, current values, requireds.
 *   select_dropdown  (action) — set a <select> value (by value, label, or
 *                              index).
 *   set_checkbox     (action) — set checked/unchecked + dispatch events.
 *   set_radio        (action) — pick a radio in a group by value or label.
 *   submit_form      (action) — submit a form by selector or by clicking
 *                              the form's primary submit button.
 */

import type { ToolHandler } from '@/lib/tools/types';
import { z } from 'zod';

async function activeTabId(): Promise<number | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id ?? null;
}

function resolveRef(args: { selector?: string; ref?: string }): string | null {
  if (args.ref) {
    const n = args.ref.startsWith('ref:') ? args.ref.slice(4) : args.ref;
    return `[data-matrx-ref="${n.replace(/"/g, '\\"')}"]`;
  }
  return args.selector ?? null;
}

const FormFieldsArgs = z
  .object({
    /** Optional CSS selector to scope discovery to a particular form. */
    selector: z.string().optional(),
  })
  .default({});
type FormFieldsArgs = z.infer<typeof FormFieldsArgs>;

export const get_form_fields: ToolHandler<FormFieldsArgs, unknown> = {
  name: 'get_form_fields',
  tier: 'read',
  description:
    'Discover forms on the active tab. For each form, returns id, action, method, and a list of fields: { name, type, value, label, required, placeholder, selector }. Use this BEFORE typing to find the right selector and label so you fill the right field.',
  argsSchema: FormFieldsArgs,
  run: async (args) => {
    const tabId = await activeTabId();
    if (tabId == null) return { ok: false, reason: 'No active tab' };
    const [first] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (formSelector: string | null) => {
        function uniqueSelector(el: Element): string {
          if ('id' in el && (el as { id: string }).id) {
            const id = (el as { id: string }).id;
            return `#${CSS.escape(id)}`;
          }
          const name = el.getAttribute('name');
          if (name) {
            return `${el.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`;
          }
          // fallback: nth-of-type chain
          const parts: string[] = [];
          let node: Element | null = el;
          while (node && node.nodeType === 1 && node !== document.body && parts.length < 6) {
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
        function labelFor(input: Element): string | null {
          const id = input.getAttribute('id');
          if (id) {
            const lbl = document.querySelector(`label[for="${CSS.escape(id)}"]`);
            if (lbl?.textContent) return lbl.textContent.trim();
          }
          // wrapped: <label>X <input/></label>
          const parent = input.closest('label');
          if (parent?.textContent) {
            return parent.textContent.replace(input.textContent ?? '', '').trim();
          }
          const aria = input.getAttribute('aria-label');
          if (aria) return aria.trim();
          return null;
        }

        const forms = formSelector
          ? Array.from(document.querySelectorAll(formSelector))
          : Array.from(document.querySelectorAll('form'));
        const items = forms.map((form) => {
          const inputs = Array.from(
            form.querySelectorAll('input, select, textarea, [contenteditable="true"]'),
          );
          const fields = inputs.map((el) => {
            const tag = el.tagName.toLowerCase();
            const type =
              tag === 'input' ? (el as HTMLInputElement).type : tag === 'select' ? 'select' : tag;
            let value: string | boolean | string[] | null = null;
            if (tag === 'select') {
              const sel = el as HTMLSelectElement;
              value = sel.multiple
                ? Array.from(sel.selectedOptions).map((o) => o.value)
                : sel.value;
            } else if (type === 'checkbox' || type === 'radio') {
              value = (el as HTMLInputElement).checked;
            } else if ('value' in el) {
              value = (el as HTMLInputElement | HTMLTextAreaElement).value ?? null;
            } else if ((el as HTMLElement).isContentEditable) {
              value = (el as HTMLElement).textContent ?? '';
            }
            return {
              tag,
              type,
              name: el.getAttribute('name'),
              id: el.getAttribute('id'),
              value,
              label: labelFor(el),
              placeholder: el.getAttribute('placeholder'),
              required: (el as HTMLInputElement).required ?? null,
              disabled: (el as HTMLInputElement).disabled ?? false,
              selector: uniqueSelector(el),
              options:
                tag === 'select'
                  ? Array.from((el as HTMLSelectElement).options).map((o) => ({
                      value: o.value,
                      label: o.textContent?.trim() ?? '',
                      selected: o.selected,
                    }))
                  : undefined,
            };
          });
          // Look for a submit button so the agent can click instead of relying
          // on form.submit() (which skips JS-driven validation).
          const submit = form.querySelector(
            'button[type="submit"], input[type="submit"], button:not([type])',
          );
          return {
            id: form.id || null,
            action: form.getAttribute('action'),
            method: form.getAttribute('method')?.toLowerCase() ?? 'get',
            selector: uniqueSelector(form),
            field_count: fields.length,
            fields,
            submit_selector: submit ? uniqueSelector(submit) : null,
          };
        });
        return { count: items.length, forms: items };
      },
      args: [args.selector ?? null],
    });
    return first?.result ?? { count: 0, forms: [] };
  },
};

const SelectDropdownArgs = z
  .object({
    selector: z.string().min(1).optional(),
    ref: z.string().min(1).optional(),
    /** Provide exactly ONE of: value, label, or index. */
    value: z.string().optional(),
    label: z.string().optional(),
    index: z.number().int().min(0).optional(),
  })
  .refine((d) => d.selector || d.ref, { message: 'must provide selector or ref' });
type SelectDropdownArgs = z.infer<typeof SelectDropdownArgs>;

export const select_dropdown_option: ToolHandler<SelectDropdownArgs, unknown> = {
  name: 'select_dropdown_option',
  tier: 'action',
  description:
    "Choose an option in a <select> element. Pass exactly ONE of: value (the option's value attr), label (the visible text), or index (0-based). Dispatches change + input events for framework apps.",
  argsSchema: SelectDropdownArgs,
  run: async (args) => {
    const sel = resolveRef(args);
    if (!sel) return { ok: false, reason: 'must provide selector or ref' };
    const tabId = await activeTabId();
    if (tabId == null) return { ok: false, reason: 'No active tab' };
    const [first] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (
        selector: string,
        value: string | null,
        label: string | null,
        idx: number | null,
      ) => {
        const el = document.querySelector(selector) as HTMLSelectElement | null;
        if (!el || el.tagName.toLowerCase() !== 'select') {
          return { ok: false, reason: `No <select> at ${selector}` };
        }
        let target = -1;
        if (value !== null) {
          target = Array.from(el.options).findIndex((o) => o.value === value);
        } else if (label !== null) {
          target = Array.from(el.options).findIndex((o) => o.textContent?.trim() === label.trim());
        } else if (idx !== null) {
          target = idx;
        }
        if (target < 0 || target >= el.options.length) {
          return {
            ok: false,
            reason: 'No matching option',
            available: Array.from(el.options).map((o) => ({
              value: o.value,
              label: o.textContent?.trim(),
            })),
          };
        }
        el.selectedIndex = target;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return {
          ok: true,
          selected: { value: el.value, label: el.options[target]?.textContent?.trim() ?? '' },
        };
      },
      args: [sel, args.value ?? null, args.label ?? null, args.index ?? null],
    });
    return first?.result ?? { ok: false, reason: 'no result' };
  },
};

const SetCheckboxArgs = z
  .object({
    selector: z.string().min(1).optional(),
    ref: z.string().min(1).optional(),
    checked: z.boolean(),
  })
  .refine((d) => d.selector || d.ref, { message: 'must provide selector or ref' });
type SetCheckboxArgs = z.infer<typeof SetCheckboxArgs>;

export const set_checkbox: ToolHandler<SetCheckboxArgs, unknown> = {
  name: 'set_checkbox',
  tier: 'action',
  description:
    'Set a checkbox to checked or unchecked, dispatching click + change events so frameworks see the toggle. Use for both <input type="checkbox"> and ARIA-styled toggles where role="checkbox".',
  argsSchema: SetCheckboxArgs,
  run: async (args) => {
    const sel = resolveRef(args);
    if (!sel) return { ok: false, reason: 'must provide selector or ref' };
    const tabId = await activeTabId();
    if (tabId == null) return { ok: false, reason: 'No active tab' };
    const [first] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (selector: string, checked: boolean) => {
        const el = document.querySelector(selector) as HTMLInputElement | HTMLElement | null;
        if (!el) return { ok: false, reason: `No element at ${selector}` };
        if (el instanceof HTMLInputElement && el.type === 'checkbox') {
          if (el.checked !== checked) {
            el.click();
          }
          return { ok: true, checked: el.checked };
        }
        // ARIA fallback
        const isAriaChecked = el.getAttribute('aria-checked') === 'true';
        if (isAriaChecked !== checked) el.click();
        return { ok: true, checked: el.getAttribute('aria-checked') === 'true' };
      },
      args: [sel, args.checked],
    });
    return first?.result ?? { ok: false, reason: 'no result' };
  },
};

const SetRadioArgs = z
  .object({
    /** A selector that resolves to a radio group container, or one of its inputs. */
    selector: z.string().min(1).optional(),
    ref: z.string().min(1).optional(),
    /** Match by `value` attr, visible label, or index within the group. */
    value: z.string().optional(),
    label: z.string().optional(),
    index: z.number().int().min(0).optional(),
  })
  .refine((d) => d.selector || d.ref, { message: 'must provide selector or ref' });
type SetRadioArgs = z.infer<typeof SetRadioArgs>;

export const set_radio: ToolHandler<SetRadioArgs, unknown> = {
  name: 'set_radio',
  tier: 'action',
  description:
    'Pick a radio button from a group. Pass selector pointing at the group container OR any radio input in it, then exactly ONE of value/label/index.',
  argsSchema: SetRadioArgs,
  run: async (args) => {
    const sel = resolveRef(args);
    if (!sel) return { ok: false, reason: 'must provide selector or ref' };
    const tabId = await activeTabId();
    if (tabId == null) return { ok: false, reason: 'No active tab' };
    const [first] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (
        selector: string,
        value: string | null,
        label: string | null,
        idx: number | null,
      ) => {
        const probe = document.querySelector(selector) as HTMLElement | null;
        if (!probe) return { ok: false, reason: `No element at ${selector}` };
        const root: Element =
          probe instanceof HTMLInputElement && probe.type === 'radio'
            ? (probe.closest('form, fieldset, body') ?? document.body)
            : probe;
        const groupName = probe instanceof HTMLInputElement ? probe.name : null;
        const radios = Array.from(
          root.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
        ).filter((r) => (groupName ? r.name === groupName : true));
        if (radios.length === 0) return { ok: false, reason: 'No radios in group' };
        let target: HTMLInputElement | undefined;
        if (value !== null) {
          target = radios.find((r) => r.value === value);
        } else if (label !== null) {
          target = radios.find((r) => {
            const id = r.getAttribute('id');
            const lbl = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
            const text = (lbl?.textContent ?? r.closest('label')?.textContent ?? '').trim();
            return text === label.trim();
          });
        } else if (idx !== null) {
          target = radios[idx];
        }
        if (!target) {
          return {
            ok: false,
            reason: 'No matching radio',
            available: radios.map((r) => ({ value: r.value })),
          };
        }
        target.click();
        return { ok: true, value: target.value };
      },
      args: [sel, args.value ?? null, args.label ?? null, args.index ?? null],
    });
    return first?.result ?? { ok: false, reason: 'no result' };
  },
};

const SubmitFormArgs = z
  .object({
    /** Selector for the form (or a child of it). Defaults to first form on the page. */
    selector: z.string().optional(),
    /** Prefer clicking the submit button over form.submit() — runs validation. Default true. */
    via_button: z.boolean().optional().default(true),
  })
  .default({});
type SubmitFormArgs = z.infer<typeof SubmitFormArgs>;

export const submit_form: ToolHandler<SubmitFormArgs, unknown> = {
  name: 'submit_form',
  tier: 'action',
  description:
    "Submit a form. By default the tool clicks the form's primary submit button (so HTML5 validation + framework handlers run). Set via_button=false to fall back to HTMLFormElement.submit() — skips validation but works for form elements that lack a button.",
  argsSchema: SubmitFormArgs,
  run: async (args) => {
    const tabId = await activeTabId();
    if (tabId == null) return { ok: false, reason: 'No active tab' };
    const [first] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (selector: string | null, viaButton: boolean) => {
        let form: HTMLFormElement | null;
        if (selector) {
          const el = document.querySelector(selector) as Element | null;
          form = el?.closest('form') ?? (el as HTMLFormElement | null);
        } else {
          form = document.querySelector('form');
        }
        if (!form) return { ok: false, reason: 'No form found' };
        if (viaButton) {
          const btn = form.querySelector(
            'button[type="submit"], input[type="submit"], button:not([type])',
          ) as HTMLElement | null;
          if (btn) {
            btn.click();
            return { ok: true, mode: 'click' };
          }
        }
        if (typeof (form as HTMLFormElement).requestSubmit === 'function') {
          (form as HTMLFormElement).requestSubmit();
        } else {
          form.submit();
        }
        return { ok: true, mode: 'submit' };
      },
      args: [args.selector ?? null, args.via_button],
    });
    return first?.result ?? { ok: false, reason: 'no result' };
  },
};

// ─── file_upload ──────────────────────────────────────────────────────────

const FileUploadArgs = z
  .object({
    /** Selector or ref pointing at an `<input type="file">`. */
    selector: z.string().min(1).optional(),
    ref: z.string().min(1).optional(),
    /**
     * Files to attach. Each file is { name, mime, base64 }. base64 is the
     * file contents WITHOUT the `data:...;base64,` prefix.
     */
    files: z
      .array(
        z.object({
          name: z.string().min(1),
          mime: z.string().min(1).default('application/octet-stream'),
          base64: z.string().min(1),
        }),
      )
      .min(1),
  })
  .refine((d) => d.selector || d.ref, { message: 'must provide selector or ref' });
type FileUploadArgs = z.infer<typeof FileUploadArgs>;

export const file_upload: ToolHandler<FileUploadArgs, unknown> = {
  name: 'file_upload',
  tier: 'action',
  description:
    'Attach files to an `<input type="file">` element by selector or ref. IMPORTANT: clicking a file input opens a native dialog the agent cannot see — use this tool instead. Each file in `files` is { name, mime, base64 }. Dispatches `change` so frameworks see the upload. Returns { ok, file_count, names }.',
  argsSchema: FileUploadArgs,
  run: async (args) => {
    const sel = resolveRef(args);
    if (!sel) return { ok: false, reason: 'must provide selector or ref' };
    const tabId = await activeTabId();
    if (tabId == null) return { ok: false, reason: 'No active tab' };
    try {
      const [first] = await chrome.scripting.executeScript({
        target: { tabId },
        func: (
          selector: string,
          files: { name: string; mime: string; base64: string }[],
        ) => {
          const el = document.querySelector(selector) as HTMLInputElement | null;
          if (!el || el.tagName.toLowerCase() !== 'input' || el.type !== 'file') {
            return { ok: false, reason: `Not a file input at ${selector}` };
          }
          const dt = new DataTransfer();
          for (const f of files) {
            const bin = atob(f.base64);
            const arr = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
            const blob = new Blob([arr], { type: f.mime });
            dt.items.add(new File([blob], f.name, { type: f.mime }));
          }
          el.files = dt.files;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return {
            ok: true,
            file_count: dt.files.length,
            names: files.map((f) => f.name),
          };
        },
        args: [sel, args.files],
      });
      return first?.result ?? { ok: false, reason: 'no result' };
    } catch (err) {
      return { ok: false, reason: (err as Error).message };
    }
  },
};

export const form_read_handlers = [get_form_fields];
export const form_action_handlers = [
  select_dropdown_option,
  set_checkbox,
  set_radio,
  submit_form,
  file_upload,
];
