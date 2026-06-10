import { generateCodeChallenge, generateCodeVerifier, generateNonce } from '@/lib/auth/pkce';
import { describe, expect, it } from 'vitest';

describe('PKCE helpers', () => {
  it('verifier is base64url (no =, +, /) with RFC 7636 length', () => {
    for (let i = 0; i < 20; i++) {
      const v = generateCodeVerifier();
      expect(v).toMatch(/^[A-Za-z0-9_-]+$/);
      // 32 random bytes → 43 base64url chars (RFC 7636 minimum).
      expect(v.length).toBeGreaterThanOrEqual(43);
    }
  });

  it('verifiers are unique', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) seen.add(generateCodeVerifier());
    expect(seen.size).toBe(50);
  });

  it('nonce is base64url and non-empty', () => {
    const n = generateNonce();
    expect(n).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(n.length).toBeGreaterThan(0);
  });

  it('code_challenge is deterministic for a given verifier', async () => {
    const v = 'a'.repeat(43);
    const c1 = await generateCodeChallenge(v);
    const c2 = await generateCodeChallenge(v);
    expect(c1).toBe(c2);
    expect(c1).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('different verifiers produce different challenges', async () => {
    const c1 = await generateCodeChallenge('a'.repeat(43));
    const c2 = await generateCodeChallenge('b'.repeat(43));
    expect(c1).not.toBe(c2);
  });
});
