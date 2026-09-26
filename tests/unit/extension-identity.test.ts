import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  EXPECTED_EXTENSION_IDS,
  FIREFOX_GECKO_ID,
  expectedRedirectUris,
  isExpectedExtensionId,
} from '@/config/identity';

const mocks = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('@/config/env', () => ({
  ENV: {
    EXTENSION_OAUTH_CLIENT_ID: 'test-client',
    SUPABASE_URL: 'https://db.matrxserver.com',
  },
}));
vi.mock('@/lib/debug/log', () => ({
  log: { info: mocks.info, warn: mocks.warn },
}));

const CHROME_DEV_ID = 'cihdmkcdjjckfhjpgoedmgfpoljebaml';
const CHROME_DEV_REDIRECT_URI = 'https://cihdmkcdjjckfhjpgoedmgfpoljebaml.chromiumapp.org/';
const CHROME_STORE_ID = 'hnfolienncfklkgmdjjmhhegglimlamg';
const CHROME_STORE_REDIRECT_URI = 'https://hnfolienncfklkgmdjjmhhegglimlamg.chromiumapp.org/';
const OBSERVED_FIREFOX_ID = 'matrx-extend@aimatrx.com';
const FIREFOX_REDIRECT_URI =
  'https://73e3f15e331d0e9b5e3e05495f4d29e37690cbad.extensions.allizom.org/';
const UNKNOWN_FIREFOX_REDIRECT_URI =
  'https://0f0e0d0c0b0a09080706050403020100ffeeddcc.extensions.allizom.org/';

function setExtensionRuntime(runtimeId: string, redirectUri: string) {
  vi.stubGlobal('chrome', {
    runtime: {
      id: runtimeId,
      getManifest: () => ({ version: '0.0.0-test', name: 'Matrx Extend' }),
    },
    identity: { getRedirectURL: () => redirectUri },
  });
}

describe('extension identity diagnostics', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubGlobal('browser', undefined);
  });

  it.each([
    [CHROME_DEV_ID, CHROME_DEV_REDIRECT_URI],
    [CHROME_STORE_ID, CHROME_STORE_REDIRECT_URI],
  ])(
    'accepts the exact independently observed Chromium callback for %s',
    async (runtimeId, redirectUri) => {
      setExtensionRuntime(runtimeId, redirectUri);
      const { readExtensionIdentity } = await import('@/lib/auth/identity');

      expect(readExtensionIdentity()).toMatchObject({
        runtime_id: runtimeId,
        known_id: true,
        expected_redirect_uri: redirectUri,
        redirect_matches_expected: true,
        matches_expected: true,
      });
    },
  );

  it('accepts Firefox only with its observed hashed callback URI', async () => {
    expect(FIREFOX_GECKO_ID).toBe(OBSERVED_FIREFOX_ID);
    expect(EXPECTED_EXTENSION_IDS).toContain(OBSERVED_FIREFOX_ID);
    setExtensionRuntime(OBSERVED_FIREFOX_ID, FIREFOX_REDIRECT_URI);
    const { readExtensionIdentity } = await import('@/lib/auth/identity');

    expect(readExtensionIdentity()).toMatchObject({
      runtime_id: OBSERVED_FIREFOX_ID,
      known_id: true,
      expected_redirect_uri: FIREFOX_REDIRECT_URI,
      redirect_matches_expected: true,
      matches_expected: true,
    });
  });

  it('displays Safari browser.identity callback URI without chrome.identity', async () => {
    vi.stubGlobal('browser', {
      identity: { getRedirectURL: () => 'https://com.example.matrx.safariwebext.apple/' },
    });
    vi.stubGlobal('chrome', {
      runtime: {
        id: 'safari-extension',
        getManifest: () => ({ version: '0.0.0-test', name: 'Matrx Extend' }),
      },
    });
    const { readExtensionIdentity } = await import('@/lib/auth/identity');

    expect(readExtensionIdentity()).toMatchObject({
      redirect_uri: 'https://com.example.matrx.safariwebext.apple/',
      known_id: false,
      matches_expected: false,
    });
  });

  it('rejects an unknown runtime with a valid hash-style Firefox URI', async () => {
    setExtensionRuntime('unknown-addon@example.com', UNKNOWN_FIREFOX_REDIRECT_URI);
    const { readExtensionIdentity } = await import('@/lib/auth/identity');

    expect(readExtensionIdentity()).toMatchObject({
      runtime_id: 'unknown-addon@example.com',
      redirect_uri: UNKNOWN_FIREFOX_REDIRECT_URI,
      known_id: false,
      expected_redirect_uri: '',
      redirect_matches_expected: false,
      matches_expected: false,
    });
  });

  it.each(['constructor', 'toString', '__proto__'])(
    'refuses inherited object property runtime ID %s',
    async (runtimeId) => {
      setExtensionRuntime(runtimeId, UNKNOWN_FIREFOX_REDIRECT_URI);
      const { readExtensionIdentity } = await import('@/lib/auth/identity');

      expect(isExpectedExtensionId(runtimeId)).toBe(false);
      expect(readExtensionIdentity()).toMatchObject({
        known_id: false,
        expected_redirect_uri: '',
        matches_expected: false,
      });
    },
  );

  it('rejects a known runtime ID paired with a different actual callback', async () => {
    setExtensionRuntime(CHROME_DEV_ID, UNKNOWN_FIREFOX_REDIRECT_URI);
    const { readExtensionIdentity } = await import('@/lib/auth/identity');

    expect(readExtensionIdentity()).toMatchObject({
      known_id: true,
      expected_redirect_uri: CHROME_DEV_REDIRECT_URI,
      redirect_matches_expected: false,
      matches_expected: false,
    });
  });

  it('returns the independently observed callback inventory', () => {
    expect(expectedRedirectUris()).toEqual([
      CHROME_DEV_REDIRECT_URI,
      CHROME_STORE_REDIRECT_URI,
      FIREFOX_REDIRECT_URI,
    ]);
  });

  it('builds the Firefox manifest with the shared Gecko identity', async () => {
    const { default: config } = await import('../../wxt.config');
    const buildManifest = config.manifest as unknown as (options: {
      mode: 'production';
      browser: 'firefox';
    }) => { browser_specific_settings?: { gecko?: { id?: string } } };

    expect(
      buildManifest({ mode: 'production', browser: 'firefox' }).browser_specific_settings?.gecko
        ?.id,
    ).toBe(OBSERVED_FIREFOX_ID);
  }, 30_000);
});
