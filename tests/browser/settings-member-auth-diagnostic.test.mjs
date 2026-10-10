import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  memberAuthFailureReport,
  observeMemberExtensionIdentity,
} from './settings-member-auth-diagnostic.mjs';

test('member Settings token observation keeps a fixed stage and code on failure', async () => {
  const transitions = [];
  let diagnostic;
  await assert.rejects(
    observeMemberExtensionIdentity({
      onStage: (stage) => transitions.push(stage),
      clickSignIn: async () => {
        transitions.push('sign_in_clicked');
      },
      openOrganization: async () => {
        transitions.push('organization_opened');
      },
      waitForIdentity: async () => {
        // Model the real waitFor timeout: the diagnostic suffix may contain page state.
        throw new Error(
          'd87_extension_identity_not_observed:{"accessToken":"private-token","url":"private-url"}',
        );
      },
    }),
    (error) => {
      diagnostic = memberAuthFailureReport(error, 'member_extension_token_observation');
      return error.message === 'member_auth_boundary_failed';
    },
  );
  assert.deepEqual(transitions, [
    'member_extension_token_observation',
    'sign_in_clicked',
    'organization_opened',
  ]);
  assert.deepEqual(diagnostic, {
    stage: 'member_extension_token_observation',
    code: 'd87_extension_identity_not_observed',
  });
  assert.equal(JSON.stringify(diagnostic).includes('private-'), false);
});

test('member Settings authentication continues through successful boundaries', async () => {
  const visited = [];
  const result = await observeMemberExtensionIdentity({
    onStage: (stage) => visited.push(stage),
    clickSignIn: async () => visited.push('sign_in_clicked'),
    openOrganization: async () => visited.push('organization_opened'),
    waitForIdentity: async () => ({ identity_observed: true }),
  });
  assert.deepEqual(visited, [
    'member_extension_token_observation',
    'sign_in_clicked',
    'organization_opened',
  ]);
  assert.deepEqual(result, { identity_observed: true });
});
