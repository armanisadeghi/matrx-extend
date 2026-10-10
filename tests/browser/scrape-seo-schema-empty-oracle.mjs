import assert from 'node:assert/strict';
import { assertCaptureExportUnchanged } from './scrape-tab-coverage.mjs';

const optionalSeoGroups = [
  'Social preview',
  'International',
  'Structured data',
  'Headings',
  'Links',
  'Images',
  'Readability',
];

/** The live owned-page result must show truthful no-signal SEO and empty schema. */
export function assertGuestSeoSchemaEmptyObservation({ expectedTitle, seo, schema, exports }) {
  assert.equal(seo?.visible, true, 'scrape_empty_seo_pane_not_visible');
  assert.equal(seo.selected, 'SEO', 'scrape_empty_seo_wrong_pane_selected');
  assert.equal(seo.titleValue, expectedTitle, 'scrape_empty_seo_title_missing');
  assert.equal(seo.descriptionValue, '—', 'scrape_empty_seo_description_not_empty');
  assert.ok(Array.isArray(seo.groups), 'scrape_empty_seo_groups_unobserved');
  assert.ok(seo.groups.includes('Title & description'), 'scrape_empty_seo_baseline_missing');
  for (const group of seo.groups)
    assert.ok(
      ['Title & description', 'Performance'].includes(group),
      `scrape_empty_seo_unexpected_group_${String(group).toLowerCase().replaceAll(' ', '_')}`,
    );
  for (const group of optionalSeoGroups)
    assert.ok(
      !seo.groups.includes(group),
      `scrape_empty_seo_unexpected_${group.toLowerCase().replaceAll(' ', '_')}`,
    );

  assert.equal(schema?.visible, true, 'scrape_empty_schema_pane_not_visible');
  assert.equal(schema.selected, 'Schema', 'scrape_empty_schema_wrong_pane_selected');
  assert.equal(schema.jsonValid, true, 'scrape_empty_schema_json_invalid');
  assert.equal(schema.metadataTitle, expectedTitle, 'scrape_empty_schema_title_missing');
  assert.equal(schema.descriptionAbsent, true, 'scrape_empty_schema_description_present');
  assert.equal(schema.canonicalAbsent, true, 'scrape_empty_schema_canonical_present');
  assert.equal(schema.ogCount, 0, 'scrape_empty_schema_og_present');
  assert.equal(schema.twitterCount, 0, 'scrape_empty_schema_twitter_present');
  assert.equal(schema.schemaTypesCount, 0, 'scrape_empty_schema_type_present');
  assert.equal(schema.ldJsonCount, 0, 'scrape_empty_schema_ld_json_present');
  assert.ok(Array.isArray(exports) && exports.length === 3, 'scrape_empty_schema_exports_missing');
  const baseline = exports[0];
  assert.ok(baseline?.identity && baseline?.digest, 'scrape_empty_schema_export_baseline_missing');
  for (const [index, result] of exports.slice(1).entries())
    assertCaptureExportUnchanged(baseline, result, `empty_seo_schema_${index + 1}`);
  return {
    seo_no_signal_baseline: true,
    schema_empty: true,
    capture_export_unchanged_after_each_pane: true,
  };
}
