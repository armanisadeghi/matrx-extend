import assert from 'node:assert/strict';

export function hostedScrapeReloadDiagnostic(acceptanceCase, value = '0') {
  assert.ok(value === '0' || value === '1', 'scrape_reload_diagnostic_flag_invalid');
  if (value === '1')
    assert.ok(
      ['guest-scrape-development', 'member-data'].includes(acceptanceCase),
      'scrape_reload_diagnostic_requires_development_scrape_or_member_data',
    );
  return value;
}
