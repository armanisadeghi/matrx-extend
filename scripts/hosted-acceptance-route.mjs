import assert from 'node:assert/strict';
import { requireHostedScrapeRoute } from './hosted-scrape-route.mjs';

const HOSTED_ACCEPTANCE_CASES = new Set([
  'guest-chat',
  'guest-seo',
  'guest-data',
  'member-data',
  'guest-scrape',
  'guest-scrape-development',
  'scrape-error-recovery-guest',
  'scrape-save-member',
  'tab-groups-member',
  'native-ai-member-probe',
  'settings-controls',
  'settings-theme-rendering',
  'settings-auto-scrape-capture',
  'settings-persistence',
  'settings-persistence-admin',
  'settings-persistence-member',
  'desktop-settings-guest',
  'desktop-settings-member',
  'desktop-settings-admin',
  'visibility-census-guest',
  'visibility-census-member',
  'visibility-census-admin',
  'audit-key-admin',
  'member-chat',
  'prepare-stale-results',
  'showcase-picker-admin',
  'showcase-stale-admin',
  'showcase-d47-admin',
  'showcase-d47-public-admin',
  'records-readonly-admin',
  'profile-admin',
  'profile-member',
]);

/** Resolve the exact case and its native driver before the acceptance run proceeds. */
export function hostedAcceptanceRoute(acceptanceCase, mode, prepared, authMode) {
  assert.ok(HOSTED_ACCEPTANCE_CASES.has(acceptanceCase), 'unknown_hosted_acceptance_case');
  return {
    acceptanceCase,
    scrapeRoute: requireHostedScrapeRoute(acceptanceCase, mode, prepared, authMode),
  };
}
