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

import { broadcast, on } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import type {
  AskUserResponse,
  PendingAskUserRequest,
  ToolHandler,
  UserAskKind,
} from '@/lib/tools/types';
import { z } from 'zod';

// ─── unified `user` tool ──────────────────────────────────────────────────

const UserArgs = z
  .object({
    type: z.enum(['confirm', 'choice', 'choice_many', 'text', 'secret', 'notify']),
    question: z.string().optional(),
    options: z.array(z.string().min(1)).optional(),
    context: z.string().optional(),
    message: z.string().optional(),
    actions: z.array(z.string().min(1)).optional(),
    level: z.enum(['info', 'success', 'warning', 'error']).optional(),
    timeout_seconds: z.number().int().min(1).max(900).optional(),
  })
  .superRefine((v, ctx) => {
    const ASK_TYPES: UserAskKind[] = ['confirm', 'choice', 'choice_many', 'text', 'secret'];
    if (ASK_TYPES.includes(v.type) && !v.question?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `question is required for type='${v.type}'`,
        path: ['question'],
      });
    }
    if ((v.type === 'choice' || v.type === 'choice_many') && (!v.options || v.options.length < 2)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `options (>=2) is required for type='${v.type}'`,
        path: ['options'],
      });
    }
    if (v.type === 'notify' && !v.message?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "message is required for type='notify'",
        path: ['message'],
      });
    }
  });
type UserArgs = z.infer<typeof UserArgs>;

const EMPTY_ENVELOPE = {
  answer: null as string | null,
  selected: null as string[] | null,
  confirmed: null as boolean | null,
  action: null as string | null,
  freeform: null as string | null,
  cancelled: false,
  timed_out: false,
};
type Envelope = typeof EMPTY_ENVELOPE;

export const user: ToolHandler<UserArgs, Envelope> = {
  name: 'user',
  tier: 'ask-user',
  description:
    "Pause and talk to the user. Single tool, six modes via `type`: 'confirm' (yes/no — pass question), 'choice' (single pick — pass question + options[]), 'choice_many' (multi pick — pass question + options[]), 'text' (freeform answer — pass question), 'secret' (masked input for passwords/MFA/API keys — pass question), 'notify' (display a message and optionally collect a single action — pass message; optional actions[] and level). Optional `context` shows a one-line 'why' on ask types. Optional `timeout_seconds` (1..900) auto-resolves the call with timed_out:true if the user doesn't respond. Returns the unified envelope { answer, selected, confirmed, action, freeform, cancelled, timed_out } — unused fields are null/false. For full keyboard/mouse handoff (CAPTCHA, login), use request_user_takeover. For plan approval, use update_plan.",
  argsSchema: UserArgs,
  run: async (args, ctx) => {
    const timeoutMs = args.timeout_seconds ? args.timeout_seconds * 1000 : null;
    const request: PendingAskUserRequest = {
      callId: ctx.callId,
      kind: args.type,
      question: args.question,
      options: args.options,
      message: args.message,
      actions: args.actions,
      level: args.level,
      context: args.context,
      expires_at_ms: timeoutMs ? Date.now() + timeoutMs : undefined,
    };

    // For notify, also fire a system notification so the user sees it
    // when the side panel isn't open. The inline card still renders so
    // they can respond with an action button.
    if (args.type === 'notify') {
      void fireSystemNotification(args, ctx.agentName).catch(() => {
        /* permission denied / API absent — inline card is the fallback */
      });
    }

    const response = await awaitUserResponse(request, timeoutMs);
    return responseToEnvelope(args.type, response);
  },
};

function responseToEnvelope(kind: UserAskKind, r: AskUserResponse | 'timed_out'): Envelope {
  if (r === 'timed_out') {
    return { ...EMPTY_ENVELOPE, timed_out: true };
  }
  if (r.cancelled) {
    return { ...EMPTY_ENVELOPE, cancelled: true };
  }
  switch (kind) {
    case 'confirm':
      return { ...EMPTY_ENVELOPE, confirmed: r.confirmed ?? null };
    case 'choice':
    case 'choice_many':
      return { ...EMPTY_ENVELOPE, selected: r.selected ?? null };
    case 'text':
    case 'secret':
      return { ...EMPTY_ENVELOPE, answer: r.answer ?? null };
    case 'notify':
      return {
        ...EMPTY_ENVELOPE,
        action: r.action ?? null,
        freeform: r.freeform ?? null,
      };
  }
}

async function fireSystemNotification(args: UserArgs, agentName: string | null): Promise<void> {
  if (!chrome.notifications) return;
  const title = agentName ? `${agentName}` : 'Matrx';
  await new Promise<string>((resolve) => {
    chrome.notifications.create(
      {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icon/128.png'),
        title,
        message: args.message ?? '',
        requireInteraction: (args.actions?.length ?? 0) > 0,
      },
      (id) => resolve(id),
    );
  });
}

// ─── request_user_takeover (unchanged) ────────────────────────────────────

const TakeoverArgs = z.object({
  reason: z.string().min(1),
  expected_action: z.string().optional(),
  instructions: z.string().optional(),
  tab_id: z.string().optional(),
});
type TakeoverArgs = z.infer<typeof TakeoverArgs>;

export const request_user_takeover: ToolHandler<TakeoverArgs, unknown> = {
  name: 'request_user_takeover',
  tier: 'ask-user',
  description:
    "Hand keyboard/mouse control to the user so they can perform an action the agent cannot or should not (logging in, MFA, CAPTCHA, sensitive form filling, decisions only the user can make). The user types/clicks directly into the page; when they're done they signal completion in the UI. The agent should re-read the page after takeover ends to see what changed. Distinct from `user` (Q&A) — this is full page handoff.",
  argsSchema: TakeoverArgs,
  run: async (args, ctx) => {
    const detail = args.expected_action ?? args.instructions ?? '';
    const request: PendingAskUserRequest = {
      callId: ctx.callId,
      kind: 'text',
      question: detail ? `${args.reason}\n\n${detail}` : args.reason,
      context: 'Agent asked you to take over',
    };
    const r = await awaitUserResponse(request, 15 * 60_000);
    if (r === 'timed_out') return { answer: null, cancelled: false, timed_out: true };
    return { answer: r.answer ?? null, cancelled: r.cancelled ?? false };
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
    const timeoutMs = (args.timeout_seconds ?? 5 * 60) * 1000;
    const request: PendingAskUserRequest = {
      callId: ctx.callId,
      kind: 'choice',
      question: body,
      options: ['Approve', 'Reject'],
      context: 'Agent is proposing a plan',
      expires_at_ms: Date.now() + timeoutMs,
    };
    const r = await awaitUserResponse(request, timeoutMs);
    if (r === 'timed_out') return { approved: false, note: null, timed_out: true };
    if (r.cancelled) return { approved: false, note: null };
    const choice = r.selected?.[0] ?? r.answer ?? '';
    return {
      approved: choice.toLowerCase().startsWith('approve'),
      note: choice || null,
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
