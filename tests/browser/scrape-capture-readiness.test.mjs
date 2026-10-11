import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Window } from 'happy-dom';
import { captureStateExpression, isCaptureReady } from './scrape-seo-schema-empty-observation.mjs';

const title = 'Harbor Dental appointment information';
// Real use case: a dental practice checks an empty appointment page in guest Scrape.
// Shape from ScrapeView.tsx / outer Radix tabs; run 38103816963 records one outside
// selected tab before capture and two global selected tabs after the trusted click.
function captureFixture({ captured = true, outside = true } = {}) {
  const window = new Window();
  window.document.body.innerHTML = `
    <div role="tablist"><button role="tab" title="Scrape" data-state="active"
      aria-selected="true" aria-controls="scrape-panel">Scrape</button></div>
    ${outside ? '<div role="tabpanel" data-state="inactive"><div role="tablist"><button role="tab" aria-selected="true">Settings</button></div></div>' : ''}
    <div role="tabpanel" id="scrape-panel" data-state="active">
      <div class="truncate text-sm font-medium">${title}</div>
      <button title="Capture the page exactly as it is right now">Capture</button>
      ${captured ? '<div role="tablist"><button role="tab" aria-selected="true" aria-controls="article-panel">Article</button></div><div role="tabpanel" id="article-panel" data-state="active" style="visibility:visible;opacity:1">0 words</div>' : ''}
    </div>`;
  for (const node of window.document.querySelectorAll('[role="tabpanel"]'))
    node.getBoundingClientRect = () => ({ height: 100 });
  return window;
}

function read(window) {
  return new Function('document', 'getComputedStyle', `return ${captureStateExpression(title)}`)(
    window.document,
    window.getComputedStyle.bind(window),
  );
}

const captureEvents = {
  capture_click: 1,
  trusted_capture_click: 1,
  last_target_is_capture: true,
  last_target_inside_scrape: true,
};

function check(
  options,
  mutate,
  expected,
  before = { result_tablist_count: 0, selected_count: 0 },
  events = captureEvents,
) {
  const window = captureFixture(options);
  try {
    mutate?.(window.document);
    assert.equal(Boolean(isCaptureReady(read(window), before, events)), expected);
  } finally {
    window.happyDOM.abort();
  }
}

test('capture readiness ignores selected outer and inactive sibling tabs after Article appears', () => {
  check({}, null, true);
  check({ outside: false }, null, true);
});

test('capture readiness stays false before a real Scrape result appears despite the matching page title', () => {
  check({ captured: false }, null, false);
});

test('capture readiness rejects inactive, hidden, or foreign Article result panes', () => {
  check(
    {},
    (doc) => {
      doc.getElementById('article-panel').dataset.state = 'inactive';
    },
    false,
  );
  check(
    {},
    (doc) => {
      doc.getElementById('article-panel').getBoundingClientRect = () => ({ height: 0 });
    },
    false,
  );
  check(
    {},
    (doc) => {
      doc.body.append(doc.getElementById('article-panel'));
    },
    false,
  );
});

test('capture readiness rejects wrong result selection, ambiguous selection, and stale page titles', () => {
  check(
    {},
    (doc) => {
      doc.querySelector('#scrape-panel [role="tab"]').textContent = 'SEO';
    },
    false,
  );
  check(
    {},
    (doc) => {
      doc
        .querySelector('#scrape-panel [role="tablist"]')
        .insertAdjacentHTML('beforeend', '<button role="tab" aria-selected="true">Schema</button>');
    },
    false,
  );
  check(
    {},
    (doc) => {
      doc.querySelector('#scrape-panel .truncate').textContent = 'Harbor Dental referral guidance';
    },
    false,
  );
});

test('capture readiness rejects inactive or ambiguous Scrape surfaces', () => {
  check(
    {},
    (doc) => {
      doc.getElementById('scrape-panel').dataset.state = 'inactive';
    },
    false,
  );
  check(
    {},
    (doc) => {
      doc.body.insertAdjacentHTML(
        'beforeend',
        '<button role="tab" title="Scrape" data-state="active" aria-controls="scrape-panel">Scrape</button>',
      );
    },
    false,
  );
});

test('capture readiness rejects a preexisting result or absent trusted capture input', () => {
  check({}, null, false, { result_tablist_count: 1, selected_count: 1 });
  check({}, null, false, { result_tablist_count: 1, selected_count: 0 });
  check({}, null, false, undefined, { ...captureEvents, trusted_capture_click: 0 });
  check({}, null, false, undefined, { ...captureEvents, last_target_inside_scrape: false });
});

test('capture readiness rejects Article panels hidden by computed style', () => {
  check(
    {},
    (doc) => {
      doc.getElementById('article-panel').style.visibility = 'hidden';
    },
    false,
  );
  check(
    {},
    (doc) => {
      doc.getElementById('article-panel').style.opacity = '0';
    },
    false,
  );
  check(
    {},
    (doc) => {
      doc.getElementById('article-panel').style.display = 'none';
    },
    false,
  );
});
