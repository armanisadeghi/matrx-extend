/**
 * Tier: ASK-USER — the agent asks the human a question.
 *
 * These don't run an action; instead, the SW broadcasts a
 * TOOL_ASK_USER_REQUEST that the sidepanel renders as an inline card. The
 * user's answer comes back via TOOL_ASK_USER_RESPONSE and the SW resolves
 * the tool result.
 */

import { broadcast, on } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import type { AskUserResponse, PendingAskUserRequest, ToolHandler } from '@/lib/tools/types';
import { z } from 'zod';

// Unified shape per canonical (browser_tools_canonical.json:ask_user).
// `type` dispatches to the right card variant; old single-purpose
// callers that only pass `{ question }` still work because type defaults
// to 'text'. `context` is the canonical name for what we previously
// called `why` — both accepted during migration.
const AskArgs = z
  .object({
    question: z.string().min(1),
    type: z.enum(['confirm', 'choice', 'text', 'secret']).optional().default('text'),
    options: z.array(z.string().min(1)).optional(),
    context: z.string().optional(),
    why: z.string().optional(),
    timeout_ms: z
      .number()
      .int()
      .positive()
      .max(15 * 60_000)
      .optional()
      .default(5 * 60_000),
  })
  .refine((v) => v.type !== 'choice' || (v.options && v.options.length >= 2), {
    message: 'options (>=2) is required when type="choice"',
  });
type AskArgs = z.infer<typeof AskArgs>;

export const ask_user: ToolHandler<AskArgs, unknown> = {
  name: 'ask_user',
  tier: 'ask-user',
  description:
    "Pause and ask the user a question when input is needed. type='confirm' for yes/no, 'choice' for a fixed set of options, 'text' for free-form input, 'secret' for sensitive input (passwords, API keys, MFA codes — masked in UI and storage). Prefer this over guessing on destructive or sensitive actions. For full control transfer, use request_user_takeover.",
  argsSchema: AskArgs,
  run: async (args, ctx) => {
    const why = args.context ?? args.why;
    if (args.type === 'confirm') {
      return awaitUserAnswer(
        {
          callId: ctx.callId,
          question: args.question,
          choices: ['Yes', 'No'],
          why,
        },
        args.timeout_ms,
      );
    }
    if (args.type === 'choice') {
      return awaitUserAnswer(
        {
          callId: ctx.callId,
          question: args.question,
          choices: args.options,
          why,
        },
        args.timeout_ms,
      );
    }
    if (args.type === 'secret') {
      return awaitUserAnswer(
        {
          callId: ctx.callId,
          question: args.question,
          secret: true,
          why,
        },
        args.timeout_ms,
      );
    }
    return awaitUserAnswer(
      { callId: ctx.callId, question: args.question, why },
      args.timeout_ms,
    );
  },
};

const ChoiceArgs = z.object({
  question: z.string().min(1),
  choices: z.array(z.string().min(1)).min(2).max(20),
  why: z.string().optional(),
  timeout_ms: z
    .number()
    .int()
    .positive()
    .max(15 * 60_000)
    .optional()
    .default(5 * 60_000),
});
type ChoiceArgs = z.infer<typeof ChoiceArgs>;

export const ask_user_choice: ToolHandler<ChoiceArgs, unknown> = {
  name: 'ask_user_choice',
  tier: 'ask-user',
  description:
    'Ask the human to pick one of N options. Cleaner than ask_user when the answer is bounded. Returns { answer } (the chosen string) or { cancelled: true }.',
  argsSchema: ChoiceArgs,
  run: async (args, ctx) =>
    awaitUserAnswer(
      {
        callId: ctx.callId,
        question: args.question,
        choices: args.choices,
        why: args.why,
      },
      args.timeout_ms,
    ),
};

const SecretArgs = z.object({
  prompt: z.string().min(1),
  why: z.string().optional(),
  timeout_ms: z
    .number()
    .int()
    .positive()
    .max(15 * 60_000)
    .optional()
    .default(5 * 60_000),
});
type SecretArgs = z.infer<typeof SecretArgs>;

export const ask_user_secret: ToolHandler<SecretArgs, unknown> = {
  name: 'ask_user_secret',
  tier: 'ask-user',
  description:
    'Ask the human for a secret value (e.g. a one-time code, last 4 of a card). Input is masked in the UI. The answer flows through the model exactly once and is NOT persisted in the conversation. Returns { answer } or { cancelled: true }.',
  argsSchema: SecretArgs,
  run: async (args, ctx) =>
    awaitUserAnswer(
      {
        callId: ctx.callId,
        question: args.prompt,
        secret: true,
        why: args.why,
      },
      args.timeout_ms,
    ),
};

// Canonical: { tabId, reason, expected_action }. We previously required
// `instructions`; canonical names that field `expected_action`. Accept both
// during the migration; either or neither is fine.
const TakeoverArgs = z.object({
  reason: z.string().min(1),
  expected_action: z.string().optional(),
  instructions: z.string().optional(),
  tabId: z.string().optional(),
});
type TakeoverArgs = z.infer<typeof TakeoverArgs>;

export const request_user_takeover: ToolHandler<TakeoverArgs, unknown> = {
  name: 'request_user_takeover',
  tier: 'ask-user',
  description:
    "Hand keyboard/mouse control to the user so they can perform an action the agent cannot or should not (logging in, MFA, CAPTCHA, sensitive form filling, decisions only the user can make). The user types/clicks directly into the page; when they're done they signal completion in the UI. The agent should re-read the page after takeover ends to see what changed. Distinct from ask_user, which is Q&A.",
  argsSchema: TakeoverArgs,
  run: async (args, ctx) => {
    const detail = args.expected_action ?? args.instructions ?? '';
    return awaitUserAnswer(
      {
        callId: ctx.callId,
        question: detail ? `${args.reason}\n\n${detail}` : args.reason,
        // We reuse ask_user's open-text card. Caller types "done" or any note.
        why: 'Agent asked you to take over',
      },
      15 * 60_000,
    );
  },
};

// ─── update_plan ──────────────────────────────────────────────────────────

// Canonical: { approach: string[], domains: string[] }. We previously took
// { title, steps, reasoning, estimated_minutes }. Accept both shapes; if
// `approach` is present we use it as the steps; if `title` is missing we
// derive one from the first step.
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
    timeout_ms: z
      .number()
      .int()
      .positive()
      .max(15 * 60_000)
      .optional()
      .default(5 * 60_000),
  })
  .refine((v) => v.steps != null || v.approach != null, {
    message: 'either `steps` or `approach` is required',
  });
type UpdatePlanArgs = z.infer<typeof UpdatePlanArgs>;

export const update_plan: ToolHandler<UpdatePlanArgs, unknown> = {
  name: 'update_plan',
  tier: 'ask-user',
  description:
    'Propose a step-by-step plan and wait for the user to approve, modify, or reject it. Use this BEFORE a multi-step action sequence so you align on intent up front. Returns { approved: true, note?: string } or { approved: false, note?: string } so you can adjust.',
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
      args.domains && args.domains.length
        ? `\n_Will visit: ${args.domains.join(', ')}_`
        : '',
      args.estimated_minutes
        ? `\n_~${args.estimated_minutes} minute${args.estimated_minutes === 1 ? '' : 's'}_`
        : '',
      '',
      'Approve this plan? You may add a note to amend.',
    ]
      .filter(Boolean)
      .join('\n');
    const r = await awaitUserAnswer(
      {
        callId: ctx.callId,
        question: body,
        choices: ['Approve', 'Reject'],
        why: 'Agent is proposing a plan',
      },
      args.timeout_ms,
    );
    if (r.cancelled) return { approved: false, note: null };
    return {
      approved: r.answer?.toLowerCase().startsWith('approve') ?? false,
      note: r.answer,
    };
  },
};

export const user_handlers = [
  ask_user,
  ask_user_choice,
  ask_user_secret,
  request_user_takeover,
  update_plan,
];

// ─── shared awaiter ────────────────────────────────────────────────────────

function awaitUserAnswer(
  request: PendingAskUserRequest,
  timeoutMs: number,
): Promise<{ answer: string | null; cancelled?: boolean }> {
  return new Promise((resolve) => {
    let resolved = false;
    const finish = (out: { answer: string | null; cancelled?: boolean }) => {
      if (resolved) return;
      resolved = true;
      off();
      clearTimeout(timer);
      resolve(out);
    };
    const off = on<AskUserResponse, { ack: true }>(CHANNELS.TOOL_ASK_USER_RESPONSE, (payload) => {
      if (payload.callId !== request.callId) return { ack: true };
      finish({ answer: payload.answer, cancelled: payload.cancelled });
      return { ack: true };
    });
    const timer = setTimeout(() => finish({ answer: null, cancelled: true }), timeoutMs);
    broadcast(CHANNELS.TOOL_ASK_USER_REQUEST, request);
  });
}
