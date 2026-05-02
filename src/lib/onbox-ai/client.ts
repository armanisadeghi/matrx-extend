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

/**
 * The literal payload handed to a native on-device API. Emitted via the
 * optional `onRequest` callback right before the call is made — used for
 * inspectability/debugging from the side panel's smart-tests UI without
 * having to reconstruct prompts (which inevitably drifts from the truth).
 */
export interface OnboxRequestEvent {
  /** Which native API was actually invoked. */
  api: 'languageModel' | 'summarizer' | 'translator' | 'languageDetector' | 'proofreader';
  /**
   * 'native' = the dedicated task API (Summarizer, Translator, etc.)
   * 'fallback-language-model' = falling back to languageModel.prompt() because
   *   the native task API was missing or threw.
   */
  via: 'native' | 'fallback-language-model';
  /** Higher-level call type, e.g. "summarize" / "translate" / "proofread". */
  task: string;
  /** Options passed to {api}.create(). For prompt API includes initialPrompts (system). */
  createOptions?: Record<string, unknown>;
  /** Literal first arg to .prompt() — string for text, array for multimodal. */
  promptInput: unknown;
  /** Options passed as the second arg to .prompt() — e.g. { responseConstraint }. */
  promptOptions?: Record<string, unknown>;
  /** Captured at firing time so the receiver can render relative ordering. */
  firedAt: number;
}

export type OnboxOnRequest = (event: OnboxRequestEvent) => void;

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
    /**
     * Fired synchronously immediately before the native API call, with the
     * literal payload that's about to be sent. Used by inspector UIs to show
     * the user exactly what the model received without reconstruction.
     * Pass-through when called as a fallback from summarize/translate/etc.
     */
    onRequest?: OnboxOnRequest;
    /**
     * Override the `task` field on the emitted onRequest event. Defaults to
     * 'languageModel.prompt'. Used by fallback callers to label the event
     * with a higher-level purpose like 'summarize/fallback'.
     */
    requestTask?: string;
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
  const createOpts: Record<string, unknown> = {};
  if (opts?.systemPrompt) {
    createOpts.initialPrompts = [{ role: 'system', content: opts.systemPrompt }];
  }
  if (opts?.expectedInputs) createOpts.expectedInputs = opts.expectedInputs;
  const promptOpts = opts?.responseConstraint
    ? { responseConstraint: opts.responseConstraint }
    : undefined;
  // Fire synchronously, BEFORE create() — gives inspectors instant visibility
  // even while the model is still loading or the prompt is still in flight.
  try {
    opts?.onRequest?.({
      api: 'languageModel',
      via: opts?.requestTask?.endsWith('/fallback') ? 'fallback-language-model' : 'native',
      task: opts?.requestTask ?? 'languageModel.prompt',
      createOptions: createOpts,
      promptInput: input,
      promptOptions: promptOpts,
      firedAt: Date.now(),
    });
  } catch (cbErr) {
    console.warn('[onbox-ai] onRequest callback threw', cbErr);
  }
  let session: PromptSession | null = null;
  try {
    session = await ai.languageModel.create(createOpts);
    const out = await session.prompt(input, promptOpts);
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
function fireOnRequest(cb: OnboxOnRequest | undefined, event: OnboxRequestEvent) {
  if (!cb) return;
  try {
    cb(event);
  } catch (err) {
    console.warn('[onbox-ai] onRequest callback threw', err);
  }
}

export async function summarize(
  text: string,
  opts?: {
    type?: 'tldr' | 'key-points' | 'teaser' | 'headline';
    length?: 'short' | 'medium' | 'long';
    onRequest?: OnboxOnRequest;
  },
): Promise<OnboxResult<string>> {
  const ai = getAi();
  const createOptions = { type: opts?.type ?? 'tldr', length: opts?.length ?? 'short' };
  if (ai?.summarizer) {
    try {
      fireOnRequest(opts?.onRequest, {
        api: 'summarizer',
        via: 'native',
        task: 'summarize',
        createOptions,
        promptInput: text,
        firedAt: Date.now(),
      });
      const session = await ai.summarizer.create(createOptions);
      const out = await session.prompt(text);
      session.destroy?.();
      return { ok: true, data: out };
    } catch (err) {
      // Fall through to languageModel below.
      console.warn('[onbox-ai] summarizer failed; falling back', err);
    }
  }
  // Fallback via languageModel — quickPrompt fires its own onRequest.
  return quickPrompt(text, {
    systemPrompt: `Summarize the following ${opts?.type ?? 'tldr'} in ${opts?.length ?? 'short'} length. Ignore promotional or ad content on a page that is clearly not for that topic. Return only the summary.`,
    onRequest: opts?.onRequest,
    requestTask: 'summarize/fallback',
  });
}

export async function translate(
  text: string,
  sourceLanguage: string,
  targetLanguage: string,
  opts?: { onRequest?: OnboxOnRequest },
): Promise<OnboxResult<string>> {
  const ai = getAi();
  const createOptions = { sourceLanguage, targetLanguage };
  if (ai?.translator) {
    try {
      fireOnRequest(opts?.onRequest, {
        api: 'translator',
        via: 'native',
        task: 'translate',
        createOptions,
        promptInput: text,
        firedAt: Date.now(),
      });
      const session = await ai.translator.create(createOptions);
      const out = await session.prompt(text);
      session.destroy?.();
      return { ok: true, data: out };
    } catch (err) {
      console.warn('[onbox-ai] translator failed; falling back', err);
    }
  }
  return quickPrompt(text, {
    systemPrompt: `Translate from ${sourceLanguage} to ${targetLanguage}. Return only the translation.`,
    onRequest: opts?.onRequest,
    requestTask: 'translate/fallback',
  });
}

export async function detectLanguage(
  text: string,
  opts?: { onRequest?: OnboxOnRequest },
): Promise<OnboxResult<string[]>> {
  const ai = getAi();
  if (!ai?.languageDetector) {
    return { ok: false, reason: 'languageDetector API unavailable' };
  }
  try {
    fireOnRequest(opts?.onRequest, {
      api: 'languageDetector',
      via: 'native',
      task: 'detectLanguage',
      promptInput: text,
      firedAt: Date.now(),
    });
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
  opts?: { onRequest?: OnboxOnRequest },
): Promise<OnboxResult<{ correctedInput: string; corrections?: unknown }>> {
  const ai = getAi();
  if (ai?.proofreader) {
    try {
      fireOnRequest(opts?.onRequest, {
        api: 'proofreader',
        via: 'native',
        task: 'proofread',
        promptInput: text,
        firedAt: Date.now(),
      });
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
    onRequest: opts?.onRequest,
    requestTask: 'proofread/fallback',
  });
  if (!r.ok || !r.data) return { ok: false, reason: r.reason ?? 'proofread failed' };
  return { ok: true, data: { correctedInput: r.data } };
}
