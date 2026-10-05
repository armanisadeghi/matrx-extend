import assert from 'node:assert/strict';
import {
  panelIdentity,
  selectRequiredSettingsOrganization,
} from './settings-native-auth-driver.mjs';
import {
  createShowcaseOrganizationDiagnostic,
  observeShowcaseOrganization,
  stageShowcaseOrganization,
} from './showcase-organization-diagnostic.mjs';

export async function runShowcaseOrganizationCheckpoint({ panel, auth, resourceAction, report }) {
  report.organization_diagnostic = createShowcaseOrganizationDiagnostic();
  const diagnostic = report.organization_diagnostic;
  assert.equal(auth.admin_role, true, 'showcase_admin_role_unverified');
  observeShowcaseOrganization(diagnostic, { admin_role_verified: true });
  const organization = await resourceAction(() =>
    selectRequiredSettingsOrganization({
      panel,
      mode: 'admin',
      email: auth.email,
      profileId: auth.profileId,
      onStage: (value) => stageShowcaseOrganization(diagnostic, value),
      onObservation: (value) => observeShowcaseOrganization(diagnostic, value),
    }),
  );
  stageShowcaseOrganization(diagnostic, 'organization_identity_read');
  const identity = await panelIdentity(panel);
  stageShowcaseOrganization(diagnostic, 'organization_identity_compare');
  assert.equal(identity.profileId, auth.profileId, 'showcase_profile_changed');
  assert.equal(
    identity.organizationId,
    organization.organizationId,
    'showcase_organization_changed',
  );
  return organization;
}
