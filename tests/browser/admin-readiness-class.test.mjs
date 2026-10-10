import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Window } from 'happy-dom';
import { evaluate, openSection } from './settings-panel-driver.mjs';

// Captured boundary: run 37763007487 had verified admin identity and a rendered
// organization, but no device-choice row. This guards readiness, not native acceptance.
const profileId = '123e4567-e89b-42d3-a456-426614174002';
const organizationId = '123e4567-e89b-42d3-a456-426614174003';
const source = await readFile(
  new URL('./settings-native-auth-driver.mjs', import.meta.url),
  'utf8',
);
function load(transform = (value) => value) {
  const implementation = transform(source)
    .replace(/^import[\s\S]*?from '[^']+';\n/gm, '')
    .replace(/^export /gm, '');
  return new Function(
    'assert',
    'createHash',
    'signInAdminSettings',
    'evaluate',
    'openSection',
    'waitFor',
    `${implementation}; return { signInSettings, verifyCurrentSettingsIdentity };`,
  )(
    assert,
    createHash,
    async () => ({ email: 'admin@admin.com', userId: profileId }),
    evaluate,
    openSection,
    // Only polling/time is replaced. The actual reader and readiness decision run.
    async (label, read, accept) => {
      const state = await read();
      if (!accept(state)) throw new Error(`${label}_not_observed`);
      return state;
    },
  );
}

async function check(driver, changed = {}, expectedReady = true) {
  const window = new Window();
  const state = {
    email: 'admin@admin.com',
    role: 'Admin',
    signOut: true,
    profileId,
    token: 'boundary-only-token',
    isAdmin: true,
    device: null,
    label: "Matrx's Org",
    ...changed,
  };
  window.chrome = {
    storage: {
      local: {
        get: async () => ({
          'matrx.user.profile': { id: state.profileId },
          'matrx.auth.accessToken': state.token,
          'matrx.user.isAdmin': state.isAdmin,
          'matrx.org.active': state.device,
        }),
      },
    },
  };
  window.document.body.innerHTML = `
    <div><button aria-expanded="true">Account</button></div>
    <div><div><span>Email</span><span>${state.email}</span></div>
      <div><span>Role</span><span>${state.role}</span></div></div>
    <div><button aria-expanded="true">Organization</button></div>
    <div><button role="combobox">${state.label ?? 'Choose…'}</button></div>
    ${state.signOut ? '<button>Sign out</button>' : ''}`;
  const panel = {
    send: async (_method, { expression }) => ({ result: { value: await window.eval(expression) } }),
  };
  try {
    const run = () => driver.signInSettings({ mode: 'admin', panel, page: {}, onStage: () => {} });
    if (!expectedReady) {
      await assert.rejects(
        run,
        /d87_admin_(profile_mismatch|role_unverified)|d87_rendered_identity_not_observed/,
      );
      return;
    }
    const result = await run();
    assert.equal(result.extension_signed_in, true);
    assert.equal(result.organizationId, state.device?.id ?? null);
    assert.equal(result.rendered_identity.rendered_role_matches_mode, true);
    // The same shared check is called by Settings reload, audit-key, and panel reopen.
    await driver.verifyCurrentSettingsIdentity({
      panel,
      mode: 'admin',
      email: 'admin@admin.com',
      profileId,
      organizationId: result.organizationId,
    });
    await assert.rejects(
      () =>
        driver.verifyCurrentSettingsIdentity({
          panel,
          mode: 'admin',
          email: 'admin@admin.com',
          profileId,
          organizationId: profileId,
          requireSelectedOrganization: true,
          requiredOrganizationName: "Matrx's Org",
        }),
      /d87_rendered_identity_not_observed/,
    );
    // Principal readiness must not manufacture approved-org proof from the label.
    if (state.device === null)
      await assert.rejects(
        () =>
          driver.verifyCurrentSettingsIdentity({
            panel,
            mode: 'admin',
            email: 'admin@admin.com',
            profileId,
            organizationId: null,
            requireSelectedOrganization: true,
            requiredOrganizationName: "Matrx's Org",
          }),
        /d87_rendered_identity_not_observed/,
      );
  } finally {
    await window.happyDOM.abort();
  }
}

async function contract(driver) {
  await check(driver);
  await check(driver, { label: null });
  await check(driver, { device: { id: organizationId, name: "Matrx's Org" } });
  for (const changed of [
    { email: 'test@test.com' },
    { role: 'Member' },
    { signOut: false },
    { profileId: organizationId },
    { token: null },
    { isAdmin: false },
    { device: { id: organizationId, name: 'Different organization' } },
    { device: { id: 'malformed', name: "Matrx's Org" } },
    { device: { id: null, name: "Matrx's Org" } },
  ])
    await check(driver, changed, false);
}

test('admin sign-in and reload accept the captured load-ladder state without weakening identity or approved-org checks', async () => {
  await contract(load());
});

test('readiness self-test rejects the obsolete no-device-no-selection rule and constant success', async () => {
  const legacy = load((value) =>
    value.replace(
      ': organizationId === null\n          ? !requireSelectedOrganization &&\n            value?.organizationId === null &&\n            value?.organizationName === null',
      ': organizationId === null\n          ? !requireSelectedOrganization &&\n            value?.organizationId === null &&\n            value?.organizationName === null &&\n            !value?.organizationSelected',
    ),
  );
  await assert.rejects(() => contract(legacy), /d87_rendered_identity_not_observed/);
  const constant = load((value) =>
    value.replace('const organizationMatches =', 'return true; const organizationMatches ='),
  );
  await assert.rejects(() => contract(constant), /Missing expected rejection/);
});
