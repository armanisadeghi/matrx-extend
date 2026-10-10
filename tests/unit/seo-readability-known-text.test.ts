import { runAudit } from '@/lib/seo/audit';
import { fleschBand } from '@/lib/seo/flesch-bands';
import { describe, expect, it } from 'vitest';

const independentlyWorkedCases = [
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
] as const;

describe('known SEO readability copy reaches the real audit formula', () => {
  for (const fixture of independentlyWorkedCases) {
    it(`${fixture.id} produces its independently worked native values`, () => {
      const document = new DOMParser().parseFromString('<html><body></body></html>', 'text/html');
      Object.defineProperty(document.body, 'innerText', {
        configurable: true,
        value: fixture.text,
      });

      const audit = runAudit(document, 'https://property-manager.invalid/maintenance');

      expect(audit.word_count).toBe(fixture.expected.words);
      expect(audit.sentence_count).toBe(fixture.expected.sentences);
      expect(audit.flesch_reading_ease).toBe(fixture.expected.score);
      expect(fleschBand(audit.flesch_reading_ease)?.summary).toBe(fixture.expected.summary);
    });
  }
});
