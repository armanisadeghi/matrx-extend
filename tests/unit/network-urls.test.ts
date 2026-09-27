import {
  isCredentialQueryKey,
  safeRequestBodyKey,
  sanitizeNetworkToolSaveArgs,
  sanitizeNetworkUrl,
  transientCredentialFingerprint,
} from '@/lib/credentials/network-urls';
import { describe, expect, it } from 'vitest';

describe('D48 credential-aware Network URL identity', () => {
  it('masks recognized case and encoded key spellings without weakening ordinary query identity', () => {
    const raw =
      'https://user:pass@calendar.invalid/api/events?date=2026-09-27&ACCESS%5FToken=SYNTHETIC_ONLY&page=2#fragment';
    const safe = sanitizeNetworkUrl(raw);
    expect(safe).toBe(
      'https://calendar.invalid/api/events?date=2026-09-27&ACCESS%5FToken=[credential]&page=2',
    );
    expect(safe).not.toContain('SYNTHETIC_ONLY');
    expect(safe).not.toContain('user:pass');
    expect(isCredentialQueryKey('pageToken')).toBe(false);
    expect(
      sanitizeNetworkUrl('https://calendar.invalid/api/events?date=2026-09-28&page=2'),
    ).not.toBe(sanitizeNetworkUrl('https://calendar.invalid/api/events?date=2026-09-27&page=2'));
  });

  it('masks only an explicitly selected unknown key and keeps other ordinary keys', () => {
    const raw = 'https://calendar.invalid/api/events?proof=SYNTHETIC_ONLY&date=2026-09-27&page=2';
    expect(sanitizeNetworkUrl(raw, ['proof'])).toBe(
      'https://calendar.invalid/api/events?proof=[credential]&date=2026-09-27&page=2',
    );
    expect(sanitizeNetworkUrl(raw)).toContain('proof=SYNTHETIC_ONLY');
  });

  it('uses only a transient discriminator to tell different credential values apart within one window', () => {
    const first = 'https://calendar.invalid/api/events?date=2026-09-27&access_token=SYNTHETIC_ONE';
    const second = 'https://calendar.invalid/api/events?date=2026-09-27&access_token=SYNTHETIC_TWO';
    expect(sanitizeNetworkUrl(first)).toBe(sanitizeNetworkUrl(second));
    expect(transientCredentialFingerprint(first)).not.toBe(transientCredentialFingerprint(second));
    expect(transientCredentialFingerprint(first)).toBe(transientCredentialFingerprint(first));
  });

  it('accepts only producer body fingerprints and sanitizes agent network saves before observation', () => {
    expect(safeRequestBodyKey(`sha256:${'a'.repeat(64)}`)).toBe(`sha256:${'a'.repeat(64)}`);
    expect(safeRequestBodyKey('Bearer SYNTHETIC_BODY_SECRET')).toBe('unavailable');
    const safe = sanitizeNetworkToolSaveArgs('data_patterns', {
      action: 'save',
      kind: 'network_capture',
      name: 'Network: https://user:SYNTHETIC_PASSWORD@calendar.invalid/api?access_token=SYNTHETIC_TOKEN',
      domain: 'calendar.invalid',
      fields: [],
      config: {
        url_filter:
          'https://user:SYNTHETIC_PASSWORD@calendar.invalid/api?access_token=SYNTHETIC_TOKEN&date=2026-09-27',
        body_match: 'ignore',
        raw_body: 'SYNTHETIC_BODY_SECRET',
      },
    });
    expect(JSON.stringify(safe)).not.toMatch(/SYNTHETIC_(PASSWORD|TOKEN|BODY_SECRET)/);
    expect(JSON.stringify(safe)).toContain('date=2026-09-27');
    expect((safe as { domain: string }).domain).toBe('calendar.invalid');
    expect(() =>
      sanitizeNetworkToolSaveArgs('data_patterns', {
        action: 'save',
        kind: 'network_capture',
        name: 'Network capture',
        fields: [{ name: 'raw', selector: 'SYNTHETIC_FIELD_SECRET' }],
      }),
    ).toThrow(/do not use CSS fields/i);
    expect(() =>
      sanitizeNetworkToolSaveArgs('data_patterns', {
        action: 'save',
        kind: 'network_capture',
        name: 'Network capture',
        domain: 'https://user:SYNTHETIC_PASSWORD@calendar.invalid/api',
      }),
    ).toThrow(/domain must be a hostname/i);
  });
});
