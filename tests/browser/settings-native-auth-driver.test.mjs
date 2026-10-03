import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import {
  currentSettingsIdentityMatches,
  panelIdentity,
  settingsShellReady,
} from './settings-native-auth-driver.mjs';

function readinessContract(check) {
  // The headed D87 reload had guest=false while no Settings control was mounted.
  for (const mode of ['admin', 'member', 'guest']) {
    assert.equal(check({ settingsAvailable: false, guest: false }, mode), false, 'blank shell');
    assert.equal(check(null, mode), false, 'unavailable shell');
    assert.equal(
      check({ settingsAvailable: true, guest: mode === 'guest' }, mode),
      true,
      'mounted role-appropriate shell',
    );
    assert.equal(
      check({ settingsAvailable: true, guest: mode !== 'guest' }, mode),
      false,
      'wrong account mode',
    );
  }
}

test('Settings readiness requires mounted controls before initial and reload clicks', () => {
  readinessContract(settingsShellReady);
});

test('readiness guard kills constant-return and missing-mount mutations in memory', () => {
  for (const body of [
    '() => true',
    '() => false',
    settingsShellReady.toString().replace('state?.settingsAvailable === true && ', ''),
  ]) {
    const mutant = runInNewContext(`(${body})`);
    assert.throws(() => readinessContract(mutant), { code: 'ERR_ASSERTION' });
  }
});

const MEMBER = '123e4567-e89b-42d3-a456-426614174000';
const ORGANIZATION = '123e4567-e89b-42d3-a456-426614174001';

function storagePanel(organization) {
  return {
    async send(command, { expression }) {
      assert.equal(command, 'Runtime.evaluate');
      const result = await runInNewContext(expression, {
        chrome: {
          storage: {
            local: {
              async get() {
                return {
                  'matrx.auth.accessToken': 'test-only-placeholder',
                  'matrx.user.profile': { id: MEMBER },
                  'matrx.user.isAdmin': false,
                  'matrx.org.active': organization,
                };
              },
            },
          },
        },
      });
      return { result: { value: result } };
    },
  };
}

test('Settings identity reads the real active-organization object shape', async () => {
  const selected = await panelIdentity(storagePanel({ id: ORGANIZATION, name: "Matrx's Org" }));
  assert.equal(selected.profileId, MEMBER);
  assert.equal(selected.organizationId, ORGANIZATION);
  assert.equal(selected.organizationName, "Matrx's Org");
  assert.equal(selected.isAdmin, false);

  const malformed = await panelIdentity(storagePanel(ORGANIZATION));
  assert.equal(malformed.organizationId, null);
  assert.equal(malformed.organizationName, null);
});

test('reload identity rejects cached storage with wrong rendered role or organization', () => {
  const expected = { mode: 'member', profileId: MEMBER, organizationId: ORGANIZATION };
  const valid = {
    emailMatches: true,
    signOutVisible: true,
    accessTokenPresent: true,
    profileId: MEMBER,
    roleAbsent: true,
    isAdmin: false,
    organizationId: ORGANIZATION,
    organizationName: "Matrx's Org",
    organizationLabel: "Matrx's Org",
    organizationSelected: true,
  };
  assert.equal(currentSettingsIdentityMatches(valid, expected), true);
  assert.equal(currentSettingsIdentityMatches({ ...valid, emailMatches: false }, expected), false);
  assert.equal(currentSettingsIdentityMatches({ ...valid, roleAbsent: false }, expected), false);
  assert.equal(
    currentSettingsIdentityMatches({ ...valid, organizationLabel: 'Other Org' }, expected),
    false,
  );
  assert.equal(
    currentSettingsIdentityMatches({ ...valid, organizationId: MEMBER }, expected),
    false,
  );
});
