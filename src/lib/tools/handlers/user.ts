/**
 * Tier: ASK-USER — the agent talks to the human.
 *
 * Canonical wire contract:
 * `packages/matrx-ai/matrx_ai/tools/USER_TOOL_WIRE_CONTRACT.md` in aidream.
 *
 * One `user` tool with a `type` discriminator covers:
 *   - confirm        — yes/no
 *   - choice         — pick one
 *   - choice_many    — pick any
 *   - text           — freeform answer
 *   - secret         — masked freeform answer
 *   - notify         — info/success/warning/error banner with action buttons
 *
 * The result envelope is the SAME shape regardless of type. Fields that
 * don't apply to a type are null/false; that way the model parses one
 * schema for every variant.
 *
 * The standalone `request_user_takeover` and `update_plan` tools are NOT
 * folded into `user` — they have distinct semantics (page-takeover and
 * plan approval) and live alongside it.
 */

import { addTasks, savePlan, setPlanStatus } from '@/lib/lists/storage';
import { broadcast, on } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import type {
  AskUserResponse,
  PendingAskUserRequest,
  ToolHandler,
  UserAskKind,
  UserAskOption,
} from '@/lib/tools/types';
import { z } from 'zod';

// ─── unified `user` tool ──────────────────────────────────────────────────

/**
 * Rich option shape — string for legacy callers, object for new callers.
 * The handler normalizes to {label, description?, preview?} before the
 * card sees it.
 */
const OptionInput = z.union([
  z.string().min(1),
  z.object({
    label: z.string().min(1),
    description: z.string().optional(),
    preview: z.string().optional(),
  }),
]);

/**
 * Inner shape used when batching — same fields as the top-level args
 * minus the `questions` discriminator.
 */
const SingleQuestionSchema = z.object({
  type: z.enum(['confirm', 'choice', 'choice_many', 'text', 'secret', 'notify']),
  question: z.string().optional(),
  header: z.string().max(12).optional(),
  options: z.array(OptionInput).optional(),
  context: z.string().optional(),
  message: z.string().optional(),
  actions: z.array(z.string().min(1)).optional(),
  level: z.enum(['info', 'success', 'warning', 'error']).optional(),
  allow_other: z.boolean().optional(),
  timeout_seconds: z.number().int().min(1).max(900).optional(),
});
type SingleQuestion = z.infer<typeof SingleQuestionSchema>;

/**
 * UserArgs is one big object with everything optional, validated by
 * superRefine. Single-question form fills the top-level fields; batched
 * form fills `questions[]`. The schema is intentionally flat (vs a
 * z.union) so the DB tool_def.parameters shape mirrors it 1:1 and the
 * drift comparator works without special-casing unions.
 */
const UserArgs = z
  .object({
    // Single-question fields (omit when using batched form)
    type: z.enum(['confirm', 'choice', 'choice_many', 'text', 'secret', 'notify']).optional(),
    question: z.string().optional(),
    header: z.string().max(12).optional(),
    options: z.array(OptionInput).optional(),
    context: z.string().optional(),
    message: z.string().optional(),
    actions: z.array(z.string().min(1)).optional(),
    level: z.enum(['info', 'success', 'warning', 'error']).optional(),
    allow_other: z.boolean().optional(),
    timeout_seconds: z.number().int().min(1).max(900).optional(),
    // Batched form (mutually exclusive with everything above)
    questions: z.array(SingleQuestionSchema).min(1).max(4).optional(),
  })
  .superRefine((v, ctx) => {
    const isBatch = !!v.questions && v.questions.length > 0;
    if (isBatch) {
      // Batched form: everything ELSE must be absent.
      const stray = Object.entries(v).find(([k, val]) => k !== 'questions' && val !== undefined);
      if (stray) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `When using the batched form, only \`questions\` may be set. Saw \`${stray[0]}\`.`,
          path: [stray[0]],
        });
      }
      // Validate every batched question
      v.questions!.forEach((q, i) => validateSingle(q, ctx, ['questions', i]));
    } else {
      // Single form: `type` is required
      if (!v.type) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Either `type` (single question) or `questions[]` (batched) is required',
          path: ['type'],
        });
        return;
      }
      validateSingle(v as SingleQuestion, ctx, []);
    }
  });
type UserArgs = z.infer<typeof UserArgs>;

function validateSingle(
  v: SingleQuestion,
  ctx: z.RefinementCtx,
  pathPrefix: (string | number)[],
): void {
  const ASK_TYPES: UserAskKind[] = ['confirm', 'choice', 'choice_many', 'text', 'secret'];
  if (ASK_TYPES.includes(v.type) && !v.question?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `question is required for type='${v.type}'`,
      path: [...pathPrefix, 'question'],
    });
  }
  if ((v.type === 'choice' || v.type === 'choice_many') && (!v.options || v.options.length < 2)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `options (>=2) is required for type='${v.type}'`,
      path: [...pathPrefix, 'options'],
    });
  }
  if (v.type === 'notify' && !v.message?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "message is required for type='notify'",
      path: [...pathPrefix, 'message'],
    });
  }
}

function isBatched(args: UserArgs): args is UserArgs & { questions: SingleQuestion[] } {
  return !!args.questions && args.questions.length > 0;
}

/** Normalize bare-string options to the rich shape. */
function normalizeOptions(raw: SingleQuestion['options']): UserAskOption[] | undefined {
  if (!raw) return undefined;
  return raw.map((o) =>
    typeof o === 'string'
      ? { label: o }
      : { label: o.label, description: o.description, preview: o.preview },
  );
}

const EMPTY_ENVELOPE = {
  answer: null as string | null,
  selected: null as string[] | null,
  confirmed: null as boolean | null,
  action: null as string | null,
  freeform: null as string | null,
  additional_instructions: null as string | null,
  wrote_instead: false,
  cancelled: false,
  timed_out: false,
};
type Envelope = typeof EMPTY_ENVELOPE;

type BatchedResult = {
  answers: Envelope[];
  cancelled: boolean;
  timed_out: boolean;
  additional_instructions: string | null;
  wrote_instead: boolean;
};

export const user: ToolHandler<UserArgs, Envelope | BatchedResult> = {
  name: 'user',
  tier: 'ask-user',
  argsSchema: UserArgs,
  run: async (args, ctx) => {
    if (isBatched(args)) {
      return runBatchedQuestions(args.questions, ctx);
    }
    // superRefine guarantees `type` is set when not batched.
    return runSingleQuestion(args as SingleQuestion, ctx);
  },
};

async function runSingleQuestion(
  q: SingleQuestion,
  ctx: { callId: string; conversationId: string | null; agentName: string | null },
  batch?: { index: number; total: number; callIdSuffix?: string },
): Promise<Envelope> {
  const timeoutMs = q.timeout_seconds ? q.timeout_seconds * 1000 : null;
  // Batched questions need distinct callIds so the inbox treats them as
  // separate cards (otherwise the second one collides with the first
  // when we await the response).
  const callId = batch ? `${ctx.callId}.${batch.index}` : ctx.callId;
  const request: PendingAskUserRequest = {
    callId,
    conversationId: ctx.conversationId,
    kind: q.type,
    question: q.question,
    header: q.header,
    options: normalizeOptions(q.options),
    message: q.message,
    actions: q.actions,
    level: q.level,
    context: q.context,
    // Always offer a freeform "Other" escape on choice/choice_many — independent of
    // what the model sent (allow_other isn't even in the canonical model schema).
    allow_other: q.type === 'choice' || q.type === 'choice_many' ? true : q.allow_other,
    // Came from the `user` tool → enable the note + write-instead escapes in the card.
    allow_extras: true,
    batch_index: batch?.index,
    batch_total: batch?.total,
    expires_at_ms: timeoutMs ? Date.now() + timeoutMs : undefined,
  };

  // For notify, also fire a system notification so the user sees it
  // when the side panel isn't open. The inline card still renders so
  // they can respond with an action button.
  if (q.type === 'notify') {
    void fireSystemNotification(q, ctx.agentName).catch(() => {
      /* permission denied / API absent — inline card is the fallback */
    });
  }

  const response = await awaitUserResponse(request, timeoutMs);
  return responseToEnvelope(q.type, response);
}

async function runBatchedQuestions(
  questions: SingleQuestion[],
  ctx: { callId: string; conversationId: string | null; agentName: string | null },
): Promise<BatchedResult> {
  const answers: Envelope[] = [];
  let cancelled = false;
  let timed_out = false;
  let wrote_instead = false;
  let additional_instructions: string | null = null;
  for (let i = 0; i < questions.length; i++) {
    const env = await runSingleQuestion(questions[i]!, ctx, { index: i, total: questions.length });
    answers.push(env);
    // Bubble the user's freeform note up to the batch result (it only renders on
    // the final card, so this captures the last non-empty one).
    if (env.additional_instructions) {
      additional_instructions = env.additional_instructions;
    }
    // "Write message instead", cancel, or timeout each short-circuit the rest — the
    // remaining questions come back as empty envelopes with the matching flag set so
    // the model sees which one ended the batch.
    if (env.wrote_instead) {
      wrote_instead = true;
      for (let j = i + 1; j < questions.length; j++) {
        answers.push({ ...EMPTY_ENVELOPE, wrote_instead: true });
      }
      break;
    }
    if (env.cancelled) {
      cancelled = true;
      for (let j = i + 1; j < questions.length; j++) {
        answers.push({ ...EMPTY_ENVELOPE, cancelled: true });
      }
      break;
    }
    if (env.timed_out) {
      timed_out = true;
      for (let j = i + 1; j < questions.length; j++) {
        answers.push({ ...EMPTY_ENVELOPE, timed_out: true });
      }
      break;
    }
  }
  return { answers, cancelled, timed_out, wrote_instead, additional_instructions };
}

function responseToEnvelope(kind: UserAskKind, r: AskUserResponse | 'timed_out'): Envelope {
  if (r === 'timed_out') {
    return { ...EMPTY_ENVELOPE, timed_out: true };
  }
  if (r.cancelled) {
    return { ...EMPTY_ENVELOPE, cancelled: true };
  }
  // Ride-along fields present on ANY answer, regardless of kind. (Rebuilding from
  // EMPTY_ENVELOPE per-kind would otherwise silently drop them.)
  const extras = {
    additional_instructions: r.additional_instructions ?? null,
    wrote_instead: r.wrote_instead ?? false,
  };
  // "Write message instead" bypasses the structured shape — the reply is in freeform.
  if (r.wrote_instead) {
    return { ...EMPTY_ENVELOPE, ...extras, freeform: r.freeform ?? null };
  }
  switch (kind) {
    case 'confirm':
      // confirmed is null when the user took the inline 'Other' escape (text in freeform).
      return {
        ...EMPTY_ENVELOPE,
        ...extras,
        confirmed: r.confirmed ?? null,
        freeform: r.freeform ?? null,
      };
    case 'choice':
    case 'choice_many':
      // Carry freeform too — it holds the 'Other' text when the user took that option.
      return {
        ...EMPTY_ENVELOPE,
        ...extras,
        selected: r.selected ?? null,
        freeform: r.freeform ?? null,
      };
    case 'text':
    case 'secret':
      return { ...EMPTY_ENVELOPE, ...extras, answer: r.answer ?? null };
    case 'notify':
      return {
        ...EMPTY_ENVELOPE,
        ...extras,
        action: r.action ?? null,
        freeform: r.freeform ?? null,
      };
  }
}

async function fireSystemNotification(q: SingleQuestion, agentName: string | null): Promise<void> {
  if (!chrome.notifications) return;
  const title = agentName ? `${agentName}` : 'Matrx';
  await new Promise<string>((resolve) => {
    chrome.notifications.create(
      {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icon/128.png'),
        title,
        message: q.message ?? '',
        requireInteraction: (q.actions?.length ?? 0) > 0,
      },
      (id) => resolve(id),
    );
  });
}

// ─── request_user_takeover ─────────────────────────────────────────────────

// Unified arg set (matches tool_def + the other surfaces): reason (required),
// instructions?, expected_action?, tab_id?, timeout_seconds?. This surface uses
// tab_id implicitly (via the assigned tab) and honors timeout_seconds when set.
const TakeoverArgs = z.object({
  reason: z.string().min(1),
  expected_action: z.string().optional(),
  instructions: z.string().optional(),
  tab_id: z.string().optional(),
  timeout_seconds: z.number().int().min(1).max(900).optional(),
});
type TakeoverArgs = z.infer<typeof TakeoverArgs>;

export const request_user_takeover: ToolHandler<TakeoverArgs, unknown> = {
  name: 'request_user_takeover',
  tier: 'ask-user',
  argsSchema: TakeoverArgs,
  run: async (args, ctx) => {
    const detail = args.expected_action ?? args.instructions ?? '';
    const request: PendingAskUserRequest = {
      callId: ctx.callId,
      conversationId: ctx.conversationId,
      kind: 'text',
      question: detail ? `${args.reason}\n\n${detail}` : args.reason,
      context: 'Agent asked you to take over',
    };
    const timeoutMs = args.timeout_seconds != null ? args.timeout_seconds * 1000 : 15 * 60_000;
    const r = await awaitUserResponse(request, timeoutMs);
    if (r === 'timed_out') return { answer: null, cancelled: false, timed_out: true };
    // The card always appends an "Anything else?" note; carry it back so it isn't dropped.
    return {
      answer: r.answer ?? null,
      cancelled: r.cancelled ?? false,
      additional_instructions: r.additional_instructions ?? null,
    };
  },
};

// ─── update_plan ──────────────────────────────────────────────────────────

const UpdatePlanArgs = z
  .object({
    title: z.string().optional(),
    steps: z.array(z.string().min(1)).min(1).max(40).optional(),
    /** Canonical alias for `steps`. */
    approach: z.array(z.string().min(1)).min(1).max(40).optional(),
    /** Canonical: domains the agent intends to visit. Approved on plan accept. */
    domains: z.array(z.string()).optional(),
    reasoning: z.string().optional(),
    estimated_minutes: z.number().int().positive().max(240).optional(),
    timeout_seconds: z
      .number()
      .int()
      .positive()
      .max(15 * 60)
      .optional(),
  })
  .refine((v) => v.steps != null || v.approach != null, {
    message: 'either `steps` or `approach` is required',
  });
type UpdatePlanArgs = z.infer<typeof UpdatePlanArgs>;

export const update_plan: ToolHandler<UpdatePlanArgs, unknown> = {
  name: 'update_plan',
  tier: 'ask-user',
  argsSchema: UpdatePlanArgs,
  run: async (args, ctx) => {
    const steps = args.steps ?? args.approach ?? [];
    const title = args.title ?? steps[0]?.slice(0, 80) ?? 'Proposed plan';
    const renderedSteps = steps.map((s, i) => `${i + 1}. ${s}`).join('\n');
    const body = [
      `**Plan: ${title}**`,
      args.reasoning ? `\n_${args.reasoning}_` : '',
      '',
      renderedSteps,
      args.domains && args.domains.length ? `\n_Will visit: ${args.domains.join(', ')}_` : '',
      args.estimated_minutes
        ? `\n_~${args.estimated_minutes} minute${args.estimated_minutes === 1 ? '' : 's'}_`
        : '',
      '',
      'Approve this plan? You may add a note to amend.',
    ]
      .filter(Boolean)
      .join('\n');
    const timeoutMs = (args.timeout_seconds ?? 5 * 60) * 1000;
    const request: PendingAskUserRequest = {
      callId: ctx.callId,
      conversationId: ctx.conversationId,
      kind: 'choice',
      question: body,
      options: [{ label: 'Approve' }, { label: 'Reject' }],
      context: 'Agent is proposing a plan',
      expires_at_ms: Date.now() + timeoutMs,
    };
    // Persist the proposed plan immediately so the UI panel can render
    // it while the approval card is up. Status flips to 'approved' /
    // 'rejected' after the user clicks.
    if (ctx.conversationId) {
      const now = Date.now();
      void savePlan({
        conversation_id: ctx.conversationId,
        title,
        steps,
        ...(args.reasoning !== undefined && { reasoning: args.reasoning }),
        ...(args.domains !== undefined && { domains: args.domains }),
        ...(args.estimated_minutes !== undefined && { estimated_minutes: args.estimated_minutes }),
        status: 'proposed',
        created_at: now,
        updated_at: now,
      });
    }
    const r = await awaitUserResponse(request, timeoutMs);
    if (r === 'timed_out') {
      if (ctx.conversationId) void setPlanStatus(ctx.conversationId, 'rejected');
      return { approved: false, note: null, timed_out: true };
    }
    if (r.cancelled) {
      if (ctx.conversationId) void setPlanStatus(ctx.conversationId, 'rejected');
      return { approved: false, note: null };
    }
    const choice = r.selected?.[0] ?? r.answer ?? '';
    const approved = choice.toLowerCase().startsWith('approve');
    if (ctx.conversationId) {
      void setPlanStatus(ctx.conversationId, approved ? 'approved' : 'rejected');
      // Auto-populate tasks from approved plan steps so the live tasklist
      // has something to show without the model needing a separate call.
      if (approved && steps.length) {
        void addTasks(
          ctx.conversationId,
          steps.map((s) => ({ title: s })),
          'agent',
        );
      }
    }
    // The card now always offers an "Other" radio + an "Anything else?" note.
    // Prefer the typed-out freeform (the user amending the plan) over the bare
    // option label, and surface the optional note so neither is silently dropped.
    return {
      approved,
      note: r.freeform?.trim() || choice || null,
      additional_instructions: r.additional_instructions ?? null,
    };
  },
};

export const user_handlers = [user, request_user_takeover, update_plan];

// ─── shared awaiter ────────────────────────────────────────────────────────

/**
 * Broadcast the request and wait for the matching response. Resolves to
 * 'timed_out' when `timeoutMs` is set and no response arrives in time;
 * resolves to the response otherwise. Cancellation comes through as a
 * normal response with `cancelled: true`.
 */
function awaitUserResponse(
  request: PendingAskUserRequest,
  timeoutMs: number | null,
): Promise<AskUserResponse | 'timed_out'> {
  return new Promise((resolve) => {
    let resolved = false;
    const finish = (out: AskUserResponse | 'timed_out') => {
      if (resolved) return;
      resolved = true;
      off();
      if (timer != null) clearTimeout(timer);
      resolve(out);
    };
    const off = on<AskUserResponse, { ack: true }>(CHANNELS.TOOL_ASK_USER_RESPONSE, (payload) => {
      if (payload.callId !== request.callId) return { ack: true };
      finish(payload);
      return { ack: true };
    });
    const timer = timeoutMs != null ? setTimeout(() => finish('timed_out'), timeoutMs) : null;
    broadcast(CHANNELS.TOOL_ASK_USER_REQUEST, request);
  });
}
