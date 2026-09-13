/** Browser-observable effective form destination safety classification. */
export type FormDestinationKind = 'safe_post' | 'react_action' | 'unsafe';

export interface FormDestination {
  kind: FormDestinationKind;
  reason?: 'method' | 'url' | 'origin' | 'scheme' | 'override';
}

// Provenance: React DOM 19.2.0 and Next 16.3.5 vendored react-dom-experimental.
// These are full literal equality checks; unknown javascript: remains unsafe.
export const REACT_19_LONG_SENTINEL =
  "javascript:throw new Error('A React form was unexpectedly submitted. If you called form.submit() manually, consider using form.requestSubmit() instead. If you\\'re trying to use event.stopPropagation() in a submit event handler, consider also calling event.preventDefault().')";
export const NEXT_REACT_SHORT_SENTINEL =
  "javascript:throw new Error('React form unexpectedly submitted.')";
const REACT_ACTION_SENTINELS = new Set([REACT_19_LONG_SENTINEL, NEXT_REACT_SHORT_SENTINEL]);

function isSubmitControl(control: Element | null, form: HTMLFormElement): control is HTMLButtonElement | HTMLInputElement {
  if (!(control instanceof HTMLButtonElement || control instanceof HTMLInputElement) || control.form !== form)
    return false;
  const type = (control.getAttribute('type') ?? (control instanceof HTMLButtonElement ? 'submit' : 'text')).toLowerCase();
  return control instanceof HTMLButtonElement ? type === 'submit' : type === 'submit' || type === 'image';
}

function classifyOne(form: HTMLFormElement, control: Element | null, currentUrl: string, baseUri: string): FormDestination {
  const submitter = isSubmitControl(control, form) ? control : null;
  const rawAction = submitter?.getAttribute('formaction') ?? form.getAttribute('action') ?? '';
  if (REACT_ACTION_SENTINELS.has(rawAction)) return { kind: 'react_action' };
  const rawMethod = submitter?.getAttribute('formmethod') ?? form.getAttribute('method') ?? 'get';
  if (rawMethod.toLowerCase() !== 'post') return { kind: 'unsafe', reason: 'method' };
  let action: URL;
  try {
    action = new URL(rawAction || currentUrl, rawAction ? baseUri : currentUrl);
  } catch {
    return { kind: 'unsafe', reason: 'url' };
  }
  const loopback = /^(localhost|127\.0\.0\.1|\[::1\]|::1)$/.test(action.hostname);
  if (action.origin !== new URL(currentUrl).origin) return { kind: 'unsafe', reason: 'origin' };
  if (action.protocol !== 'https:' && !(action.protocol === 'http:' && loopback))
    return { kind: 'unsafe', reason: 'scheme' };
  return { kind: 'safe_post' };
}

/**
 * Classifies the effective action and conservatively rejects unsafe enabled
 * submitter overrides, including controls associated through form="id".
 */
export function classifyFormDestination(
  form: HTMLFormElement | null,
  submitter: Element | null,
  currentUrl = location.href,
  baseUri = document.baseURI,
): FormDestination {
  if (!form) return { kind: 'safe_post' };
  const selected = isSubmitControl(submitter, form) ? submitter : null;
  const primary = classifyOne(form, selected, currentUrl, baseUri);
  if (primary.kind === 'unsafe') return primary;
  for (const candidate of Array.from(form.elements)) {
    if (!isSubmitControl(candidate, form) || candidate.disabled || candidate === selected) continue;
    if (!candidate.hasAttribute('formaction') && !candidate.hasAttribute('formmethod')) continue;
    if (classifyOne(form, candidate, currentUrl, baseUri).kind === 'unsafe')
      return { kind: 'unsafe', reason: 'override' };
  }
  return primary;
}
