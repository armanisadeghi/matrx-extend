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

const AskArgs = z.object({
  question: z.string().min(1),
  why: z.string().optional(),
  timeout_ms: z
    .number()
    .int()
    .positive()
    .max(15 * 60_000)
    .optional()
    .default(5 * 60_000),
});
type AskArgs = z.infer<typeof AskArgs>;

export const ask_user: ToolHandler<AskArgs, unknown> = {
  name: 'ask_user',
  tier: 'ask-user',
  description:
    'Ask the human a freeform question. Use this when you need information only the user has (e.g. "Which date should I book?"). Returns { answer } or { cancelled: true } if they dismiss.',
  argsSchema: AskArgs,
  run: async (args, ctx) =>
    awaitUserAnswer(
      {
        callId: ctx.callId,
        question: args.question,
        why: args.why,
      },
      args.timeout_ms,
    ),
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

const TakeoverArgs = z.object({
  reason: z.string().min(1),
  /** Description of what the user should do before signaling done. */
  instructions: z.string().min(1),
});
type TakeoverArgs = z.infer<typeof TakeoverArgs>;

export const request_user_takeover: ToolHandler<TakeoverArgs, unknown> = {
  name: 'request_user_takeover',
  tier: 'ask-user',
  description:
    "Pause the agent and hand control back to the human (e.g. for CAPTCHA, login, payment, or anything tricky for an automated browser). The user signals when they're done and the agent resumes. Returns { resumed: true, note?: string }.",
  argsSchema: TakeoverArgs,
  run: async (args, ctx) =>
    awaitUserAnswer(
      {
        callId: ctx.callId,
        question: `${args.reason}\n\n${args.instructions}`,
        // We reuse ask_user's open-text card. Caller types "done" or any note.
        why: 'Agent asked you to take over',
      },
      15 * 60_000,
    ),
};

// ─── update_plan ──────────────────────────────────────────────────────────

const UpdatePlanArgs = z.object({
  /** A short title for the proposed plan. */
  title: z.string().min(1),
  /** Step-by-step plan as a list of strings. */
  steps: z.array(z.string().min(1)).min(1).max(40),
  /**
   * Optional rationale or context explaining WHY this plan addresses the
   * user's goal. Helps the user evaluate the proposal.
   */
  reasoning: z.string().optional(),
  /** Estimated wall-clock time, in minutes. Optional. */
  estimated_minutes: z.number().int().positive().max(240).optional(),
  /** Hard timeout for approval, in ms. Default 5 minutes. */
  timeout_ms: z
    .number()
    .int()
    .positive()
    .max(15 * 60_000)
    .optional()
    .default(5 * 60_000),
});
type UpdatePlanArgs = z.infer<typeof UpdatePlanArgs>;

export const update_plan: ToolHandler<UpdatePlanArgs, unknown> = {
  name: 'update_plan',
  tier: 'ask-user',
  description:
    'Propose a step-by-step plan and wait for the user to approve, modify, or reject it. Use this BEFORE a multi-step action sequence so you align on intent up front. Returns { approved: true, note?: string } or { approved: false, note?: string } so you can adjust.',
  argsSchema: UpdatePlanArgs,
  run: async (args, ctx) => {
    const renderedSteps = args.steps.map((s, i) => `${i + 1}. ${s}`).join('\n');
    const body = [
      `**Plan: ${args.title}**`,
      args.reasoning ? `\n_${args.reasoning}_` : '',
      '',
      renderedSteps,
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
