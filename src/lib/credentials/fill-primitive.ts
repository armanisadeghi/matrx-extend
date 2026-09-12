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
  if (!el || el.disabled || el.readOnly || el.type === 'hidden')
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
  if (sensitiveAttr) el.setAttribute(sensitiveAttr, '');
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return { ok: true };
}
