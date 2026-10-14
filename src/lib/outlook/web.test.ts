import { classifyOwaUrl, owaComposeUrl } from '@/lib/outlook/web';
import { describe, expect, it } from 'vitest';

describe('Outlook on the web compose', () => {
  it('builds the public compose deeplink with every field and no send', () => {
    const url = new URL(
      owaComposeUrl({
        to: ['a@b.com', 'c@d.com'],
        cc: ['e@f.com'],
        subject: 'Q3 plan & next',
        body: 'Line 1\nLine 2',
      }),
    );
    expect(url.origin).toBe('https://outlook.office.com');
    expect(url.pathname).toBe('/mail/deeplink/compose');
    expect(url.searchParams.get('to')).toBe('a@b.com;c@d.com');
    expect(url.searchParams.get('cc')).toBe('e@f.com');
    expect(url.searchParams.get('subject')).toBe('Q3 plan & next');
    expect(url.searchParams.get('body')).toBe('Line 1\nLine 2');
    expect(url.toString()).not.toContain('+');
    expect([...url.searchParams.keys()]).not.toContain('send');
  });

  it('uses outlook.live.com for personal accounts', () => {
    expect(
      owaComposeUrl({ to: ['a@b.com'], subject: 's', body: 'b', host: 'outlook.live.com' }),
    ).toMatch(/^https:\/\/outlook\.live\.com\/mail\/deeplink\/compose\?/);
  });

  it('tells a sign-in wall from the compose page', () => {
    expect(classifyOwaUrl('https://login.microsoftonline.com/common/oauth2')).toBe('sign_in');
    expect(classifyOwaUrl('https://login.live.com/login.srf')).toBe('sign_in');
    expect(classifyOwaUrl('https://outlook.office.com/mail/deeplink/compose?to=a')).toBe('compose');
    expect(classifyOwaUrl('https://example.com/mail')).toBe('other');
    expect(classifyOwaUrl(undefined)).toBe('other');
  });
});
