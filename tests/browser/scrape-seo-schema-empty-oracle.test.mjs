import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Window } from 'happy-dom';
import { tabStateExpression } from './scrape-seo-schema-empty-observation.mjs';
import { assertGuestSeoSchemaEmptyObservation } from './scrape-seo-schema-empty-oracle.mjs';

function observation(title, overrides = {}) {
  return {
    expectedTitle: title,
    seo: {
      visible: true,
      selected: 'SEO',
      titleValue: title,
      descriptionValue: '—',
      groups: ['Title & description'],
      ...overrides.seo,
    },
    schema: {
      visible: true,
      selected: 'Schema',
      jsonValid: true,
      metadataTitle: title,
      descriptionAbsent: true,
      canonicalAbsent: true,
      ogCount: 0,
      twitterCount: 0,
      schemaTypesCount: 0,
      ldJsonCount: 0,
      ...overrides.schema,
    },
    exports: overrides.exports ?? [
      { identity: 'capture-1', digest: 'same-digest' },
      { identity: 'capture-1', digest: 'same-digest' },
      { identity: 'capture-1', digest: 'same-digest' },
    ],
  };
}

test('T08 guest no-signal SEO and empty schema pass for distinct controlled page titles', () => {
  for (const title of ['Harbor Dental appointment information', 'Harbor Dental referral guidance'])
    assert.deepEqual(assertGuestSeoSchemaEmptyObservation(observation(title)), {
      seo_no_signal_baseline: true,
      schema_empty: true,
      capture_export_unchanged_after_each_pane: true,
    });
});

test('T08 rejects a populated SEO section, wrong pane, or substituted title', () => {
  assert.throws(
    () =>
      assertGuestSeoSchemaEmptyObservation(
        observation('Harbor Dental appointment information', {
          seo: { groups: ['Title & description', 'Structured data'] },
        }),
      ),
    /scrape_empty_seo_unexpected_group_structured_data/,
  );
  assert.throws(
    () =>
      assertGuestSeoSchemaEmptyObservation(
        observation('Harbor Dental appointment information', {
          seo: { selected: 'Article' },
        }),
      ),
    /scrape_empty_seo_wrong_pane_selected/,
  );
  assert.throws(
    () =>
      assertGuestSeoSchemaEmptyObservation(
        observation('Harbor Dental appointment information', {
          seo: { groups: ['Title & description', 'Unexpected signal'] },
        }),
      ),
    /scrape_empty_seo_unexpected_group_unexpected_signal/,
  );
  assert.throws(
    () =>
      assertGuestSeoSchemaEmptyObservation(
        observation('Harbor Dental appointment information', {
          schema: { metadataTitle: 'Harbor Dental referral guidance' },
        }),
      ),
    /scrape_empty_schema_title_missing/,
  );
});

test('T08 permits only the real navigation Performance baseline alongside no-signal SEO', () => {
  const title = 'Harbor Dental appointment information';
  assert.equal(
    assertGuestSeoSchemaEmptyObservation(
      observation(title, { seo: { groups: ['Title & description', 'Performance'] } }),
    ).seo_no_signal_baseline,
    true,
  );
});

test('T08 rejects nonempty schema and capture/export mutation after pane selection', () => {
  const title = 'Harbor Dental appointment information';
  assert.throws(
    () => assertGuestSeoSchemaEmptyObservation(observation(title, { schema: { ldJsonCount: 1 } })),
    /scrape_empty_schema_ld_json_present/,
  );
  assert.throws(
    () =>
      assertGuestSeoSchemaEmptyObservation(
        observation(title, {
          exports: [
            { identity: 'capture-1', digest: 'same-digest' },
            { identity: 'capture-2', digest: 'changed-digest' },
            { identity: 'capture-1', digest: 'same-digest' },
          ],
        }),
      ),
    /scrape_empty_seo_schema_1_capture_identity_changed/,
  );
});

function renderPane(label, title, schema = undefined, seoGroups = ['Title & description']) {
  const window = new Window();
  const schemaData = schema ?? {
    metadata: {
      title,
      description: null,
      canonical: null,
      og: {},
      twitter: {},
      schemaTypes: [],
    },
    ld_json: [],
  };
  window.document.body.innerHTML = `
    <button role="tab" title="Scrape" data-state="active" aria-controls="scrape-panel"></button>
    <div id="scrape-panel" role="tabpanel" data-state="active">
      <div role="tablist"><button role="tab" aria-selected="true" aria-controls="result-pane">${label}</button></div>
      <div id="result-pane" data-state="active">
        ${
          label === 'SEO'
            ? `<div class="space-y-1.5"><div class="flex items-baseline justify-between gap-2 px-1"><span>Title &amp; description</span></div>
              <div><div class="flex items-baseline justify-between gap-3"><span>Title</span><div><span>${title}</span></div></div>
              <div class="flex items-baseline justify-between gap-3"><span>Description</span><div><span>—</span></div></div></div>
              ${seoGroups
                .filter((group) => group !== 'Title & description')
                .map(
                  (group) =>
                    `<div class="space-y-1.5"><div class="flex items-baseline justify-between gap-2 px-1"><span>${group}</span></div><div>Signal</div></div>`,
                )
                .join('')}
            </div>`
            : `<pre>${JSON.stringify(schemaData)}</pre>`
        }
      </div>
    </div>`;
  window.document.getElementById('result-pane').getBoundingClientRect = () => ({ height: 100 });
  return window;
}

function readPane(window, label) {
  return new Function('document', `return ${tabStateExpression(label)}`)(window.document);
}

const sameExports = [
  { identity: 'captured-at-1', digest: 'full-capture-digest' },
  { identity: 'captured-at-1', digest: 'full-capture-digest' },
  { identity: 'captured-at-1', digest: 'full-capture-digest' },
];

test('the native driver DOM expression feeds its actual SEO and Schema shape into the oracle', () => {
  const title = 'Harbor Dental appointment information';
  const seoWindow = renderPane('SEO', title, undefined, ['Title & description', 'Performance']);
  const schemaWindow = renderPane('Schema', title);
  try {
    const result = assertGuestSeoSchemaEmptyObservation({
      expectedTitle: title,
      seo: readPane(seoWindow, 'SEO'),
      schema: readPane(schemaWindow, 'Schema'),
      exports: sameExports,
    });
    assert.equal(result.seo_no_signal_baseline, true);
    assert.equal(result.schema_empty, true);
  } finally {
    seoWindow.happyDOM.abort();
    schemaWindow.happyDOM.abort();
  }
});

test('driver DOM extraction and oracle reject each nonempty metadata signal', () => {
  const title = 'Harbor Dental appointment information';
  const seoWindow = renderPane('SEO', title);
  const mutations = [
    ['invalid JSON', null, [], /scrape_empty_schema_json_invalid/],
    [
      'metadata title',
      { title: 'Harbor Dental referral guidance' },
      [],
      /scrape_empty_schema_title_missing/,
    ],
    [
      'description',
      { description: 'Appointment details' },
      [],
      /scrape_empty_schema_description_present/,
    ],
    [
      'canonical',
      { canonical: 'https://clinic.test/appointments' },
      [],
      /scrape_empty_schema_canonical_present/,
    ],
    [
      'Open Graph',
      { og: { 'og:title': 'Appointment details' } },
      [],
      /scrape_empty_schema_og_present/,
    ],
    [
      'Twitter',
      { twitter: { 'twitter:title': 'Appointment details' } },
      [],
      /scrape_empty_schema_twitter_present/,
    ],
    ['schema type', { schemaTypes: ['Dentist'] }, [], /scrape_empty_schema_type_present/],
    ['JSON-LD', {}, [{ '@type': 'Dentist' }], /scrape_empty_schema_ld_json_present/],
  ];
  try {
    const seo = readPane(seoWindow, 'SEO');
    for (const [label, fields, ldJson, expectedError] of mutations) {
      const metadata = {
        title,
        description: null,
        canonical: null,
        og: {},
        twitter: {},
        schemaTypes: [],
        ...fields,
      };
      const schemaWindow =
        label === 'invalid JSON'
          ? renderPane('Schema', title, undefined)
          : renderPane('Schema', title, { metadata, ld_json: ldJson });
      try {
        if (label === 'invalid JSON')
          schemaWindow.document.querySelector('pre').textContent = '{malformed';
        assert.throws(
          () =>
            assertGuestSeoSchemaEmptyObservation({
              expectedTitle: title,
              seo,
              schema: readPane(schemaWindow, 'Schema'),
              exports: sameExports,
            }),
          expectedError,
          `${label} signal should fail the actual driver observation`,
        );
      } finally {
        schemaWindow.happyDOM.abort();
      }
    }
  } finally {
    seoWindow.happyDOM.abort();
  }
});

test('driver DOM extraction and oracle reject populated optional SEO groups', () => {
  const title = 'Harbor Dental appointment information';
  const schemaWindow = renderPane('Schema', title);
  const populatedGroups = ['Social preview', 'International', 'Structured data'];
  try {
    const schema = readPane(schemaWindow, 'Schema');
    for (const group of populatedGroups) {
      const seoWindow = renderPane('SEO', title, undefined, ['Title & description', group]);
      try {
        assert.throws(
          () =>
            assertGuestSeoSchemaEmptyObservation({
              expectedTitle: title,
              seo: readPane(seoWindow, 'SEO'),
              schema,
              exports: sameExports,
            }),
          new RegExp(group.toLowerCase().replaceAll(' ', '_')),
          `${group} should not appear for the no-signal fixture`,
        );
      } finally {
        seoWindow.happyDOM.abort();
      }
    }
  } finally {
    schemaWindow.happyDOM.abort();
  }
});
