import { describe, expect, it } from 'vitest';
import {
  evaluatedObservation,
  parseVerificationFields,
  verificationDigestMatches,
} from './local-login-verification';

const spec = JSON.stringify({
  version: 1,
  expect: { timeout_ms: 1000 },
  url_vocabulary: { version: 1, challenge: ['challenge'], sign_in: ['login'] },
  recipe_id: null,
  recipe_version: null,
  descriptors: [],
});

async function digest(value: string): Promise<string> {
  const bytes = new Uint8Array(
    await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(`matrx.local-login-verification.v1\0${value}`),
    ),
  );
  return Array.from(bytes, (item) => item.toString(16).padStart(2, '0')).join('');
}

const observation = {
  password_field_present_before: true,
  password_field_present_after: null,
  otp_field_present_before: false,
  otp_field_present_after: null,
  captcha_present_before: false,
  captcha_present_after: null,
  login_form_present_before: true,
  login_form_present_after: null,
  url_relation: 'unknown' as const,
  url_flow: 'unknown' as const,
  success_url_prefix: null,
  success_selector: null,
  failure_selector: null,
  challenge_selector: null,
  recipe_matches: [],
};

describe('frozen local-login verification receipt', () => {
  it('hashes exact received UTF-8 bytes with the v1 domain separator', async () => {
    const fields = { verification_spec_json: spec, verification_digest: await digest(spec) };
    const parsed = parseVerificationFields(fields);
    if (!parsed) throw new Error('fixture verification fields were rejected');
    expect(await verificationDigestMatches(parsed)).toBe(true);
    expect(await verificationDigestMatches({ ...fields, verification_spec_json: `${spec} ` })).toBe(
      false,
    );
    // Controller and claim hand the verifier the entire already-strict command;
    // only the two frozen fields are intentionally extracted here.
    expect(
      parseVerificationFields({
        operation: 'vault_login',
        credential_item_id: '00000000-0000-4000-8000-000000000001',
        fields: [],
        ...fields,
      }),
    ).not.toBeNull();
  });

  it('refuses unknown receipt keys, descriptor overflow, and raw page material', () => {
    expect(
      evaluatedObservation.safeParse({ ...observation, raw_url: 'https://secret.example' }).success,
    ).toBe(false);
    expect(
      evaluatedObservation.safeParse({ ...observation, recipe_matches: Array(129).fill(null) })
        .success,
    ).toBe(false);
    expect(evaluatedObservation.safeParse(observation).success).toBe(true);
  });
});
