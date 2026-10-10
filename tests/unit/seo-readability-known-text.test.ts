import { runAudit } from '@/lib/seo/audit';
import { fleschBand } from '@/lib/seo/flesch-bands';
import { describe, expect, it } from 'vitest';
import { SEO_READABILITY_FIXTURES } from '../browser/seo-readability-known-text.mjs';

describe('known SEO readability copy reaches the real audit formula', () => {
  for (const fixture of SEO_READABILITY_FIXTURES) {
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
