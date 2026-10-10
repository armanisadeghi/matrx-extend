import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  SEO_READABILITY_FIXTURES,
  assertKnownReadability,
  runKnownReadabilityFixtures,
} from './seo-readability-known-text.mjs';

test('known maintenance text has two distinct worked readability outcomes', () => {
  const independentlyWorked = [
    {
      id: 'roof-maintenance',
      text: 'The caretaker checks the roof. Rain drains from the clean gutters.',
      words: 11,
      sentences: 2,
      score: 85.89,
      summary: 'Easy — 6th grade',
    },
    {
      id: 'winter-repairs',
      text: 'Routine repairs help. Tenant notices arrive.',
      words: 6,
      sentences: 2,
      score: 6.39,
      summary: 'Extremely difficult — professional',
    },
  ];

  assert.deepEqual(
    SEO_READABILITY_FIXTURES.map(({ id, text, expected }) => ({ id, text, ...expected })),
    independentlyWorked,
  );
  assert.notEqual(independentlyWorked[0].score, independentlyWorked[1].score);
  for (const fixture of SEO_READABILITY_FIXTURES) {
    const measured = {
      words: String(fixture.expected.words),
      sentences: String(fixture.expected.sentences),
      score: String(fixture.expected.score),
      summary: fixture.expected.summary,
    };
    assert.doesNotThrow(() => assertKnownReadability(measured, fixture.expected, fixture.id));
    for (const field of ['words', 'sentences', 'score', 'summary']) {
      const wrong = {
        ...measured,
        [field]: field === 'summary' ? 'Wrong band' : String(Number(measured[field]) + 1),
      };
      assert.throws(() => assertKnownReadability(wrong, fixture.expected, fixture.id), field);
    }
  }
});

test('native fixture lifecycle restores between both known-text readings', async () => {
  const originalDocument = globalThis.document;
  const originalNode = {
    textContent: 'Harbor View property maintenance notice.',
    markup: '<main><p>Harbor View property maintenance notice.</p></main>',
  };
  const body = {
    childNodes: [originalNode],
    replaceChildren(...nodes) {
      this.childNodes = nodes;
    },
    get innerHTML() {
      return this.childNodes
        .map((node) => node.markup ?? `<article>${node.textContent}</article>`)
        .join('');
    },
    get innerText() {
      return this.childNodes.map((node) => node.textContent).join('');
    },
    get textContent() {
      return this.innerText;
    },
  };
  globalThis.document = {
    body,
    createElement: () => {
      const node = { dataset: {}, _text: '' };
      Object.defineProperty(node, 'textContent', {
        get: () => node._text,
        set: (value) => {
          node._text = value;
        },
      });
      return node;
    },
  };
  const events = [];
  const page = { evaluate: (callback, value) => callback(value) };
  try {
    const results = await runKnownReadabilityFixtures({
      page,
      step: (phase, fixture) => events.push(`${fixture.id}:${phase}`),
      reaudit: async (fixture) => events.push(`${fixture.id}:reaudit`),
      observe: async (fixture) => ({
        readability: {
          words: String(fixture.expected.words),
          sentences: String(fixture.expected.sentences),
          score: String(fixture.expected.score),
          summary: fixture.expected.summary,
        },
      }),
    });

    assert.deepEqual(
      results.map((result) => result.id),
      SEO_READABILITY_FIXTURES.map((item) => item.id),
    );
    assert.deepEqual(
      events.filter((event) => event.endsWith(':restore')),
      SEO_READABILITY_FIXTURES.map((fixture) => `${fixture.id}:restore`),
    );
    assert.equal(
      body.innerHTML,
      originalNode.markup,
      'the original page markup survives both cases',
    );
    assert.equal(globalThis.__matrxSeoReadabilityFixture, undefined, 'no fixture remains active');
  } finally {
    if (originalDocument === undefined) globalThis.document = undefined;
    else globalThis.document = originalDocument;
    globalThis.__matrxSeoReadabilityFixture = undefined;
  }
});
