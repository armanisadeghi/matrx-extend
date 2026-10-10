import assert from 'node:assert/strict';

// Property managers need a quick check that maintenance notices read clearly.
// These two controlled samples have different independently worked outcomes.
export const SEO_READABILITY_FIXTURES = [
  {
    id: 'roof-maintenance',
    text: 'The caretaker checks the roof. Rain drains from the clean gutters.',
    expected: { words: 11, sentences: 2, score: 85.89, summary: 'Easy — 6th grade' },
  },
  {
    id: 'winter-repairs',
    text: 'Routine repairs help. Tenant notices arrive.',
    expected: {
      words: 6,
      sentences: 2,
      score: 6.39,
      summary: 'Extremely difficult — professional',
    },
  },
];

function displayedCount(value) {
  return value === null || !/^[0-9][0-9,]*$/.test(value) ? null : Number(value.replaceAll(',', ''));
}

export function assertKnownReadability(actual, expected, label) {
  assert.equal(displayedCount(actual.words), expected.words, `${label}: word count`);
  assert.equal(displayedCount(actual.sentences), expected.sentences, `${label}: sentence count`);
  assert.ok(
    actual.score !== null && actual.score !== undefined && Number.isFinite(Number(actual.score)),
    `${label}: Flesch score is present and numeric`,
  );
  assert.equal(Number(actual.score), expected.score, `${label}: exact Flesch value`);
  assert.equal(actual.summary, expected.summary, `${label}: reading band and grade`);
}

async function installKnownReadabilityText(page, text) {
  return page.evaluate((fixtureText) => {
    const body = document.body;
    if (globalThis.__matrxSeoReadabilityFixture)
      throw new Error('seo_readability_fixture_already_active');
    const originalMarkup = body.innerHTML;
    const originalNodes = [...body.childNodes];
    const article = document.createElement('article');
    article.dataset.matrxSeoReadabilityFixture = 'true';
    article.textContent = fixtureText;
    globalThis.__matrxSeoReadabilityFixture = { body, originalMarkup, originalNodes };
    body.replaceChildren(article);
    return { text: (body.innerText || body.textContent || '').trim() };
  }, text);
}

async function restoreKnownReadabilityText(page) {
  return page.evaluate(() => {
    const fixture = globalThis.__matrxSeoReadabilityFixture;
    if (!fixture) return false;
    fixture.body.replaceChildren(...fixture.originalNodes);
    const restored = fixture.body.innerHTML === fixture.originalMarkup;
    globalThis.__matrxSeoReadabilityFixture = undefined;
    return restored;
  });
}

// The native driver supplies real click/wait/read callbacks. This shared loop
// owns each fixture's lifecycle so a failed assertion still restores the page
// before the next fixture can install.
export async function runKnownReadabilityFixtures({
  page,
  fixtures = SEO_READABILITY_FIXTURES,
  step = () => {},
  reaudit,
  observe,
}) {
  const results = [];
  for (const fixture of fixtures) {
    step('install', fixture);
    const installed = await installKnownReadabilityText(page, fixture.text);
    try {
      assert.equal(
        installed.text,
        fixture.text,
        `${fixture.id}: owned article fixture is the exact visible page text`,
      );
      await reaudit(fixture);
      step('observe', fixture);
      const observed = await observe(fixture);
      assertKnownReadability(observed.readability, fixture.expected, fixture.id);
      results.push({ id: fixture.id, expected: fixture.expected, displayed: observed.readability });
    } finally {
      const restored = await restoreKnownReadabilityText(page);
      step('restore', fixture);
      assert.equal(restored, true, 'the exact pre-fixture public page DOM is restored');
    }
  }
  return results;
}
