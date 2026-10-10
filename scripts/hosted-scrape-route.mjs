import assert from 'node:assert/strict';

export function requireHostedScrapeRoute(acceptanceCase, mode, prepared, authMode = undefined) {
  if (acceptanceCase === 'scrape-error-recovery-guest') {
    assert.equal(mode, 'development', 'scrape_recovery_development_mode_required');
    assert.equal(prepared?.kind, 'ci_development_test', 'scrape_recovery_ci_receipt_required');
    assert.equal(prepared?.eligibleStore, false, 'scrape_recovery_development_store_refused');
    assert.equal(authMode, 'guest', 'scrape_recovery_guest_auth_required');
    return {
      driver: 'tests/browser/scrape-error-recovery-guest.mjs',
      channel: 'development',
    };
  }
  if (acceptanceCase === 'scrape-save-member') {
    assert.equal(mode, 'development', 'scrape_save_development_mode_required');
    assert.equal(prepared?.kind, 'ci_development_test', 'scrape_save_development_receipt_required');
    assert.equal(prepared?.eligibleStore, false, 'scrape_save_development_store_refused');
    return {
      driver: 'tests/browser/scrape-save-native-acceptance.mjs',
      channel: 'development',
    };
  }
  if (acceptanceCase === 'guest-scrape-development') {
    assert.equal(mode, 'development', 'scrape_development_mode_required');
    assert.equal(prepared?.kind, 'ci_development_test', 'scrape_development_receipt_required');
    assert.equal(prepared?.eligibleStore, false, 'scrape_development_store_refused');
    return { driver: 'tests/browser/scrape-guest-native-acceptance.mjs', channel: 'development' };
  }
  if (acceptanceCase === 'guest-scrape') {
    assert.equal(mode, 'release', 'scrape_store_mode_required');
    assert.equal(prepared?.kind, 'published_store_zip_adapted', 'scrape_store_receipt_required');
    return { driver: 'tests/browser/scrape-guest-native-acceptance.mjs', channel: 'store' };
  }
  return null;
}

export function hostedScrapeSaveDestination(acceptanceCase, value = 'project') {
  assert.equal(acceptanceCase, 'scrape-save-member', 'scrape_save_destination_case_refused');
  assert.ok(value === 'project' || value === 'none', 'scrape_save_destination_invalid');
  return value;
}

export function verifyHostedScrapeSaveAssociations(mode, edges, projectId, organizationId) {
  assert.ok(Array.isArray(edges), 'scrape_save_association_lookup_body_invalid');
  if (mode === 'none') {
    assert.equal(edges.length, 0, 'scrape_save_unselected_association_persisted');
    return 'none';
  }
  assert.equal(mode, 'project', 'scrape_save_destination_invalid');
  const edge = edges.find((item) => item.other_id === projectId && item.other_type === 'project');
  assert.ok(edge, 'scrape_save_selected_project_edge_missing');
  assert.equal(edge.organization_id, organizationId, 'scrape_save_edge_organization_mismatch');
  return 'project';
}
