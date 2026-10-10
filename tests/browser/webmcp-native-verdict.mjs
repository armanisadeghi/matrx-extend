import assert from 'node:assert/strict';

// The extension itself treats Chrome older than 146 as lacking WebMCP.
// Refuse those browsers before attributing any native absence to the product.
export function requireWebmcpBrowserPreflight(major, testingFlag) {
  assert.equal(testingFlag, true, 'webmcp_testing_flag_missing');
  assert.ok(Number.isSafeInteger(major) && major >= 146, 'webmcp_supported_chrome_required');
  return 'supported_native_browser';
}

// Only bounded booleans and counts leave the owned browser. Never retain a
// native catalog, tool output, tab list, URL, or credential in the receipt.
export function requireWebmcpNativeCases(cases) {
  assert.equal(cases?.api?.document_model_context, true, 'webmcp_native_api_missing');
  assert.equal(cases.api.get_tools, true, 'webmcp_native_get_tools_missing');
  assert.equal(cases.api.execute_tool, true, 'webmcp_native_execute_tool_missing');
  assert.equal(cases.api.register_tool, true, 'webmcp_native_register_tool_missing');
  assert.equal(cases.fixture?.registered_once, true, 'webmcp_fixture_registration_missing');
  assert.equal(cases.discovery?.available, true, 'webmcp_discovery_unavailable');
  assert.equal(cases.discovery?.count_matches_native, true, 'webmcp_discovery_count_mismatch');
  assert.equal(cases.discovery?.fixture_present, true, 'webmcp_fixture_discovery_missing');
  assert.equal(cases.invocation?.nonce_matches, true, 'webmcp_invocation_nonce_mismatch');
  assert.equal(cases.invocation?.count_one, true, 'webmcp_invocation_side_effect_missing');
  assert.equal(cases.negative?.unknown_refused, true, 'webmcp_unknown_tool_not_refused');
  assert.equal(cases.negative?.count_unchanged, true, 'webmcp_unknown_tool_side_effect');
  assert.equal(
    cases.extension_registration?.discovered_once,
    true,
    'webmcp_extension_registration_missing',
  );
  assert.equal(
    cases.extension_registration?.read_invoked,
    true,
    'webmcp_extension_read_invocation_missing',
  );
  return 'native_cases_passed';
}
