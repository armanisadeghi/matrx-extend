import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { guestSettingsChecks, guestSettingsState } from './settings-panel-driver.mjs';

// A signed-out operator opens Settings to inspect the device account and
// organization controls. These counts match the source-rendered guest view.
const guest = {
  active: true,
  accessTokenPresent: false,
  profilePresent: false,
  organizationChoicePresent: false,
  accountSectionCount: 1,
  accountOpen: true,
  emailRowCount: 1,
  emailUnavailable: true,
  nameRowCount: 0,
  roleRowCount: 0,
  footerSignInCount: 1,
  footerSignOutCount: 0,
  organizationSectionCount: 1,
  organizationOpen: true,
  signInToChooseCount: 1,
  archiveFilterCount: 0,
  actingAsRowCount: 0,
  archivedMarkerCount: 0,
  restorationActionCount: 0,
  archivedCopyPresent: false,
};

test('native Settings observation reads the active panel and drops account content', async () => {
  const window = new Window();
  window.chrome = { storage: { local: { get: async () => ({}) } } };
  window.document.body.innerHTML = `
    <button role="tab" data-state="active" title="Settings" aria-controls="settings"></button>
    <div id="settings" role="tabpanel" data-state="active">
      <button aria-expanded="true" aria-controls="account">Account</button>
      <div id="account"><div class="flex items-center justify-between"><span>Email</span><div>—</div></div></div>
      <button aria-expanded="true" aria-controls="organization">Organization</button>
      <div id="organization"><div class="flex items-center justify-between"><span>Organization</span><div>Sign in to choose</div></div></div>
      <button>Sign in</button>
    </div>`;
  const panel = {
    send: async (_method, { expression }) => ({ result: { value: await window.eval(expression) } }),
  };
  const observed = await guestSettingsState(panel);
  assert.deepEqual(guestSettingsChecks(observed, 0), {
    signedOut: true,
    account: true,
    organization: true,
    archivedManagement: true,
  });
  window.document
    .querySelector('#account')
    .insertAdjacentHTML(
      'beforeend',
      '<div class="flex items-center justify-between"><span>Name</span><div>Existing member</div></div>',
    );
  assert.equal(guestSettingsChecks(await guestSettingsState(panel), 0).account, false);
  window.document
    .querySelector('#organization')
    .insertAdjacentHTML(
      'beforeend',
      '<a>Open Organizations to restore an archived organization</a>',
    );
  assert.equal(guestSettingsChecks(await guestSettingsState(panel), 0).archivedManagement, false);
  window.happyDOM.abort();
});

test('guest account and organization verdicts require the signed-out native view', () => {
  assert.deepEqual(guestSettingsChecks(guest, 0), {
    signedOut: true,
    account: true,
    organization: true,
    archivedManagement: true,
  });
  for (const changed of [
    { emailUnavailable: false },
    { footerSignInCount: 0 },
    { footerSignOutCount: 1 },
    { active: false },
    { accessTokenPresent: true },
    { profilePresent: true },
    { organizationChoicePresent: true },
  ]) {
    const result = guestSettingsChecks({ ...guest, ...changed }, 0);
    assert.deepEqual(result, {
      signedOut: false,
      account: false,
      organization: false,
      archivedManagement: false,
    });
  }
});

test('each guest control rejects its own visible or network regression', () => {
  for (const changed of [{ nameRowCount: 1 }, { roleRowCount: 1 }, { accountOpen: false }]) {
    assert.equal(guestSettingsChecks({ ...guest, ...changed }, 0).account, false);
  }
  for (const changed of [
    { archiveFilterCount: 1 },
    { actingAsRowCount: 1 },
    { signInToChooseCount: 0 },
    { organizationOpen: false },
  ]) {
    assert.equal(guestSettingsChecks({ ...guest, ...changed }, 0).organization, false);
  }
  assert.equal(guestSettingsChecks(guest, 1).organization, false);
  assert.equal(guestSettingsChecks(guest, 0).organization, true);
  for (const changed of [
    { archivedMarkerCount: 1 },
    { restorationActionCount: 1 },
    { archivedCopyPresent: true },
  ]) {
    assert.equal(guestSettingsChecks({ ...guest, ...changed }, 0).archivedManagement, false);
  }
});
