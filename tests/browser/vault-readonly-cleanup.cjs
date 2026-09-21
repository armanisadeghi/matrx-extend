'use strict';

const HASH = /^[a-f0-9]{64}$/;
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const bool = (value, key, expected = true) => object(value) && own(value, key) && value[key] === expected;
const integer = (value, key, expected) => object(value) && own(value, key) && Number.isInteger(value[key]) && value[key] === expected;
const positive = (value, key) => object(value) && own(value, key) && Number.isInteger(value[key]) && value[key] > 0;
const nonnegative = (value, key) => object(value) && own(value, key) && Number.isInteger(value[key]) && value[key] >= 0;

function zeroItemPosts(value) {
  const required = ['total', 'withIdempotencyHeader', 'missingIdempotencyHeader', 'invalidIdempotencyHeader'];
  return object(value)
    && Object.keys(value).length === required.length
    && required.every((key) => integer(value, key, 0));
}

function snapshotBefore(value) {
  return object(value)
    && bool(value, 'boundTargetAttached')
    && integer(value, 'boundTargetSessionCount', 1)
    && integer(value, 'boundTargetCountingSessionCount', 1)
    && positive(value, 'pageRequestCount')
    && positive(value, 'boundTargetRequestCount')
    && positive(value, 'boundTargetVaultRequestCount')
    && positive(value, 'boundTargetItemsAnyOriginCount')
    && positive(value, 'vaultMetadataReadRequests')
    && bool(value, 'enableSuccessBeforeResume')
    && bool(value, 'panelItemsReadRequestSeen')
    && bool(value, 'panelItemsReadResponse2xxSeen')
    && integer(value, 'vaultMutationRequests', 0)
    && bool(value, 'observerError', false)
    && bool(value, 'transportFatal', false)
    && value.sendFailureClass === 'none'
    && integer(value, 'pendingSetupCount', 0)
    && value.cleanupPhase === 'idle'
    && value.transportCloseStatus === 'open';
}

function snapshotAfter(value) {
  return object(value)
    && bool(value, 'boundTargetAttached', false)
    && integer(value, 'boundTargetSessionCount', 0)
    && integer(value, 'boundTargetCountingSessionCount', 0)
    && integer(value, 'remainingOwnedSessionCount', 0)
    && integer(value, 'pendingSetupCount', 0)
    && value.cleanupPhase === 'complete'
    && value.transportCloseStatus === 'closed'
    && bool(value, 'observerError', false)
    && bool(value, 'transportFatal', false)
    && value.sendFailureClass === 'none';
}

function hasObservedReadOnlyCleanup(proof) {
  if (!object(proof)
    || proof.schema !== 3
    || proof.mode !== 'read_only_admission'
    || proof.ok !== false
    || !bool(proof.admission, 'ok', false)
    || !bool(proof.checks, 'independentAdminIdentity')
    || typeof proof.baselineMetadataSha256 !== 'string'
    || !HASH.test(proof.baselineMetadataSha256)
    || !bool(proof.admission, 'baselineRead')
    || !bool(proof.admission, 'noFixtureWrites')
    || !integer(proof, 'vaultMutationRequests', 0)
    || !zeroItemPosts(proof.vaultItemPosts)
    || !Array.isArray(proof.ownedCreateMutationKeys) || proof.ownedCreateMutationKeys.length !== 0
    || !Array.isArray(proof.ownedFixtureIds) || proof.ownedFixtureIds.length !== 0
    || !bool(proof.cleanup, 'finalBaselineIdSetMatches')
    || !bool(proof.cleanup, 'finalBaselineMetadataMatches')
    || !integer(proof.cleanup, 'localAuthLogoutStatus', 204)
    || !bool(proof.cleanup, 'browserClosed')
    || !bool(proof.cleanup, 'profileRemoved')
    || !(proof.cleanup?.localFixtureServerClosed === true || proof.cleanup?.localFixtureServerClosed === 'not_started')
    || (own(proof, 'generator') && (!object(proof.generator) || !bool(proof.generator, 'ownedFixtureServersClosed')))
    || !bool(proof.networkJournal, 'ownerVerified')
    || proof.networkJournal?.journalSemanticVersion !== 2
    || !snapshotBefore(proof.networkJournal?.beforeCleanupSnapshot)
    || !snapshotAfter(proof.networkJournal?.postDisposalSnapshot)
    || !bool(proof.networkJournal, 'disposalSucceeded')) return false;
  return true;
}

exports.hasObservedReadOnlyCleanup = hasObservedReadOnlyCleanup;

// Retry admission only: this does not certify any unobserved Vault traffic.
function hasPreBaselineAuthenticatedCleanup(proof) {
  return object(proof)
    && proof.schema === 3 && proof.mode === 'read_only_admission'
    && bool(proof, 'ok', false) && bool(proof.admission, 'ok', false)
    && bool(proof, 'authenticationAttempted')
    && ['oauth_ui', 'oauth_sign_in'].includes(proof.failurePhase)
    && bool(proof.checks, 'independentAdminIdentity')
    && proof.identityProof?.extensionProfileEmail === 'admin@admin.com'
    && bool(proof.identityProof, 'independentUserIdMatchesProfile')
    && bool(proof.authStorage, 'profilePresent') && bool(proof.authStorage, 'accessTokenPresent')
    && !own(proof, 'baselineMetadataSha256') && !own(proof.admission, 'baselineRead')
    && integer(proof.admission, 'fixtureWrites', 0) && bool(proof.admission, 'noFixtureWrites')
    && integer(proof, 'vaultMutationRequests', 0) && zeroItemPosts(proof.vaultItemPosts)
    && Array.isArray(proof.ownedCreateMutationKeys) && proof.ownedCreateMutationKeys.length === 0
    && Array.isArray(proof.ownedFixtureIds) && proof.ownedFixtureIds.length === 0
    && object(proof.cleanup)
    && !own(proof.cleanup, 'finalBaselineIdSetMatches') && !own(proof.cleanup, 'finalBaselineMetadataMatches')
    && proof.cleanup.localFixtureServerClosed === 'not_started'
    && integer(proof.cleanup, 'localAuthLogoutStatus', 204)
    && integer(proof.cleanup, 'remoteAuthRevocationStatus', 204)
    && bool(proof.cleanup, 'browserClosed') && bool(proof.cleanup, 'profileRemoved')
    && proof.cleanup.localCredentialDisposal === 'profile_removed';
}
exports.hasPreBaselineAuthenticatedCleanup = hasPreBaselineAuthenticatedCleanup;

const PRE_AUTH_OAUTH_STATES = {
  oauth_popup_navigation: { failureCategory: 'oauth_popup_navigation_failed', popupNavigated: false, popupSignInClicked: false },
  oauth_popup_sign_in_click: { failureCategory: 'oauth_popup_sign_in_click_failed', popupNavigated: true, popupSignInClicked: false },
  oauth_auth_page_opened: { failureCategory: 'oauth_auth_page_open_failed', popupNavigated: true, popupSignInClicked: true },
};

function preAuthSnapshotBefore(value) {
  return object(value)
    && bool(value, 'boundTargetAttached', false)
    && integer(value, 'boundTargetSessionCount', 0)
    && integer(value, 'boundTargetCountingSessionCount', 0)
    && integer(value, 'boundTargetRequestCount', 0)
    && integer(value, 'boundTargetVaultRequestCount', 0)
    && integer(value, 'boundTargetItemsAnyOriginCount', 0)
    && integer(value, 'vaultMetadataReadRequests', 0)
    && positive(value, 'pageRequestCount')
    && bool(value, 'enableSuccessBeforeResume')
    && bool(value, 'panelItemsReadRequestSeen', false)
    && bool(value, 'panelItemsReadResponse2xxSeen', false)
    && integer(value, 'vaultMutationRequests', 0)
    && bool(value, 'observerError', false)
    && bool(value, 'transportFatal', false)
    && value.sendFailureClass === 'none'
    && integer(value, 'pendingSetupCount', 0)
    && value.cleanupPhase === 'idle'
    && value.transportCloseStatus === 'open'
    && nonnegative(value, 'remainingOwnedSessionCount');
}

// Retry admission only. This proves a pre-form OAuth failure left no bearer,
// Vault state, or owned resource; it does not claim complete panel coverage.
function hasPreAuthNoWriteCleanup(proof) {
  const oauthState = object(proof) ? PRE_AUTH_OAUTH_STATES[proof.failurePhase] : undefined;
  const admissionClear = object(proof) && (!own(proof, 'admission') || (object(proof.admission)
    && (!own(proof.admission, 'baselineRead') || proof.admission.baselineRead === false)
    && (!own(proof.admission, 'fixtureWrites') || integer(proof.admission, 'fixtureWrites', 0))));
  const identityAbsent = object(proof) && object(proof.checks)
    && (!own(proof.checks, 'independentAdminIdentity') || proof.checks.independentAdminIdentity === false);
  return object(proof)
    && proof.schema === 3
    && ['read_only_admission', 'receipt_backed_save_update'].includes(proof.mode)
    && proof.ok === false
    && bool(proof, 'authenticationAttempted', false)
    && oauthState !== undefined
    && bool(proof.oauthUi, 'popupNavigated', oauthState.popupNavigated)
    && bool(proof.oauthUi, 'popupSignInClicked', oauthState.popupSignInClicked)
    && bool(proof.oauthUi, 'authPageOpened', false)
    && bool(proof.oauthUi, 'expectedOrigin', false)
    && bool(proof.oauthUi, 'loginFieldsReady', false)
    && proof.oauthUi.failureCategory === oauthState.failureCategory
    && !own(proof, 'authStorage') && !own(proof, 'authTransport') && !own(proof, 'identityProof')
    && identityAbsent && admissionClear
    && !own(proof, 'baselineMetadataSha256') && !own(proof, 'baselineItems')
    && !own(proof, 'authenticator') && !own(proof, 'authenticatorJournal')
    && !own(proof.checks, 'enrolledAuthenticatorPreserved') && !own(proof.cleanup, 'authenticator')
    && !own(proof, 'apiResponses')
    && integer(proof, 'vaultMutationRequests', 0) && zeroItemPosts(proof.vaultItemPosts)
    && Array.isArray(proof.ownedCreateMutationKeys) && proof.ownedCreateMutationKeys.length === 0
    && Array.isArray(proof.ownedFixtureIds) && proof.ownedFixtureIds.length === 0
    && object(proof.cleanup)
    && bool(proof.cleanup.authStorageAtCleanup, 'profilePresent', false)
    && bool(proof.cleanup.authStorageAtCleanup, 'accessTokenPresent', false)
    && proof.cleanup.remoteAuthRevocation === 'not_applicable'
    && proof.cleanup.localFixtureServerClosed === 'not_started'
    && bool(proof.cleanup, 'browserClosed') && bool(proof.cleanup, 'profileRemoved')
    && proof.cleanup.localCredentialDisposal === 'profile_removed'
    && !own(proof.cleanup, 'localAuthLogoutStatus') && !own(proof.cleanup, 'remoteAuthRevocationStatus')
    && bool(proof.networkJournal, 'ownerVerified') && proof.networkJournal?.journalSemanticVersion === 2
    && preAuthSnapshotBefore(proof.networkJournal?.beforeCleanupSnapshot)
    && snapshotAfter(proof.networkJournal?.postDisposalSnapshot)
    && integer(proof.networkJournal?.postDisposalSnapshot, 'vaultMutationRequests', 0)
    && integer(proof.networkJournal?.postDisposalSnapshot, 'boundTargetVaultRequestCount', 0)
    && bool(proof.networkJournal, 'disposalSucceeded');
}
exports.hasPreAuthNoWriteCleanup = hasPreAuthNoWriteCleanup;
