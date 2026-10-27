import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { adminRoleMatchesExpectation } from './admin-settings-signin.mjs';
import {
  MEMBER_TEST_ORGANIZATION_NAME,
  approvedAdminOrganizationName,
  approvedShowcaseOrganization,
  currentSettingsIdentityMatches,
  observeOrganizationOption,
  panelIdentity,
  resolveMemberOrganizationSelection,
  selectOrganization,
  settingsOrganizationSelectionRequired,
  settingsShellReady,
  signInSettings,
  waitForOrganizationOption,
} from './settings-native-auth-driver.mjs';

test('admin role expectation defaults to the existing visible role and supports strict hidden-row proof', () => {
  const visible = { adminRole: true, roleAbsent: false };
  const hidden = { adminRole: false, roleAbsent: true };
  assert.equal(adminRoleMatchesExpectation(visible), true);
  assert.equal(adminRoleMatchesExpectation(visible, 'visible'), true);
  assert.equal(adminRoleMatchesExpectation(hidden), false);
  assert.equal(adminRoleMatchesExpectation(hidden, 'hidden'), true);
  assert.equal(
    adminRoleMatchesExpectation({ adminRole: false, roleAbsent: false }, 'hidden'),
    false,
  );
  assert.equal(adminRoleMatchesExpectation({ adminRole: true, roleAbsent: true }, 'hidden'), false);
  assert.throws(
    () => adminRoleMatchesExpectation(hidden, 'either'),
    /d87_admin_role_expectation_invalid/,
  );
});

test('member organization proof distinguishes load ladder from a device choice', () => {
  const id = '123e4567-e89b-42d3-a456-426614174001';
  const label = MEMBER_TEST_ORGANIZATION_NAME;
  assert.equal(
    resolveMemberOrganizationSelection(
      { organizationId: null, organizationName: null },
      label,
      true,
      id,
    ),
    'load_ladder',
  );
  assert.throws(
    () =>
      resolveMemberOrganizationSelection({ organizationId: null, organizationName: null }, label),
    /d87_member_organization_uuid_unverified/,
  );
  assert.equal(
    resolveMemberOrganizationSelection(
      { organizationId: id, organizationName: label },
      label,
      true,
      id,
    ),
    'device_choice',
  );
  assert.throws(
    () =>
      resolveMemberOrganizationSelection(
        { organizationId: id, organizationName: label },
        label,
        true,
        '123e4567-e89b-42d3-a456-426614174002',
      ),
    /d87_member_organization_mismatch/,
  );
  assert.throws(
    () =>
      resolveMemberOrganizationSelection(
        { organizationId: null, organizationName: null },
        label,
        true,
      ),
    /d87_member_expected_organization_unverified/,
  );
  for (const [stored, visible] of [
    [{ organizationId: null, organizationName: null }, 'Other organization'],
    [{ organizationId: 'invalid', organizationName: label }, label],
    [{ organizationId: id, organizationName: 'Other organization' }, label],
    [{ organizationId: null, organizationName: label }, label],
  ]) {
    assert.throws(
      () => resolveMemberOrganizationSelection(stored, visible, true, id),
      /d87_member_organization_(label|storage)_unverified/,
    );
  }
});

test('member organization proof accepts the approved fixture name instead of the legacy label', () => {
  const id = '123e4567-e89b-42d3-a456-426614174001';
  const approvedName = 'Harbor Dental';
  assert.equal(
    resolveMemberOrganizationSelection(
      { organizationId: id, organizationName: approvedName },
      approvedName,
      true,
      id,
      approvedName,
    ),
    'device_choice',
  );
  assert.throws(
    () =>
      resolveMemberOrganizationSelection(
        { organizationId: id, organizationName: MEMBER_TEST_ORGANIZATION_NAME },
        MEMBER_TEST_ORGANIZATION_NAME,
        true,
        id,
        approvedName,
      ),
    /d87_member_organization_label_unverified/,
  );
});

test('member Settings acceptance admits the verified load-ladder organization', async () => {
  const source = await readFile(
    new URL('./settings-d87-native-acceptance.mjs', import.meta.url),
    'utf8',
  );
  const signInCall = source.match(
    /const authentication = await signInSettings\(\{([\s\S]*?)\n\s*\}\);/,
  );
  assert.ok(signInCall, 'Settings acceptance must call the shared sign-in driver');
  assert.match(
    signInCall[1],
    /allowLadderOrganization:\s*AUTH_MODE === 'member'/,
    'member Settings must admit an organization resolved by the load ladder',
  );
  assert.match(
    source,
    /expectedOrganizationResolution = authentication\.organization_resolution/,
    'the verified sign-in resolution must reach subsequent Settings checks',
  );
  const reloadIdentityCheck = source.match(
    /async function assertExpectedIdentity\(panel\) \{([\s\S]*?)\n\}\n\nasync function openSettings/,
  );
  assert.ok(reloadIdentityCheck, 'Settings reload must use its identity checker');
  assert.match(
    reloadIdentityCheck[1],
    /verifyCurrentSettingsIdentity\(\{[\s\S]*?organizationResolution: expectedOrganizationResolution/,
    'reload readiness must distinguish a ladder result from a device choice',
  );
  assert.match(reloadIdentityCheck[1], /observeMemberLogicalOrganizationGet\(/);
  assert.match(
    reloadIdentityCheck[1],
    /await refreshMemberLogicalOrganizationGet\(panel, observer\)/,
  );
  assert.match(reloadIdentityCheck[1], /await observer\.verify\(\)/);
  const authDriver = await readFile(
    new URL('./settings-native-auth-driver.mjs', import.meta.url),
    'utf8',
  );
  const initialIdentityCheck = authDriver.match(
    /const rendered = await runMemberAuthBoundary\('member_rendered_identity',[\s\S]*?await onTrace\?\.\('auth_identity_after'\)/,
  );
  assert.ok(initialIdentityCheck, 'member sign-in must verify the initial Settings identity');
  assert.match(
    initialIdentityCheck[0],
    /organizationId: expectedOrganizationId \?\? selected\.organizationId/,
  );
  assert.match(initialIdentityCheck[0], /organizationResolution,/);
  assert.match(initialIdentityCheck[0], /requiredOrganizationName,/);
  const requestProof = authDriver.match(
    /const logicalOrganizationRequest = await runMemberAuthBoundary\([\s\S]*?return \{\s*mode,\s*profileId: identity\.userId/,
  );
  assert.ok(requestProof, 'member sign-in must prove the live request-bound organization');
  assert.match(requestProof[0], /observeMemberLogicalOrganizationGet\(/);
  assert.match(
    requestProof[0],
    /await refreshMemberLogicalOrganizationGet\(panel, observer, click, onAuthDiagnostic\)/,
  );
  assert.match(requestProof[0], /await observer\.verify\(\)/);
});
import { recordDataMemberDriverDiagnostic } from './data-member-driver-diagnostic.mjs';
import { runMemberAuthBoundary } from './settings-member-auth-diagnostic.mjs';
import { click } from './settings-panel-driver.mjs';

function optionPanel({
  names,
  targetY = 70,
  occluded = false,
  menuOpen = true,
  foreignNames = [],
  openAfter = 0,
}) {
  let reads = 0;
  let scrollCount = 0;
  let currentY = targetY;
  const events = [];
  const pointerSamples = [];
  const rect = (x, y, width, height) => ({
    x,
    y,
    width,
    height,
    left: x,
    top: y,
    right: x + width,
    bottom: y + height,
  });
  const isOpen = () => menuOpen && reads >= openAfter;
  const options = names.map((name, index) => ({
    textContent: name,
    getBoundingClientRect: () => rect(20, currentY + index * 20, 100, 18),
    contains: () => false,
    closest: () => null,
    getAnimations: () => [],
    scrollIntoView: () => {
      scrollCount += 1;
      currentY = 70;
    },
    parentElement: null,
  }));
  const listbox = {
    getAttribute: (name) =>
      name === 'role' ? 'listbox' : name === 'data-state' ? (isOpen() ? 'open' : 'closed') : null,
    querySelectorAll: (selector) => (selector === '[role="option"]' ? options : []),
    getBoundingClientRect: () => rect(10, 10, 120, isOpen() ? 120 : 0),
  };
  const trigger = {
    textContent: 'Choose…',
    getAttribute: (name) =>
      name === 'aria-controls'
        ? 'organization-menu'
        : name === 'aria-expanded'
          ? isOpen()
            ? 'true'
            : 'false'
          : null,
    getBoundingClientRect: () => rect(20, 20, 100, 18),
    contains: () => false,
    closest: () => null,
    getAnimations: () => [],
    scrollIntoView: () => {},
    parentElement: null,
  };
  const label = {
    textContent: 'Acting as',
    parentElement: { parentElement: { querySelectorAll: () => [trigger] } },
  };
  const foreignOptions = foreignNames.map((name) => ({
    textContent: name,
    getBoundingClientRect: () => rect(20, 70, 100, 18),
    contains: () => false,
  }));
  const filter = { querySelectorAll: () => [{ textContent: 'Active only' }] };
  const document = {
    // The real pointer sampler observes browser clocks and document focus even
    // when no animation is running. Keep that boundary present in this VM.
    hasFocus: () => true,
    visibilityState: 'visible',
    timeline: {
      get currentTime() {
        return performance.now();
      },
    },
    querySelectorAll: (selector) =>
      selector === 'span'
        ? [label]
        : selector === '[role="option"]'
          ? [...options, ...foreignOptions]
          : [listbox],
    getElementById: (id) => (id === 'organization-menu' ? listbox : null),
    querySelector: () => filter,
    elementFromPoint: (x, y) =>
      occluded
        ? {}
        : ([...foreignOptions, ...options].find((option) => {
            const rect = option.getBoundingClientRect();
            return x >= rect.x && x < rect.right && y >= rect.y && y < rect.bottom;
          }) ?? (x >= 20 && x < 120 && y >= 20 && y < 38 ? trigger : null)),
  };
  return {
    events,
    pointerSamples,
    get scrollCount() {
      return scrollCount;
    },
    async send(command, parameters) {
      if (command === 'Input.dispatchMouseEvent') {
        events.push(parameters);
        return {};
      }
      assert.equal(command, 'Runtime.evaluate');
      const { expression } = parameters;
      reads += 1;
      const value = runInNewContext(expression, {
        document,
        performance,
        getComputedStyle: () => ({
          display: 'block',
          visibility: 'visible',
          overflowX: 'visible',
          overflowY: 'visible',
          position: 'static',
          pointerEvents: 'auto',
        }),
        innerWidth: 300,
        innerHeight: 200,
      });
      if (value?.animationDiagnostic) pointerSamples.push(value);
      return { result: { value } };
    },
  };
}

test('organization selection waits for its associated menu to render and settle', async () => {
  const requiresObservation = async (selector) => {
    const samples = [];
    const point = await selector(
      optionPanel({ names: ['Approved'], openAfter: 3 }),
      'Approved',
      (sample) => samples.push(sample),
    );
    assert.equal(samples[0].menu_open, false);
    assert.equal(samples[1].menu_open, false);
    assert.equal(samples.at(-1).menu_open, true);
    assert.ok(samples.filter((sample) => sample.menu_open).length >= 2);
    assert.deepEqual({ ...point }, { x: 70, y: 79 });
  };
  await assert.rejects(
    requiresObservation(async () => ({ x: 70, y: 79 })),
    /menu_open/,
  );
  await requiresObservation(waitForOrganizationOption);
});

test('an owned offscreen option becomes eligible for the shared pointer reveal path', async () => {
  const samples = [];
  await waitForOrganizationOption(
    optionPanel({ names: ['Approved'], targetY: 400 }),
    'Approved',
    (sample) => samples.push(sample),
  );
  assert.equal(samples.at(-1).exact_visible_match_count, 1);
  assert.equal(samples.at(-1).target_in_viewport, false);
});

test('the actual selector reveals and hit-tests its owned offscreen option before trusted input', async () => {
  const run = async (selector) => {
    const panel = optionPanel({ names: ['Approved'], targetY: 400 });
    await selector(panel, 'Approved');
    assert.ok(panel.scrollCount >= 3, 'the shared pointer path must reveal and resample');
    assert.deepEqual(
      panel.events.map((event) => event.type),
      ['mousePressed', 'mouseReleased', 'mousePressed', 'mouseReleased'],
    );
    assert.equal(panel.events[2].y, 79);
    assert.ok(panel.pointerSamples.length >= 6, 'both clicks must sample pointer readiness');
    for (const { animationDiagnostic } of panel.pointerSamples) {
      assert.ok(Number.isFinite(animationDiagnostic.sampledAt));
      assert.ok(Number.isFinite(animationDiagnostic.documentTimelineTime));
      assert.equal(animationDiagnostic.documentVisibilityState, 'visible');
      assert.equal(animationDiagnostic.focused, true);
    }
  };
  await assert.rejects(
    run(async () => {}),
    { code: 'ERR_ASSERTION' },
  );
  await run(selectOrganization);
  for (const panel of [
    optionPanel({ names: ['Other'], foreignNames: ['Approved'] }),
    optionPanel({ names: ['Approved', 'Approved'] }),
    optionPanel({ names: [], menuOpen: false, foreignNames: ['Approved'] }),
  ]) {
    await assert.rejects(
      click(panel, 'organization-option', 'Approved'),
      /unique visible pointer target/,
    );
    assert.equal(panel.events.length, 0);
  }
});

test('option boundary distinguishes absent, duplicate, offscreen, occluded, and selectable targets', async () => {
  const selected = await observeOrganizationOption(
    optionPanel({ names: ['Approved', 'Other'] }),
    'Approved',
  );
  assert.equal(selected.menu_open, true);
  assert.equal(selected.visible_option_count, 2);
  assert.equal(selected.exact_match_count, 1);
  assert.equal(selected.exact_visible_match_count, 1);
  assert.equal(selected.target_center_hit, true);
  assert.deepEqual({ ...selected.point }, { x: 70, y: 79 });
  const missing = await observeOrganizationOption(optionPanel({ names: ['Other'] }), 'Approved');
  assert.equal(missing.exact_match_count, 0);
  assert.equal(missing.point, null);
  const duplicate = await observeOrganizationOption(
    optionPanel({ names: ['Approved', 'Approved'] }),
    'Approved',
  );
  assert.equal(duplicate.exact_visible_match_count, 2);
  assert.equal(duplicate.point, null);
  const offscreen = await observeOrganizationOption(
    optionPanel({ names: ['Approved'], targetY: 400 }),
    'Approved',
  );
  assert.equal(offscreen.target_in_viewport, false);
  assert.equal(offscreen.point, null);
  const covered = await observeOrganizationOption(
    optionPanel({ names: ['Approved'], occluded: true }),
    'Approved',
  );
  assert.equal(covered.target_center_hit, false);
  assert.equal(covered.point, null);
  const closed = await observeOrganizationOption(
    optionPanel({ names: [], menuOpen: false }),
    'Approved',
  );
  assert.equal(closed.menu_open, false);
  assert.equal(closed.point, null);
  const closedForeign = await observeOrganizationOption(
    optionPanel({ names: [], menuOpen: false, foreignNames: ['Approved'] }),
    'Approved',
  );
  assert.equal(closedForeign.menu_open, false);
  assert.equal(closedForeign.exact_visible_match_count, 0);
  assert.equal(closedForeign.point, null);
  const openForeign = await observeOrganizationOption(
    optionPanel({ names: ['Other'], foreignNames: ['Approved'] }),
    'Approved',
  );
  assert.equal(openForeign.menu_open, true);
  assert.equal(openForeign.exact_visible_match_count, 0);
  assert.equal(openForeign.point, null);
});

test('approved admin organization is read only from a private named fixture', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'settings-approved-admin-org-'));
  const fixture = join(directory, 'approved.json');
  try {
    await writeFile(fixture, '{"approved_organization_name":"Matrx Org"}', { mode: 0o600 });
    assert.equal(await approvedAdminOrganizationName(fixture), 'Matrx Org');
    await chmod(fixture, 0o644);
    await assert.rejects(
      approvedAdminOrganizationName(fixture),
      /d87_approved_admin_organization_file_not_private/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('showcase requires a private name and UUID fixture before native setup', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'showcase-approved-org-'));
  const fixture = join(directory, 'approved.json');
  try {
    await writeFile(fixture, '{"approved_organization_name":"Matrx Org"}', { mode: 0o600 });
    await assert.rejects(
      approvedShowcaseOrganization(fixture),
      /d87_approved_admin_organization_id_invalid/,
    );
    await writeFile(
      fixture,
      '{"approved_organization_name":"Matrx Org","approved_organization_id":"72336a38-f816-442f-ad48-18610128fb67"}',
    );
    assert.deepEqual(await approvedShowcaseOrganization(fixture), {
      name: 'Matrx Org',
      id: '72336a38-f816-442f-ad48-18610128fb67',
    });
    await chmod(fixture, 0o644);
    await assert.rejects(
      approvedShowcaseOrganization(fixture),
      /d87_approved_admin_organization_file_not_private/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

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
                  'matrx.oauth.session': JSON.stringify({
                    v: 1,
                    accessToken: 'test-only-placeholder',
                  }),
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

test('Debug-off admin identity requires exact Role-row absence and keeps every principal check', () => {
  const hidden = {
    emailMatches: true,
    signOutVisible: true,
    accessTokenPresent: true,
    profileId: '123e4567-e89b-42d3-a456-426614174002',
    roleAbsent: true,
    adminRole: false,
    isAdmin: true,
    organizationId: null,
    organizationName: null,
    organizationLabel: null,
    organizationSelected: false,
  };
  const expected = {
    mode: 'admin',
    profileId: hidden.profileId,
    organizationId: null,
    expectedAdminRole: 'hidden',
  };
  assert.equal(currentSettingsIdentityMatches(hidden, expected), true);
  for (const changed of [
    { roleAbsent: false },
    { adminRole: true },
    { isAdmin: false },
    { emailMatches: false },
    { signOutVisible: false },
    { accessTokenPresent: false },
    { profileId: '123e4567-e89b-42d3-a456-426614174099' },
  ])
    assert.equal(currentSettingsIdentityMatches({ ...hidden, ...changed }, expected), false);
  assert.throws(
    () => currentSettingsIdentityMatches(hidden, { ...expected, expectedAdminRole: 'unknown' }),
    /d87_admin_role_expectation_invalid/,
  );
  assert.throws(
    () =>
      currentSettingsIdentityMatches(hidden, {
        ...expected,
        mode: 'member',
        expectedAdminRole: 'hidden',
      }),
    /d87_admin_role_expectation_mode_invalid/,
  );
});

test('member Settings reload preserves the distinction between load-ladder and device-choice organizations', () => {
  const rendered = {
    emailMatches: true,
    signOutVisible: true,
    accessTokenPresent: true,
    profileId: MEMBER,
    roleAbsent: true,
    adminRole: false,
    isAdmin: false,
    organizationId: null,
    organizationName: null,
    organizationSelected: true,
    organizationLabel: MEMBER_TEST_ORGANIZATION_NAME,
  };
  const ladder = {
    mode: 'member',
    profileId: MEMBER,
    organizationId: ORGANIZATION,
    organizationResolution: 'load_ladder',
    requiredOrganizationName: MEMBER_TEST_ORGANIZATION_NAME,
  };
  assert.equal(currentSettingsIdentityMatches(rendered, ladder), true);
  assert.equal(
    currentSettingsIdentityMatches(
      { ...rendered, organizationLabel: 'Another Organization' },
      ladder,
    ),
    false,
  );
  assert.equal(
    currentSettingsIdentityMatches({ ...rendered, organizationSelected: false }, ladder),
    false,
  );
  assert.equal(
    currentSettingsIdentityMatches({ ...rendered, organizationId: ORGANIZATION }, ladder),
    false,
  );
  assert.equal(
    currentSettingsIdentityMatches(rendered, { ...ladder, organizationId: 'invalid' }),
    false,
  );
  assert.equal(
    currentSettingsIdentityMatches(rendered, {
      ...ladder,
      organizationResolution: 'device_choice',
    }),
    false,
  );
  assert.equal(
    currentSettingsIdentityMatches(
      {
        ...rendered,
        organizationId: ORGANIZATION,
        organizationName: MEMBER_TEST_ORGANIZATION_NAME,
      },
      { ...ladder, organizationResolution: 'device_choice' },
    ),
    true,
  );
});

test('Scrape requires the approved selected organization while Settings keeps its null-org contract', () => {
  assert.equal(MEMBER_TEST_ORGANIZATION_NAME, "Matrx's Org");
  assert.equal(settingsOrganizationSelectionRequired(null), true);
  assert.equal(
    settingsOrganizationSelectionRequired({
      organizationSelected: true,
      organizationLabel: 'Another Organization',
    }),
    true,
  );
  assert.equal(
    settingsOrganizationSelectionRequired({
      organizationSelected: true,
      organizationLabel: MEMBER_TEST_ORGANIZATION_NAME,
    }),
    false,
  );

  const admin = {
    emailMatches: true,
    signOutVisible: true,
    accessTokenPresent: true,
    profileId: '123e4567-e89b-42d3-a456-426614174002',
    adminRole: true,
    isAdmin: true,
    organizationId: null,
    organizationName: null,
    organizationLabel: null,
    organizationSelected: false,
  };
  const settingsIdentity = {
    mode: 'admin',
    profileId: admin.profileId,
    organizationId: null,
  };
  assert.equal(currentSettingsIdentityMatches(admin, settingsIdentity), true);
  assert.equal(
    currentSettingsIdentityMatches(admin, {
      ...settingsIdentity,
      requireSelectedOrganization: true,
      requiredOrganizationName: MEMBER_TEST_ORGANIZATION_NAME,
    }),
    false,
    'Scrape must reject the same null organization accepted by the Settings contract',
  );

  const mismatched = {
    ...admin,
    organizationId: ORGANIZATION,
    organizationName: 'Another Organization',
    organizationLabel: 'Another Organization',
    organizationSelected: true,
  };
  assert.equal(
    currentSettingsIdentityMatches(mismatched, {
      mode: 'admin',
      profileId: admin.profileId,
      organizationId: ORGANIZATION,
      requireSelectedOrganization: true,
      requiredOrganizationName: MEMBER_TEST_ORGANIZATION_NAME,
    }),
    false,
    'Scrape must reject a selected organization outside the approved fixture',
  );

  assert.equal(
    currentSettingsIdentityMatches(
      {
        ...mismatched,
        organizationId: MEMBER,
        organizationName: MEMBER_TEST_ORGANIZATION_NAME,
        organizationLabel: MEMBER_TEST_ORGANIZATION_NAME,
      },
      {
        mode: 'admin',
        profileId: admin.profileId,
        organizationId: ORGANIZATION,
        requireSelectedOrganization: true,
        requiredOrganizationName: MEMBER_TEST_ORGANIZATION_NAME,
      },
    ),
    false,
    'Scrape must reject a device organization that changed after selection',
  );

  const approved = {
    ...mismatched,
    organizationName: "Matrx's Org",
    organizationLabel: "Matrx's Org",
  };
  assert.equal(
    currentSettingsIdentityMatches(approved, {
      mode: 'admin',
      profileId: admin.profileId,
      organizationId: ORGANIZATION,
      requireSelectedOrganization: true,
      requiredOrganizationName: MEMBER_TEST_ORGANIZATION_NAME,
    }),
    true,
  );
  assert.equal(
    currentSettingsIdentityMatches(
      { ...approved, adminRole: false, isAdmin: false, roleAbsent: true },
      {
        mode: 'member',
        profileId: admin.profileId,
        organizationId: ORGANIZATION,
        requireSelectedOrganization: true,
        requiredOrganizationName: MEMBER_TEST_ORGANIZATION_NAME,
      },
    ),
    true,
    'the same approved device organization remains valid for the member route',
  );
});

for (const observerPresent of [false, true]) {
  test(`member auth refuses missing resource evidence before creating a page with stage observer present=${observerPresent}`, async () => {
    const repo = await mkdtemp(join(tmpdir(), 'settings-missing-resource-'));
    const operations = [];
    const stages = [];
    const page = {
      context: () => ({ newPage: async () => ({ close: async () => operations.push('closed') }) }),
      bringToFront: async () => operations.push('root_activated'),
    };
    try {
      await assert.rejects(
        signInSettings({
          mode: 'member',
          page,
          panel: {},
          repo,
          ...(observerPresent && { onStage: (stage) => stages.push(stage) }),
        }),
        (error) => error?.message?.startsWith('NATIVE_RESOURCE_BOUNDARY_REFUSED:'),
      );
      assert.deepEqual(operations, []);
      assert.deepEqual(stages, []);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });
}

test('organization diagnostics distinguish successful option click from trigger dispatch failure without exposing labels', async () => {
  const successful = [];
  await selectOrganization(optionPanel({ names: ['Approved'] }), 'Approved', (value) =>
    successful.push(value),
  );
  assert.equal(successful[0].phase, 'organization_trigger_click');
  assert.equal(successful[0].trigger_count, 1);
  assert.equal(successful[0].visible_trigger_count, 1);
  assert.ok(
    successful.some(
      (value) =>
        value.phase === 'organization_option_visibility' && value.exact_visible_match_count === 1,
    ),
  );
  assert.deepEqual(successful.at(-1), { phase: 'organization_option_click', click_settled: true });
  const panel = optionPanel({ names: ['Approved'] });
  const send = panel.send.bind(panel);
  panel.send = async (method, args) => {
    if (method === 'Input.dispatchMouseEvent') {
      const error = new Error('private identity token organization');
      error.driverFailure = { code: 'pointer_press_dispatch_failed', secret: 'private' };
      throw error;
    }
    return send(method, args);
  };
  const failed = [];
  await assert.rejects(selectOrganization(panel, 'Approved', (value) => failed.push(value)));
  assert.deepEqual(failed.at(-1), {
    phase: 'organization_trigger_click',
    failure_code: 'pointer_press_dispatch_failed',
  });
  assert.equal(JSON.stringify([...successful, ...failed]).includes('Approved'), false);
  assert.equal(JSON.stringify([...successful, ...failed]).includes('private'), false);
});

test('Data acceptance aggregates organization diagnostics across real auth boundary success and failure', async () => {
  const source = await readFile(
    new URL('./data-member-native-acceptance.mjs', import.meta.url),
    'utf8',
  );
  const setupStart = source.indexOf("      report.stage = 'member_auth';");
  const setupEnd = source.indexOf('      await activatePanel();', setupStart);
  assert.ok(setupStart >= 0 && setupEnd > setupStart);
  const catchStart = source.lastIndexOf('} catch (error) {') + '} catch (error) {'.length;
  const catchEnd = source.indexOf('} finally {', catchStart);
  const safeFailureStart = source.indexOf('function safeFailureCode(error) {');
  const safeFailureEnd = source.indexOf('\nasync function deleteSavedPattern', safeFailureStart);
  const execute = new Function(
    'deps',
    `
    const { report, requireResourceHealth, signInSettings, recordDataMemberDriverDiagnostic,
      process, assert, UUID, REPO, page, panel } = deps;
    ${source.slice(safeFailureStart, safeFailureEnd)}
    return (async () => {
      try { ${source.slice(setupStart, setupEnd)} }
      catch (error) { ${source.slice(catchStart, catchEnd)} }
      return JSON.parse(JSON.stringify(report));
    })();
  `,
  );
  for (const failedPress of [null, 1, 2]) {
    const panel = optionPanel({ names: ['Northline Furnishings internal organization'] });
    const send = panel.send.bind(panel);
    let presses = 0;
    panel.send = async (method, args) => {
      if (method === 'Input.dispatchMouseEvent' && args.type === 'mousePressed') {
        presses += 1;
        if (presses === failedPress) {
          const error = new Error(
            'private-access-token https://private.invalid/session Northline Furnishings internal organization',
          );
          error.driverFailure = {
            code: 'pointer_press_dispatch_failed',
            secret: 'private-access-token',
          };
          throw error;
        }
      }
      return send(method, args);
    };
    const stderr = [];
    const processBoundary = {
      env: { MATRX_REVIEWER_APPROVED_ORGANIZATION_FILE: '/private/approved-member.json' },
      stderr: { write: (value) => stderr.push(value) },
      exitCode: 0,
    };
    const result = await execute({
      report: { status: 'unverified', authentication: null },
      requireResourceHealth: async () => {},
      signInSettings: async ({ onStage, onAuthDiagnostic }) => {
        await runMemberAuthBoundary('member_organization_selection', onStage, () =>
          selectOrganization(
            panel,
            'Northline Furnishings internal organization',
            onAuthDiagnostic,
          ),
        );
        return {
          web_signed_in: true,
          extension_signed_in: true,
          admin_role: false,
          canonical_nonadmin_check: { returned_rows: 0 },
          organization_selected: true,
          organization_resolution: 'device_choice',
          organizationId: '123e4567-e89b-42d3-a456-426614174001',
        };
      },
      recordDataMemberDriverDiagnostic,
      process: processBoundary,
      assert,
      UUID: /^[0-9a-f-]{36}$/,
      REPO: '',
      page: {},
      panel,
    });
    assert.equal(result.auth_stage, 'member_organization_selection');
    assert.equal(result.auth_diagnostic.trigger_count, 1);
    assert.equal(result.auth_diagnostic.visible_trigger_count, 1);
    if (failedPress === null) {
      assert.equal(result.status, 'unverified');
      assert.equal(result.authentication.organization_selected, true);
      assert.equal(result.auth_diagnostic.phase, 'organization_option_click');
      assert.equal(result.auth_diagnostic.click_settled, true);
      assert.equal(result.auth_diagnostic.exact_visible_match_count, 1);
      assert.equal(processBoundary.exitCode, 0);
      assert.deepEqual(stderr, []);
    } else {
      assert.equal(result.status, 'fail');
      assert.equal(result.failure_stage, 'member_auth');
      assert.equal(result.authentication, null);
      assert.equal(result.error_code, 'pointer_press_dispatch_failed');
      assert.equal(result.auth_diagnostic.failure_code, 'pointer_press_dispatch_failed');
      assert.equal(
        result.auth_diagnostic.phase,
        failedPress === 1 ? 'organization_trigger_click' : 'organization_option_click',
      );
      assert.equal(result.auth_diagnostic.click_settled, false);
      assert.equal(processBoundary.exitCode, 1);
      assert.deepEqual(stderr, [
        'DATA_MEMBER_ACCEPTANCE_FAILED member_auth pointer_press_dispatch_failed\n',
      ]);
    }
    const serialized = JSON.stringify({ result, stderr });
    for (const forbidden of [
      'Northline Furnishings',
      'private-access-token',
      'https://private.invalid',
      '123e4567-e89b-42d3-a456-426614174001',
    ])
      assert.equal(serialized.includes(forbidden), false);
  }
});

test('admin sign-in parks the owned web tab on whoami through extension auth and closes after identity proof', async () => {
  const source = await readFile(new URL('./admin-settings-signin.mjs', import.meta.url), 'utf8');
  const implementation = source
    .replace(/^import[\s\S]*?from '[^']+';\n/gm, '')
    .replace(/^export /gm, '');
  const order = [];
  let currentUrl = 'about:blank';
  let signedIntoExtension = false;
  let resourceDepth = 0;
  let identityCandidateIndex = 0;
  const identityCandidates = [
    { email: 'other@admin.com', userId: '123e4567-e89b-42d3-a456-426614174002' },
    { email: 'admin@admin.com', userId: 'not-a-uuid' },
    { email: 'admin@admin.com', userId: '123e4567-e89b-42d3-a456-426614174002' },
  ];
  const identityPredicateResults = [];
  const guarded = (operation) => assert.ok(resourceDepth > 0, `${operation}_must_be_guarded`);
  const web = {
    async goto(url, options) {
      guarded('web_goto');
      assert.equal(options.waitUntil, 'domcontentloaded');
      currentUrl = url;
      order.push(`goto:${new URL(url).pathname}`);
      return { status: () => 200 };
    },
    async url() {
      guarded('web_url');
      return currentUrl;
    },
    locator(selector) {
      return {
        async fill() {
          guarded(`fill:${selector}`);
          order.push(`fill:${selector}`);
        },
      };
    },
    getByRole(_role, options) {
      return {
        async click() {
          guarded('web_submit');
          assert.equal(options.name, 'Sign in');
          currentUrl = 'https://www.aimatrx.com/dashboard';
          order.push('web-dashboard-submit');
        },
      };
    },
    async evaluate(callback) {
      guarded('web_identity_evaluate');
      assert.equal(new URL(currentUrl).pathname, '/api/whoami');
      assert.match(String(callback), /fetch\('\/api\/whoami'/);
      assert.match(String(callback), /credentials:\s*'include'/);
      assert.match(String(callback), /cache:\s*'no-store'/);
      assert.equal(signedIntoExtension, true, 'identity is read after extension sign-in');
      order.push('post-auth-web-identity-fetch');
      return identityCandidates[identityCandidateIndex++];
    },
    async close() {
      guarded('web_close');
      order.push('web-close');
    },
  };
  const context = {
    async newPage() {
      guarded('new_web_page');
      order.push('web-page-created');
      return web;
    },
  };
  const page = {
    context: () => context,
    async bringToFront() {
      guarded('panel_foreground');
      order.push('panel-foreground');
    },
  };
  const panel = {};
  const report = {
    stage: '',
    signin_observations: new Proxy(
      {},
      {
        set(target, key, value) {
          if (key === 'web_dashboard_reached' && value === true) order.push('dashboard-proof');
          return Reflect.set(target, key, value);
        },
      },
    ),
  };
  const signInAdminSettings = new Function(
    'assert',
    'activeTabPanelExpression',
    'click',
    'evaluate',
    'markBrowserAgentTraffic',
    'openSection',
    'waitFor',
    `${implementation}; return signInAdminSettings;`,
  )(
    assert,
    () => 'null',
    async (_target, selector, label) => {
      order.push(`panel-click:${selector}:${label}`);
      if (label === 'Sign in') {
        signedIntoExtension = true;
        order.push('extension-sign-in');
      }
    },
    async (target) => {
      assert.equal(target, panel);
      return signedIntoExtension
        ? { expected_admin_email: true, admin_role: true, sign_in_count: 0, sign_in_enabled: false }
        : {
            expected_admin_email: false,
            admin_role: false,
            sign_in_count: 1,
            sign_in_enabled: true,
          };
    },
    async () => order.push('traffic-marked'),
    async () => order.push('account-opened'),
    async (label, read, accept) => {
      if (label === 'd87_admin_web_identity') {
        assert.match(String(accept), /value\?\.email\?\.toLowerCase\(\) === 'admin@admin\.com'/);
        assert.match(String(accept), /value\?\.userId/);
        assert.match(String(accept), /\[0-9a-f\]\{8\}/);
        assert.match(String(accept), /\[0-9a-f\]\{12\}/);
      }
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const value = await read();
        const accepted = accept(value);
        if (label === 'd87_admin_web_identity') identityPredicateResults.push(accepted);
        if (accepted) return value;
        await Promise.resolve();
      }
      throw new Error(`${label}_not_observed`);
    },
  );
  const stage = (value) => {
    report.stage = value;
    order.push(`stage:${value}`);
  };
  const resourceAction = async (action) => {
    resourceDepth += 1;
    try {
      return await action();
    } finally {
      resourceDepth -= 1;
    }
  };
  const identity = await signInAdminSettings({
    page,
    panel,
    report,
    stage,
    resourceAction,
    captureIdentity: true,
    readCredentials: async () => ({ email: 'admin@admin.com', password: 'synthetic-only' }),
  });

  assert.deepEqual(identity, {
    email: 'admin@admin.com',
    userId: '123e4567-e89b-42d3-a456-426614174002',
  });
  assert.equal(report.signin_observations.web_dashboard_reached, true);
  assert.equal(report.signin_observations.web_identity_parked, true);
  const once = (event) => {
    const matches = order.flatMap((item, index) => (item === event ? [index] : []));
    assert.equal(matches.length, 1, `${event}_must_happen_once`);
    return matches[0];
  };
  const dashboard = once('dashboard-proof');
  const park = once('goto:/api/whoami');
  const extensionSignIn = once('extension-sign-in');
  const parkNavigation = once('stage:admin_web_identity_park_navigation');
  const parkResponse = once('stage:admin_web_identity_park_response');
  const parkStatus = once('stage:admin_web_identity_park_status');
  const parkRoute = once('stage:admin_web_identity_park_route');
  assert.ok(parkNavigation < park && park < parkResponse);
  assert.ok(parkResponse < parkStatus && parkStatus < parkRoute);
  assert.ok(parkRoute < extensionSignIn);
  const identityReads = order.flatMap((item, index) =>
    item === 'post-auth-web-identity-fetch' ? [index] : [],
  );
  const close = once('web-close');
  assert.deepEqual(identityPredicateResults, [false, false, true]);
  assert.equal(identityCandidateIndex, identityCandidates.length);
  assert.ok(dashboard < park, 'dashboard proof precedes parking');
  assert.ok(park < extensionSignIn, 'park precedes extension auth');
  assert.equal(identityReads.length, 3);
  assert.ok(extensionSignIn < identityReads[0], 'identity reads follow extension auth');
  assert.ok(identityReads[2] < close, 'tab closes only after identity proof');
  assert.equal(order.filter((item) => item === 'web-page-created').length, 1);
  assert.ok(once('panel-foreground') > close);
});

test('admin identity parking projects closed navigation failure categories without raw details', async () => {
  const source = await readFile(new URL('./admin-settings-signin.mjs', import.meta.url), 'utf8');
  const implementation = source
    .replace(/^import[\s\S]*?from '[^']+';\n/gm, '')
    .replace(/^export /gm, '');
  const cases = [
    ['timeout', Object.assign(new Error('private-token timeout'), { name: 'TimeoutError' })],
    [
      'interrupted',
      new Error(
        'Navigation to "https://private.invalid/token" is interrupted by another navigation to "https://private.invalid/secret"',
      ),
    ],
    ['aborted', new Error('page.goto: net::ERR_ABORTED at https://private.invalid/token')],
    ['target_closed', new Error('Target page, context or browser has been closed private-token')],
    ['network', new Error('page.goto: net::ERR_CONNECTION_RESET at https://private.invalid/token')],
    ['other', new Error('private-token unexpected failure')],
  ];
  for (const [category, original] of cases) {
    let currentUrl = 'about:blank';
    let closed = false;
    let foreground = false;
    let resourceDepth = 0;
    const guarded = () => assert.ok(resourceDepth > 0);
    const web = {
      async goto(url) {
        guarded();
        if (url.endsWith('/api/whoami')) throw original;
        currentUrl = url;
      },
      url() {
        guarded();
        return currentUrl;
      },
      locator() {
        return {
          async fill() {
            guarded();
          },
        };
      },
      getByRole() {
        return {
          async click() {
            guarded();
            currentUrl = 'https://www.aimatrx.com/dashboard';
          },
        };
      },
      async close() {
        guarded();
        closed = true;
      },
    };
    const page = {
      context: () => ({
        async newPage() {
          guarded();
          return web;
        },
      }),
      async bringToFront() {
        guarded();
        foreground = true;
      },
    };
    const report = { stage: '', signin_observations: {} };
    const signIn = new Function(
      'assert',
      'activeTabPanelExpression',
      'click',
      'evaluate',
      'markBrowserAgentTraffic',
      'openSection',
      'waitFor',
      `${implementation}; return signInAdminSettings;`,
    )(
      assert,
      () => 'null',
      () => assert.fail('extension auth must not start'),
      () => assert.fail('panel must not be read'),
      async () => {},
      async () => {},
      async (_label, read, accept) => {
        for (let attempt = 0; attempt < 20; attempt += 1) {
          const value = await read();
          if (accept(value)) return value;
          await Promise.resolve();
        }
        assert.fail('dashboard must be reached');
      },
    );
    await assert.rejects(
      signIn({
        page,
        panel: {},
        report,
        stage: (value) => {
          report.stage = value;
        },
        readCredentials: async () => ({ email: 'admin@admin.com', password: 'synthetic-private' }),
        resourceAction: async (action) => {
          resourceDepth += 1;
          try {
            return await action();
          } finally {
            resourceDepth -= 1;
          }
        },
      }),
      (error) => {
        assert.equal(error.message, `admin_web_identity_park_navigation_${category}_failed`);
        assert.equal(error.cause, undefined);
        assert.equal(error.message.includes('private'), false);
        return true;
      },
    );
    assert.equal(report.stage, 'admin_web_identity_park_navigation');
    assert.equal(report.signin_observations.web_dashboard_reached, true);
    assert.equal(report.signin_observations.web_identity_parked, undefined);
    assert.equal(JSON.stringify(report).includes('private'), false);
    assert.equal(closed, true);
    assert.equal(foreground, true);
  }
});

test('account popover member caller carries the approved fixture to authentication before role acceptance', async () => {
  const source = await readFile(
    new URL('./settings-account-popover-native.mjs', import.meta.url),
    'utf8',
  );
  const start = source.indexOf("      if (MODE !== 'guest') {");
  const end = source.indexOf('      const baseline =', start);
  assert.ok(start > 0 && end > start);
  const approvedFile = '/private/approved-organization.json';
  for (const role of ['member', 'admin', 'guest']) {
    const calls = [];
    const report = {};
    await runInNewContext(`(async () => { ${source.slice(start, end)} })()`, {
      MODE: role,
      page: {},
      panel: {},
      REPO: '/repo',
      assert,
      report,
      process: {
        env: {
          MATRX_REVIEWER_APPROVED_ORGANIZATION_FILE: approvedFile,
          MATRX_REVIEWER_MAGIC_LINK_FILE: '/private/link.json',
        },
      },
      signInSettings: async (options) => {
        calls.push(options);
        if (role === 'member') {
          assert.equal(
            options.memberApprovedOrganizationFile,
            approvedFile,
            'approved fixture context must reach signInSettings',
          );
          assert.equal(options.memberLinkFile, '/private/link.json');
          options.onAuthDiagnostic({ stage: 'member_organization_selection', matched: true });
        }
        return { extension_signed_in: true, canonical_nonadmin_check: { returned_rows: 0 } };
      },
      activatePanel: async () => calls.push('activate'),
    });
    assert.equal(calls.length, role === 'guest' ? 0 : 2);
    if (role === 'member') assert.equal(report.authentication_diagnostics[0].matched, true);
  }
  const preflightStart = source.indexOf("  if (MODE === 'member')");
  const preflightEnd = source.indexOf('  await runNativeSidepanelQa({', preflightStart);
  assert.ok(preflightStart > 0 && preflightEnd > preflightStart);
  assert.throws(
    () =>
      runInNewContext(source.slice(preflightStart, preflightEnd), {
        MODE: 'member',
        assert,
        process: { env: {} },
      }),
    /account_popover_member_approved_organization_required/,
  );
});

for (const [file, roleName, marker] of [
  ['settings-d87-native-acceptance.mjs', 'AUTH_MODE', "    stage = 'baseline';"],
  ['tab-groups-member-native-acceptance.mjs', null, '        report.authentication ='],
]) {
  test(`${file} real member call forwards approved organization context`, async () => {
    const source = await readFile(new URL(`./${file}`, import.meta.url), 'utf8');
    const start = source.indexOf('signInSettings({');
    const end = source.indexOf('})', start) + 2;
    assert.ok(start > 0 && end > start, marker);
    const calls = [];
    await runInNewContext(`(async()=>${source.slice(start, end)})()`, {
      [roleName ?? 'unused']: 'member',
      page: {},
      panel: {},
      REPO: '/repo',
      process: {
        env: {
          MATRX_REVIEWER_MAGIC_LINK_FILE: '/private/link.json',
          MATRX_REVIEWER_APPROVED_ORGANIZATION_FILE: '/private/approved.json',
        },
      },
      signInSettings: async (options) => {
        calls.push(options);
        assert.equal(options.memberApprovedOrganizationFile, '/private/approved.json');
        assert.equal(options.memberLinkFile, '/private/link.json');
        assert.equal(options.allowLadderOrganization, true);
      },
    });
    assert.equal(calls.length, 1);
  });
}

for (const [file, role, message] of [
  ['settings-d87-native-acceptance.mjs', 'AUTH_MODE', 'd87_member_approved_organization_required'],
  [
    'tab-groups-member-native-acceptance.mjs',
    null,
    'tab_groups_member_approved_organization_required',
  ],
]) {
  test(`${file} requires member context before browser/auth effects`, async () => {
    const source = await readFile(new URL(`./${file}`, import.meta.url), 'utf8');
    const line = source.split('\n').findIndex((value) => value.includes(message));
    assert.ok(line > 0);
    const lines = source.split('\n');
    const start = role
      ? lines.slice(0, line).findLastIndex((value) => value.includes("if (AUTH_MODE === 'member')"))
      : line - 2;
    const statement = lines.slice(start, line + 2).join('\n');
    assert.ok(source.indexOf(message) < source.indexOf('await runNativeSidepanelQa({'));
    assert.throws(
      () => runInNewContext(statement, { assert, AUTH_MODE: 'member', process: { env: {} } }),
      new RegExp(message),
    );
    if (role)
      for (const mode of ['admin', 'guest'])
        runInNewContext(statement, { assert, AUTH_MODE: mode, process: { env: {} } });
    runInNewContext(statement, {
      assert,
      AUTH_MODE: 'member',
      process: { env: { MATRX_REVIEWER_APPROVED_ORGANIZATION_FILE: '/private/approved.json' } },
    });
  });
}
