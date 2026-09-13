import { describe, expect, it } from 'vitest';
import { credentialDomSource } from '@/lib/credentials/fill-primitive';

// Execute the serialized production dispatcher, not a local substitute.
const serialized = new Function(`return (${credentialDomSource.toString()});`)() as typeof credentialDomSource;
const classify = (form: HTMLFormElement, submitter: Element | null = null) =>
  serialized({ operation: 'classify_form', form, submitter, currentUrl: location.href, baseUri: document.baseURI });
const long = "javascript:throw new Error('A React form was unexpectedly submitted. If you called form.submit() manually, consider using form.requestSubmit() instead. If you\\'re trying to use event.stopPropagation() in a submit event handler, consider also calling event.preventDefault().')";
const short = "javascript:throw new Error('React form unexpectedly submitted.')";

describe('credential form destination classifier', () => {
  const mount = (html: string) => { document.body.innerHTML = html; return document.querySelector('form') as HTMLFormElement; };
  it.each([long, short])('accepts exact deployed React literal', (action) => {
    expect(classify(mount(`<form action="${action.replaceAll('"','&quot;')}"><input type=password></form>`)).kind).toBe('react_action');
  });
  it('refuses literal suffixes, prefixes, and apostrophe escaping drift', () => {
    for (const action of [`x${short}`, `${short}x`, long.replace("\\'", "'"), 'javascript:void(0)'])
      expect(classify(mount(`<form action="${action.replaceAll('"','&quot;')}"><input type=password></form>`)).kind).toBe('unsafe');
  });
  it('refuses default GET and enabled unsafe override census', () => {
    expect(classify(mount('<form><input type=password></form>')).kind).toBe('unsafe');
    expect(classify(mount('<form method=post><input type=password><button type=submit formmethod=get>go</button></form>')).kind).toBe('unsafe');
  });
  it('accepts same-origin POST and ignores foreign submitters', () => {
    const form=mount('<form method=post action="/login"><input type=password></form>');
    const foreign=document.createElement('button'); foreign.type='submit';
    expect(classify(form,foreign).kind).toBe('safe_post');
  });
});

it('revalidates legacy fill after focus mutates its destination', () => {
  document.body.innerHTML = '<form method="post"><input id="user" autocomplete="username"></form>';
  const input = document.querySelector('#user') as HTMLInputElement;
  Object.defineProperty(input, 'getBoundingClientRect', { value: () => ({ width: 40, height: 20 }) });
  input.addEventListener('focus', () => input.form?.setAttribute('method', 'get'));
  const outcome = serialized({ operation: 'fill', expected: null, requested: [{ selector: '#user', value: 'secret' }], sensitiveAttr: '', preserveLegacyFieldBehavior: true });
  expect(outcome).toEqual({ ok: false, reason: 'field_changed_during_focus' });
  expect(input.value).toBe('');
});

it('refuses an OTP/new-password bound group before writing', () => {
  document.body.innerHTML = '<form method="post"><input id="otp" autocomplete="one-time-code"><input id="password" type="password"></form>';
  const form = document.querySelector('form') as HTMLFormElement;
  for (const input of Array.from(form.querySelectorAll('input')))
    Object.defineProperty(input, 'getBoundingClientRect', { value: () => ({ width: 40, height: 20 }) });
  const outcome = serialized({ operation: 'fill', expected: { anchor: '#otp', username: '#otp', password: '#password', usernameOnly: false, pageUrl: `${location.origin}${location.pathname}` }, requested: [{ selector: '#otp', value: 'code' }, { selector: '#password', value: 'secret' }], sensitiveAttr: '', preserveLegacyFieldBehavior: false });
  expect(outcome).toEqual({ ok: false });
  expect((document.querySelector('#password') as HTMLInputElement).value).toBe('');
});
