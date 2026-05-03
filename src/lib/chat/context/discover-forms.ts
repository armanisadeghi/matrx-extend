/**
 * Form schema discovery for v2 context. Runs in parallel with the page probe
 * so it adds no serialized latency. Surfaces fields with type, label,
 * required, validation hints, and current value — directly attacking the
 * highest-ROI workflow category in the field (insurance / procurement /
 * healthcare / cross-portal form filling).
 *
 * Same shape as `get_form_fields` tool returns, but scoped to MAIN-area
 * forms only (no chrome/header search forms) and trimmed to context-friendly
 * size. The agent can still call `get_form_fields` directly for the full
 * unfiltered view.
 */

import { log } from '@/lib/debug/log';

export interface DiscoveredField {
  ref?: string | null;
  selector: string;
  name: string | null;
  id: string | null;
  type: string;
  tag: string;
  label: string | null;
  placeholder: string | null;
  current_value: string | boolean | string[] | null;
  required: boolean;
  disabled: boolean;
  validation: {
    pattern: string | null;
    min_length: number | null;
    max_length: number | null;
    min: string | null;
    max: string | null;
    autocomplete: string | null;
  };
  /** From an adjacent error element (`[role="alert"]`, `.error`, etc). */
  error_message: string | null;
  /** Options for `<select>` and `<input type="radio">` groups. */
  options: Array<{ value: string; label: string; selected: boolean }> | null;
}

export interface DiscoveredForm {
  selector: string;
  id: string | null;
  action: string | null;
  method: string;
  in_main: boolean;
  field_count: number;
  fields: DiscoveredField[];
  submit_selector: string | null;
}

/**
 * Run inside the active tab. Returns null if no forms are present in the
 * MAIN area — chrome-only forms (e.g. header search) are skipped.
 */
export async function discoverFormsForContext(
  tabId: number,
): Promise<DiscoveredForm[] | null> {
  try {
    const [first] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (): DiscoveredForm[] => {
        const CHROME_SELECTOR =
          'header, nav, footer, aside, [role="banner"], [role="navigation"], [role="contentinfo"], [role="complementary"]';

        function uniqueSelector(el: Element): string {
          if ('id' in el && (el as { id: string }).id) {
            return `#${CSS.escape((el as { id: string }).id)}`;
          }
          const name = el.getAttribute('name');
          if (name) {
            return `${el.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`;
          }
          const dt = el.getAttribute('data-testid');
          if (dt) return `${el.tagName.toLowerCase()}[data-testid="${CSS.escape(dt)}"]`;
          // nth-of-type chain (max 6 deep)
          const parts: string[] = [];
          let node: Element | null = el;
          while (node && node.nodeType === 1 && node !== document.body && parts.length < 6) {
            const cur: Element = node;
            const tag = cur.tagName.toLowerCase();
            const parent = cur.parentElement;
            if (!parent) {
              parts.unshift(tag);
              break;
            }
            const sibs = Array.from(parent.children).filter((c) => c.tagName === cur.tagName);
            const idx = sibs.indexOf(cur) + 1;
            parts.unshift(sibs.length > 1 ? `${tag}:nth-of-type(${idx})` : tag);
            node = parent;
          }
          return parts.join(' > ');
        }

        function labelFor(input: Element): string | null {
          const id = input.getAttribute('id');
          if (id) {
            const lbl = document.querySelector(`label[for="${CSS.escape(id)}"]`);
            if (lbl?.textContent) return lbl.textContent.trim().slice(0, 100);
          }
          const wrapping = input.closest('label');
          if (wrapping?.textContent) {
            return wrapping.textContent.replace(input.textContent ?? '', '').trim().slice(0, 100);
          }
          const aria = input.getAttribute('aria-label');
          if (aria) return aria.trim().slice(0, 100);
          const labelledBy = input.getAttribute('aria-labelledby');
          if (labelledBy) {
            const lbl = document.getElementById(labelledBy);
            if (lbl?.textContent) return lbl.textContent.trim().slice(0, 100);
          }
          return null;
        }

        /** Look for an adjacent error message (common framework patterns). */
        function errorFor(input: Element): string | null {
          const errId = input.getAttribute('aria-describedby');
          if (errId) {
            const e = document.getElementById(errId);
            if (e?.textContent && e.getAttribute('role') === 'alert') {
              return e.textContent.trim().slice(0, 200);
            }
          }
          const parent = input.closest('label, .field, [data-field], div');
          if (parent) {
            const err = parent.querySelector('[role="alert"], .error, .field-error, [data-error]');
            if (err?.textContent?.trim()) return err.textContent.trim().slice(0, 200);
          }
          return null;
        }

        const forms = Array.from(document.querySelectorAll('form'));
        const out: DiscoveredForm[] = [];

        for (const form of forms) {
          const inMain = form.closest(CHROME_SELECTOR) === null;
          // Skip chrome-only forms unless they're the only form on the page.
          if (!inMain && forms.length > 1) continue;

          const inputs = Array.from(
            form.querySelectorAll<
              HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
            >('input:not([type="hidden"]), select, textarea, [contenteditable="true"]'),
          );
          if (inputs.length === 0) continue;

          const fields: DiscoveredField[] = inputs.map((el) => {
            const tag = el.tagName.toLowerCase();
            const inputType =
              tag === 'input'
                ? (el as HTMLInputElement).type
                : tag === 'select'
                  ? 'select'
                  : tag;

            let value: string | boolean | string[] | null = null;
            if (tag === 'select') {
              const sel = el as HTMLSelectElement;
              value = sel.multiple
                ? Array.from(sel.selectedOptions).map((o) => o.value)
                : sel.value;
            } else if (inputType === 'checkbox' || inputType === 'radio') {
              value = (el as HTMLInputElement).checked;
            } else if ('value' in el) {
              value = (el as HTMLInputElement | HTMLTextAreaElement).value ?? null;
            }

            const inputEl = el as HTMLInputElement;
            const validation = {
              pattern: inputEl.pattern || null,
              min_length: inputEl.minLength > 0 ? inputEl.minLength : null,
              max_length: inputEl.maxLength > 0 ? inputEl.maxLength : null,
              min: inputEl.min || null,
              max: inputEl.max || null,
              autocomplete: el.getAttribute('autocomplete') || null,
            };

            const options =
              tag === 'select'
                ? Array.from((el as HTMLSelectElement).options).map((o) => ({
                    value: o.value,
                    label: (o.textContent ?? '').trim().slice(0, 80),
                    selected: o.selected,
                  }))
                : null;

            return {
              selector: uniqueSelector(el),
              name: el.getAttribute('name'),
              id: el.getAttribute('id'),
              type: inputType,
              tag,
              label: labelFor(el),
              placeholder: el.getAttribute('placeholder'),
              current_value: value,
              required: inputEl.required ?? false,
              disabled: inputEl.disabled ?? false,
              validation,
              error_message: errorFor(el),
              options,
            };
          });

          const submit = form.querySelector(
            'button[type="submit"], input[type="submit"], button:not([type])',
          );

          out.push({
            selector: uniqueSelector(form),
            id: form.id || null,
            action: form.getAttribute('action'),
            method: form.getAttribute('method')?.toLowerCase() ?? 'get',
            in_main: inMain,
            field_count: fields.length,
            fields,
            submit_selector: submit ? uniqueSelector(submit) : null,
          });
        }

        return out;
      },
    });
    const result = (first?.result as DiscoveredForm[] | undefined) ?? [];
    return result.length > 0 ? result : null;
  } catch (err) {
    log.warn('scrape', 'discoverFormsForContext failed', err);
    return null;
  }
}
