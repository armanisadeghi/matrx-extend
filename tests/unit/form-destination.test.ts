import { describe, expect, it } from 'vitest';
import { classifyFormDestination, NEXT_REACT_SHORT_SENTINEL, REACT_19_LONG_SENTINEL } from '@/lib/credentials/form-destination';

describe('credential form destination classifier', () => {
  const mount = (html: string) => { document.body.innerHTML = html; return document.querySelector('form') as HTMLFormElement; };
  it.each([REACT_19_LONG_SENTINEL, NEXT_REACT_SHORT_SENTINEL])('accepts exact React sentinel', (action) => {
    const form = mount(`<form action="${action.replaceAll('"','&quot;')}"><input type=password></form>`);
    expect(classifyFormDestination(form, null, location.href, document.baseURI).kind).toBe('react_action');
  });
  it('refuses mutated or arbitrary javascript actions', () => {
    for (const action of [`${NEXT_REACT_SHORT_SENTINEL}x`, 'javascript:void(0)']) {
      const form=mount(`<form action="${action.replaceAll('"','&quot;')}"><input type=password></form>`);
      expect(classifyFormDestination(form, null, location.href, document.baseURI).kind).toBe('unsafe');
    }
  });
  it('refuses default GET and unsafe submitter override', () => {
    let form=mount('<form><input type=password></form>');
    expect(classifyFormDestination(form,null).kind).toBe('unsafe');
    form=mount('<form method=post><input type=password><button type=submit formmethod=get>go</button></form>');
    expect(classifyFormDestination(form,null).kind).toBe('unsafe');
  });
  it('accepts same-origin POST and refuses foreign submitter', () => {
    const form=mount('<form method=post action="/login"><input type=password><button id=foreign type=submit>go</button></form>');
    const foreign=document.createElement('button'); foreign.type='submit';
    expect(classifyFormDestination(form,foreign).kind).toBe('safe_post');
  });
});
