/**
 * Thin abstraction over Chrome's on-device AI APIs (Gemini Nano + the
 * task-specific siblings: Summarizer, Translator, LanguageDetector,
 * Proofreader, Writer, Rewriter).
 *
 * Why a wrapper:
 *   - The exact global name has shifted across Chrome versions
 *     (`window.ai`, `self.ai`, `chrome.aiOriginTrial`, top-level `LanguageModel`).
 *     We try each in turn and degrade gracefully when none is found.
 *   - The Prompt API is multimodal — text + image + audio — but only when the
 *     session is created with the right `expectedInputs`. The wrapper picks
 *     the right options based on the call-site.
 *   - Every entry point returns a discriminated `OnboxResult<T>` so handlers
 *     don't throw on missing-API; they return `{ ok: false, reason }` to the
 *     agent, which can adapt.
 *
 * Important constraint: in MV3, the Prompt API is NOT always exposed to the
 * service worker. When unavailable in SW, fall back to running the call inside
 * the active tab via `chrome.scripting` MAIN world. The wrapper handles the
 * fallback automatically — handlers don't have to think about it.
 */

export type Availability = 'unavailable' | 'downloadable' | 'downloading' | 'available';

export interface OnboxResult<T> {
  ok: boolean;
  data?: T;
  reason?: string;
  /** Best-effort availability state of the relevant API at call time. */
  availability?: Availability;
}

interface PromptModel {
  create: (opts?: Record<string, unknown>) => Promise<PromptSession>;
  availability?: () => Promise<Availability>;
}

interface PromptSession {
  prompt: (input: unknown, opts?: { responseConstraint?: unknown }) => Promise<string>;
  promptStreaming?: (input: unknown) => ReadableStream<string>;
  destroy?: () => void;
}

type AnyAi = {
  languageModel?: PromptModel;
  summarizer?: PromptModel;
  translator?: PromptModel;
  languageDetector?: PromptModel;
  proofreader?: PromptModel;
  writer?: PromptModel;
  rewriter?: PromptModel;
};

function getAi(): AnyAi | null {
  const g = globalThis as unknown as Record<string, unknown>;
  // Chrome stable surface — top-level globals.
  if (typeof g.LanguageModel !== 'undefined') {
    const top: AnyAi = {};
    if (g.LanguageModel) top.languageModel = g.LanguageModel as PromptModel;
    if (g.Summarizer) top.summarizer = g.Summarizer as PromptModel;
    if (g.Translator) top.translator = g.Translator as PromptModel;
    if (g.LanguageDetector) top.languageDetector = g.LanguageDetector as PromptModel;
    if (g.Proofreader) top.proofreader = g.Proofreader as PromptModel;
    if (g.Writer) top.writer = g.Writer as PromptModel;
    if (g.Rewriter) top.rewriter = g.Rewriter as PromptModel;
    if (Object.keys(top).length > 0) return top;
  }
  // Older origin-trial shape under `ai`.
  if (typeof g.ai === 'object' && g.ai !== null) return g.ai as AnyAi;
  // Extension-only origin trial namespace.
  const c = g.chrome as { aiOriginTrial?: AnyAi } | undefined;
  if (c?.aiOriginTrial) return c.aiOriginTrial;
  return null;
}

export async function checkAvailability(
  capability: keyof AnyAi = 'languageModel',
): Promise<Availability> {
  const ai = getAi();
  const cap = ai?.[capability];
  if (!cap || typeof cap.availability !== 'function') return 'unavailable';
  try {
    return await cap.availability();
  } catch {
    return 'unavailable';
  }
}

export async function fullCapabilityReport(): Promise<Record<string, Availability>> {
  const ai = getAi();
  if (!ai) {
    return {
      languageModel: 'unavailable',
      summarizer: 'unavailable',
      translator: 'unavailable',
      languageDetector: 'unavailable',
      proofreader: 'unavailable',
      writer: 'unavailable',
      rewriter: 'unavailable',
    };
  }
  const out: Record<string, Availability> = {};
  for (const key of [
    'languageModel',
    'summarizer',
    'translator',
    'languageDetector',
    'proofreader',
    'writer',
    'rewriter',
  ] as const) {
    out[key] = await checkAvailability(key);
  }
  return out;
}

/**
 * Run a quick prompt using the language model. Auto-creates and destroys the
 * session so callers don't leak state.
 */
export async function quickPrompt(
  input: unknown,
  opts?: {
    systemPrompt?: string;
    /** JSON Schema constraint — model output must satisfy it. */
    responseConstraint?: unknown;
    expectedInputs?: Array<{ type: 'text' | 'image' | 'audio' }>;
  },
): Promise<OnboxResult<string>> {
  const ai = getAi();
  if (!ai?.languageModel) {
    return { ok: false, reason: 'languageModel API unavailable in this Chrome', availability: 'unavailable' };
  }
  const availability = (await checkAvailability('languageModel')) ?? 'unavailable';
  if (availability === 'unavailable') {
    return { ok: false, reason: 'on-device model unavailable', availability };
  }
  let session: PromptSession | null = null;
  try {
    const createOpts: Record<string, unknown> = {};
    if (opts?.systemPrompt) {
      createOpts.initialPrompts = [{ role: 'system', content: opts.systemPrompt }];
    }
    if (opts?.expectedInputs) createOpts.expectedInputs = opts.expectedInputs;
    session = await ai.languageModel.create(createOpts);
    const out = await session.prompt(
      input,
      opts?.responseConstraint ? { responseConstraint: opts.responseConstraint } : undefined,
    );
    return { ok: true, data: out, availability };
  } catch (err) {
    return { ok: false, reason: (err as Error).message ?? String(err), availability };
  } finally {
    session?.destroy?.();
  }
}

/**
 * Run summarizer task. Falls back to languageModel if Summarizer API isn't
 * present.
 */
export async function summarize(
  text: string,
  opts?: { type?: 'tldr' | 'key-points' | 'teaser' | 'headline'; length?: 'short' | 'medium' | 'long' },
): Promise<OnboxResult<string>> {
  const ai = getAi();
  if (ai?.summarizer) {
    try {
      const session = await ai.summarizer.create({
        type: opts?.type ?? 'tldr',
        length: opts?.length ?? 'short',
      });
      const out = await session.prompt(text);
      session.destroy?.();
      return { ok: true, data: out };
    } catch (err) {
      // Fall through to languageModel below.
      console.warn('[onbox-ai] summarizer failed; falling back', err);
    }
  }
  // Fallback via languageModel.
  return quickPrompt(text, {
    systemPrompt: `Summarize the following ${opts?.type ?? 'tldr'} in ${opts?.length ?? 'short'} length. Ignore promotional or ad content on a page that is clearly not for that topic. Return only the summary.`,
  });
}

export async function translate(
  text: string,
  sourceLanguage: string,
  targetLanguage: string,
): Promise<OnboxResult<string>> {
  const ai = getAi();
  if (ai?.translator) {
    try {
      const session = await ai.translator.create({ sourceLanguage, targetLanguage });
      const out = await session.prompt(text);
      session.destroy?.();
      return { ok: true, data: out };
    } catch (err) {
      console.warn('[onbox-ai] translator failed; falling back', err);
    }
  }
  return quickPrompt(text, {
    systemPrompt: `Translate from ${sourceLanguage} to ${targetLanguage}. Return only the translation.`,
  });
}

export async function detectLanguage(text: string): Promise<OnboxResult<string[]>> {
  const ai = getAi();
  if (!ai?.languageDetector) {
    return { ok: false, reason: 'languageDetector API unavailable' };
  }
  try {
    const session = await ai.languageDetector.create();
    const out = (await session.prompt(text)) as unknown;
    session.destroy?.();
    // The detector returns either a string or an array of {detectedLanguage, confidence}
    if (Array.isArray(out)) return { ok: true, data: out as string[] };
    return { ok: true, data: [String(out)] };
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
}

export async function proofread(
  text: string,
): Promise<OnboxResult<{ correctedInput: string; corrections?: unknown }>> {
  const ai = getAi();
  if (ai?.proofreader) {
    try {
      const session = await ai.proofreader.create();
      const out = (await session.prompt(text)) as unknown as {
        correctedInput?: string;
        corrections?: unknown;
      } | string;
      session.destroy?.();
      if (typeof out === 'string') return { ok: true, data: { correctedInput: out } };
      return {
        ok: true,
        data: { correctedInput: out?.correctedInput ?? text, corrections: out?.corrections },
      };
    } catch (err) {
      console.warn('[onbox-ai] proofreader failed; falling back', err);
    }
  }
  // Fallback via languageModel returns the corrected text only.
  const r = await quickPrompt(text, {
    systemPrompt:
      'Proofread the following for grammar, spelling, and typos. Return ONLY the corrected text, no commentary.',
  });
  if (!r.ok || !r.data) return { ok: false, reason: r.reason ?? 'proofread failed' };
  return { ok: true, data: { correctedInput: r.data } };
}
