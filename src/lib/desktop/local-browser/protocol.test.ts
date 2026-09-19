import { describe, expect, it } from 'vitest';
import {
  localBrowserResult,
  parseLocalBrowserFrame,
  parseLocalBrowserGrantClaims,
} from './protocol';

const ids = {
  boot: '00000000-0000-4000-8000-000000000001',
  generation: '00000000-0000-4000-8000-000000000002',
  connection: '00000000-0000-4000-8000-000000000003',
  call: '00000000-0000-4000-8000-000000000004',
  user: '00000000-0000-4000-8000-000000000005',
  org: '00000000-0000-4000-8000-000000000006',
  app: '00000000-0000-4000-8000-000000000007',
  run: '00000000-0000-4000-8000-000000000008',
  profile: '00000000-0000-4000-8000-000000000009',
  jti: '00000000-0000-4000-8000-000000000010',
  challenge: '00000000-0000-4000-8000-000000000011',
  admission: '00000000-0000-4000-8000-000000000012',
};

function opaqueGrant(payload: Record<string, unknown>): string {
  const encoded = btoa(JSON.stringify(payload))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `header.${encoded}.signature`;
}

describe('local browser closed protocol', () => {
  it('accepts only the exact registration echo for a current request', () => {
    const registration = {
      type: 'local_browser.registration',
      version: 1,
      status: 'acknowledged',
      engine_boot_id: ids.boot,
      expected_revision: 0,
      extension_generation: ids.generation,
      connection_id: ids.connection,
    };
    expect(parseLocalBrowserFrame(registration)).toEqual(registration);
    expect(
      parseLocalBrowserFrame({ ...registration, reason: 'registration_unavailable' }),
    ).toBeNull();
    expect(parseLocalBrowserFrame({ ...registration, expected_revision: true })).toBeNull();
    expect(
      parseLocalBrowserFrame({
        ...registration,
        status: 'refused',
        reason: 'registration_unavailable',
      }),
    ).toMatchObject({ status: 'refused' });
  });

  it('rejects malformed or reflected lifecycle frames and keeps results closed', () => {
    expect(
      parseLocalBrowserFrame({
        type: 'local_browser.execute',
        version: 1,
        call_id: ids.call,
        operation: 'admit',
        grant: 'x'.repeat(8193),
      }),
    ).toBeNull();
    expect(
      localBrowserResult({
        type: 'local_browser.result',
        version: 1,
        call_id: ids.call,
        operation: 'cleanup',
        status: 'refused',
        reason: 'binding_changed',
      }),
    ).toMatchObject({ reason: 'binding_changed' });
    expect(() =>
      localBrowserResult({
        type: 'local_browser.result',
        version: 1,
        call_id: ids.call,
        operation: 'cleanup',
        status: 'refused',
        reason: 'server said: secret',
      } as never),
    ).toThrow();
  });

  it('projects only strict routing claims from an opaque signed grant', () => {
    const claim = {
      v: 1,
      aud: 'browser-local-executor',
      sub: ids.user,
      organization_id: ids.org,
      app_instance_id: ids.app,
      run_id: ids.run,
      profile_id: ids.profile,
      jti: ids.jti,
      iat: 1,
      exp: Math.floor(Date.now() / 1000) + 30,
      iss: 'https://server.example',
      tier_policy: 'none',
      scopes: [],
      operation: 'admit',
      challenge_id: ids.challenge,
      admission_id: ids.admission,
      extension_generation: ids.generation,
      connection_id: ids.connection,
      controller_revision: 0,
    };
    expect(parseLocalBrowserGrantClaims(opaqueGrant(claim))).toMatchObject({
      operation: 'admit',
      run_id: ids.run,
      admission_id: ids.admission,
    });
    expect(parseLocalBrowserGrantClaims(opaqueGrant({ ...claim, injected: 'nope' }))).toBeNull();
    const duplicate = '{"v":1,"v":1}';
    expect(parseLocalBrowserGrantClaims(`header.${btoa(duplicate)}.signature`)).toBeNull();
  });
});
