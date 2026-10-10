import assert from 'node:assert/strict';

export function requireHostedScrapeRoute(acceptanceCase, mode, prepared) {
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
