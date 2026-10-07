import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectLanguage, fullCapabilityReport, proofread, summarize, translate } from './client';

afterEach(() => vi.unstubAllGlobals());

describe('on-device task API discovery', () => {
  it('uses standalone task APIs when LanguageModel is absent', async () => {
    const summarizeText = vi.fn().mockResolvedValue('The library opens at nine.');
    const translateText = vi.fn().mockResolvedValue('La biblioteca abre a las nueve.');
    const detectText = vi.fn().mockResolvedValue([{ detectedLanguage: 'en', confidence: 0.99 }]);
    const proofreadText = vi.fn().mockResolvedValue({
      correctedInput: 'The library opens at nine.',
      corrections: [],
    });
    const summarizerDestroy = vi.fn();
    vi.stubGlobal('LanguageModel', undefined);
    vi.stubGlobal('Summarizer', {
      availability: async () => 'available',
      create: async () => ({ summarize: summarizeText, destroy: summarizerDestroy }),
    });
    vi.stubGlobal('Translator', {
      availability: async () => 'available',
      create: async () => ({ translate: translateText }),
    });
    vi.stubGlobal('LanguageDetector', {
      availability: async () => 'available',
      create: async () => ({ detect: detectText }),
    });
    vi.stubGlobal('Proofreader', {
      availability: async () => 'available',
      create: async () => ({ proofread: proofreadText }),
    });

    const report = await fullCapabilityReport();
    expect(report).toMatchObject({
      languageModel: 'unavailable',
      summarizer: 'available',
      translator: 'available',
      languageDetector: 'available',
      proofreader: 'available',
    });
    expect(await summarize('The public library opens at nine.')).toMatchObject({
      ok: true,
      data: 'The library opens at nine.',
    });
    expect(await translate('The library opens at nine.', 'en', 'es')).toMatchObject({
      ok: true,
      data: 'La biblioteca abre a las nueve.',
    });
    expect(await detectLanguage('The library opens at nine.')).toMatchObject({
      ok: true,
      data: [{ detectedLanguage: 'en', confidence: 0.99 }],
    });
    expect(await proofread('The library open at nine.')).toMatchObject({
      ok: true,
      data: { correctedInput: 'The library opens at nine.', corrections: [] },
    });
    expect(summarizeText).toHaveBeenCalledWith('The public library opens at nine.');
    expect(translateText).toHaveBeenCalledWith('The library opens at nine.');
    expect(detectText).toHaveBeenCalledWith('The library opens at nine.');
    expect(proofreadText).toHaveBeenCalledWith('The library open at nine.');
    expect(summarizerDestroy).toHaveBeenCalledOnce();
  });

  it('reports absent capabilities accurately and does not claim an operation succeeded', async () => {
    for (const hook of [
      'LanguageModel',
      'Summarizer',
      'Translator',
      'LanguageDetector',
      'Proofreader',
      'Writer',
      'Rewriter',
      'ai',
      'chrome',
    ]) {
      vi.stubGlobal(hook, undefined);
    }

    expect(Object.values(await fullCapabilityReport())).toEqual(Array(7).fill('unavailable'));
    expect(await detectLanguage('The library opens at nine.')).toMatchObject({ ok: false });
    expect(await summarize('The public library opens at nine.')).toMatchObject({
      ok: false,
      availability: 'unavailable',
    });
  });

  it('does not treat obsolete origin-trial namespaces as current task APIs', async () => {
    vi.stubGlobal('LanguageModel', undefined);
    vi.stubGlobal('Summarizer', undefined);
    vi.stubGlobal('ai', {
      summarizer: { availability: async () => 'available' },
    });
    vi.stubGlobal('chrome', {
      aiOriginTrial: { summarizer: { availability: async () => 'available' } },
    });

    expect((await fullCapabilityReport()).summarizer).toBe('unavailable');
  });

  it('does not turn malformed native results into successful output', async () => {
    vi.stubGlobal('LanguageModel', undefined);
    vi.stubGlobal('LanguageDetector', {
      create: async () => ({ detect: async () => 'en' }),
    });
    vi.stubGlobal('Proofreader', {
      create: async () => ({ proofread: async () => ({ corrections: [] }) }),
    });

    expect(await detectLanguage('The library opens at nine.')).toMatchObject({
      ok: false,
      reason: 'languageDetector returned invalid candidates',
    });
    expect(await proofread('The library open at nine.')).toMatchObject({
      ok: false,
      reason: 'proofreader returned no correctedInput',
    });
  });
});
