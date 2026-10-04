import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scrapeLayoutFailure } from './scrape-layout-guard.mjs';

// Geometry captured in the 2026-10-04 native receipt cited by .research/scrape-layout-guard.json.
const baseline = {
  boundary: 'after_fast_capture',
  geometry: {
    viewportWidth: 360,
    document: { left: 0, scrollLeft: 0, scrollWidth: 391, clientWidth: 360 },
    resultTabs: { left: 12, right: 390.765625, width: 378.765625 },
  },
};

test('recorded Scrape overflow and later tab selection fail layout guard', () => {
  const later = {
    ...baseline,
    boundary: 'after_Links_tab',
    geometry: {
      ...baseline.geometry,
      document: { ...baseline.geometry.document, left: -31, scrollLeft: 31 },
    },
  };
  assert.match(scrapeLayoutFailure(baseline), /scrape_document_overflow 391\/360/);
  assert.match(scrapeLayoutFailure(later), /scrape_document_overflow 391\/360/);
  assert.match(
    scrapeLayoutFailure({
      ...later,
      geometry: {
        ...later.geometry,
        document: { ...later.geometry.document, scrollWidth: 360 },
        resultTabs: { ...later.geometry.resultTabs, left: 12, right: 348 },
      },
    }),
    /scrape_document_shifted 31\/-31/,
  );
});

test('contained six controls pass; missing and clipped controls fail', () => {
  const labels = ['Article', 'Images', 'Video', 'Links', 'SEO', 'Schema'];
  const contained = {
    boundary: 'after_Schema_tab',
    geometry: {
      ...baseline.geometry,
      document: { ...baseline.geometry.document, scrollWidth: 360, scrollLeft: 0, left: 0 },
      resultTabs: { ...baseline.geometry.resultTabs, right: 348, width: 336 },
      triggers: labels.map((label, index) => ({
        label,
        rect: { left: 12 + (index % 3) * 100, right: 92 + (index % 3) * 100, width: 80 },
      })),
    },
  };
  assert.equal(scrapeLayoutFailure(contained), null);
  assert.match(
    scrapeLayoutFailure({
      ...contained,
      geometry: { ...contained.geometry, triggers: contained.geometry.triggers.slice(0, 5) },
    }),
    /scrape_result_controls_missing/,
  );
  assert.match(
    scrapeLayoutFailure({
      ...contained,
      geometry: {
        ...contained.geometry,
        triggers: contained.geometry.triggers.map((trigger, index) =>
          index === 5 ? { ...trigger, rect: { ...trigger.rect, right: 391 } } : trigger,
        ),
      },
    }),
    /scrape_result_control_outside_viewport Schema/,
  );
  assert.match(
    scrapeLayoutFailure({
      ...contained,
      geometry: {
        ...contained.geometry,
        document: { ...contained.geometry.document, scrollLeft: 31, left: -31 },
      },
    }),
    /scrape_document_shifted/,
  );
});
