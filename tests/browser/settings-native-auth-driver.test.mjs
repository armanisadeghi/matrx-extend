import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
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
});
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
  test(`member auth reaches credential validation with stage observer present=${observerPresent}`, async () => {
    const operations = [];
    const stages = [];
    const page = {
      context: () => ({ newPage: async () => ({ close: async () => operations.push('closed') }) }),
      bringToFront: async () => operations.push('root_activated'),
    };
    await assert.rejects(
      signInSettings({
        mode: 'member',
        page,
        panel: {},
        repo: '.',
        ...(observerPresent && { onStage: (stage) => stages.push(stage) }),
      }),
      (error) =>
        error?.message === 'member_auth_boundary_failed' &&
        error.memberAuthBoundary === 'member_credential_validation' &&
        error.memberAuthFailureCode === 'd87_member_link_file_required',
    );
    assert.deepEqual(operations, ['closed', 'root_activated']);
    assert.deepEqual(stages, observerPresent ? ['member_credential_validation'] : []);
  });
}
