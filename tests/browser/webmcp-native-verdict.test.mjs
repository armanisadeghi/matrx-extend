import assert from 'node:assert/strict';
import test from 'node:test';
import {
  requireWebmcpBrowserPreflight,
  requireWebmcpNativeCases,
} from './webmcp-native-verdict.mjs';

test('unsupported Chrome and missing testing flag stop before native product verdict', () => {
  assert.equal(requireWebmcpBrowserPreflight(146, true), 'supported_native_browser');
  assert.equal(requireWebmcpBrowserPreflight(151, true), 'supported_native_browser');
  for (const major of [141, 145, 0, null]) {
    assert.throws(
      () => requireWebmcpBrowserPreflight(major, true),
      /webmcp_supported_chrome_required/,
    );
  }
  assert.throws(() => requireWebmcpBrowserPreflight(151, false), /webmcp_testing_flag_missing/);
});

const passing = () => ({
  api: {
    document_model_context: true,
    get_tools: true,
    execute_tool: true,
    register_tool: true,
  },
  fixture: { registered_once: true },
  discovery: { available: true, count_matches_native: true, fixture_present: true },
  invocation: { nonce_matches: true, count_one: true },
  negative: { unknown_refused: true, count_unchanged: true },
  extension_registration: { discovered_once: true, read_invoked: true },
});

test('native WebMCP verdict requires every independent observation', () => {
  assert.equal(requireWebmcpNativeCases(passing()), 'native_cases_passed');
  for (const [area, field] of [
    ['api', 'document_model_context'],
    ['fixture', 'registered_once'],
    ['discovery', 'fixture_present'],
    ['discovery', 'count_matches_native'],
    ['invocation', 'nonce_matches'],
    ['invocation', 'count_one'],
    ['negative', 'unknown_refused'],
    ['negative', 'count_unchanged'],
    ['extension_registration', 'discovered_once'],
    ['extension_registration', 'read_invoked'],
  ]) {
    const broken = passing();
    broken[area][field] = false;
    assert.throws(() => requireWebmcpNativeCases(broken), /webmcp_/);
  }
});

test('a constant success verdict cannot cover a missing native API or a skipped negative', () => {
  const absent = passing();
  absent.api.document_model_context = false;
  assert.throws(() => requireWebmcpNativeCases(absent), /webmcp_native_api_missing/);
  const skipped = passing();
  skipped.negative = {};
  assert.throws(() => requireWebmcpNativeCases(skipped), /webmcp_unknown_tool_not_refused/);
});
