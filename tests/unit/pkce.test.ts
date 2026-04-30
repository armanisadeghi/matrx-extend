import { describe, expect, it } from 'vitest';
import {
  encodeState,
  extractVerifierFromState,
  generateCodeChallenge,
  generateCodeVerifier,
  generateNonce,
} from '@/lib/auth/pkce';

describe('PKCE helpers', () => {
  it('verifier round-trips through state', () => {
    const v = generateCodeVerifier();
    const n = generateNonce();
    const state = encodeState(v, n);
    expect(extractVerifierFromState(state)).toBe(v);
  });

  it('verifier is base64url (no =, +, /)', () => {
    for (let i = 0; i < 20; i++) {
      const v = generateCodeVerifier();
      expect(v).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it('code_challenge is deterministic for a given verifier', async () => {
    const v = 'a'.repeat(43);
    const c1 = await generateCodeChallenge(v);
    const c2 = await generateCodeChallenge(v);
    expect(c1).toBe(c2);
    expect(c1).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('extractVerifierFromState returns null for malformed state', () => {
    expect(extractVerifierFromState('no-dot-here')).toBeNull();
    expect(extractVerifierFromState('')).toBeNull();
  });
});
