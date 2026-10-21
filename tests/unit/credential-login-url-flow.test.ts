/**
 * URL-flow tokenization for credential_login's admitted observation — must
 * mirror the server's `url_segments` (aidream fcc37cb2c9): adjacent tokens are
 * re-joined (sign_in → signin, log-in → login, two_factor → twofactor) while
 * membership stays exact (/designing never matches signin).
 */
import { classifyUrlFlow, urlSegments } from '@/lib/tools/handlers/credential-login';
import { describe, expect, it } from 'vitest';

const vocabulary = {
  challenge: ['challenge', 'mfa', '2fa', 'otp', 'verify', 'twofactor', 'onetimecode'],
  sign_in: ['signin', 'login', 'logon', 'signon', 'auth', 'session', 'sessions'],
};

describe('credential_login url flow', () => {
  it('treats a Devise-style /users/sign_in as a sign-in flow', () => {
    expect(classifyUrlFlow('https://example.com/users/sign_in', vocabulary)).toBe('sign_in');
  });

  it('treats a hyphenated /log-in as a sign-in flow', () => {
    expect(classifyUrlFlow('https://example.com/log-in?next=/home', vocabulary)).toBe('sign_in');
  });

  it('treats /two_factor and /one-time-code as a challenge', () => {
    expect(classifyUrlFlow('https://example.com/users/two_factor', vocabulary)).toBe('challenge');
    expect(classifyUrlFlow('https://example.com/one-time-code', vocabulary)).toBe('challenge');
  });

  it('keeps exact membership: /designing is not a sign-in flow', () => {
    expect(classifyUrlFlow('https://example.com/designing', vocabulary)).toBe('other');
    expect(urlSegments('https://example.com/designing').has('signin')).toBe(false);
  });

  it('joins at most three adjacent tokens and reports unknown without a url', () => {
    const segments = urlSegments('/a-b-c-d');
    expect(segments.has('abc')).toBe(true);
    expect(segments.has('bcd')).toBe(true);
    expect(segments.has('abcd')).toBe(false);
    expect(classifyUrlFlow(null, vocabulary)).toBe('unknown');
  });
});
