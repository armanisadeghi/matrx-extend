/**
 * SW-side tool dispatcher.
 *
 * Subscribes to STREAM_CHUNK broadcasts. When a chunk is a `tool_event` with
 * `event === "tool_started"` and `tool_name` is in our registry:
 *   1. Resolve the run's conversation_id (cached from STREAM_OPENED)
 *   2. Apply permission policy:
 *        - tier 'read'      → run immediately
 *        - tier 'action'    → in 'ask' mode, broadcast TOOL_CONFIRM_REQUEST
 *                            and wait for TOOL_CONFIRM_RESPONSE; in 'act'
 *                            mode, run immediately
 *        - tier 'ask-user'  → handler internally broadcasts TOOL_ASK_USER_REQUEST
 *        - tier 'privileged' → always confirm, regardless of mode
 *   3. Run the handler
 *   4. POST result via /conversations/{id}/tool_results
 *   5. Broadcast a TOOL_TIMELINE_EVENT so the chat UI can render started/done
 */

import { postToolResults } from '@/lib/api/routes/tool-results';
import { log } from '@/lib/debug/log';
import { broadcast, on } from '@/lib/messaging/native';
import { CHANNELS } from '@/lib/messaging/schemas';
import {
  type OptionalPermission,
  hasOptionalPermissions,
} from '@/lib/permissions/optional';
import { lookup as lookupTool } from '@/lib/tools/registry';
import type {
  AnyToolHandler,
  ConfirmResponse,
  PendingConfirmRequest,
  ToolContext,
} from '@/lib/tools/types';

interface RunMeta {
  conversationId: string | null;
  requestId: string | null;
  /** Permission mode for this run, latched at start. */
  permissionMode: 'ask' | 'act';
  agentName: string | null;
  /** Domains allowed for the rest of THIS conversation. */
  trustedThisConversation: Set<string>;
}

const runs = new Map<string, RunMeta>();

interface DispatchOptions {
  defaultPermissionMode: () => 'ask' | 'act';
}

let started = false;

export function startToolDispatcher(opts: DispatchOptions): void {
  if (started) return;
  started = true;
  log.info('sw', 'tool dispatcher started');

  // Cache run metadata when the stream opens.
  on<
    {
      runId: string;
      conversationId: string | null;
      requestId: string | null;
      agentName?: string | null;
      permissionMode?: 'ask' | 'act';
    },
    { ack: true }
  >(CHANNELS.STREAM_OPENED, (payload) => {
    runs.set(payload.runId, {
      conversationId: payload.conversationId,
      requestId: payload.requestId,
      permissionMode: payload.permissionMode ?? opts.defaultPermissionMode(),
      agentName: payload.agentName ?? null,
      trustedThisConversation: new Set<string>(),
    });
    log.info('sw', `tool dispatcher tracking run=${payload.runId}`, payload);
    return { ack: true };
  });

  // Watch every stream chunk for tool_started events.
  on<{ runId: string; type: string; payload: unknown }, { ack: true }>(
    CHANNELS.STREAM_CHUNK,
    async (chunk) => {
      if (chunk.type !== 'event') return { ack: true };
      const evt = (chunk.payload as { eventName?: string; data?: Record<string, unknown> }) ?? {};
      if (evt.eventName !== 'tool_event') return { ack: true };
      const data = (evt.data ?? {}) as Record<string, unknown>;
      const subEvent = data.event as string | undefined;
      if (subEvent !== 'tool_started') return { ack: true };

      const callId = String(data.call_id ?? '');
      const toolName = String(data.tool_name ?? '');
      const toolArgs = ((data.data as { arguments?: unknown })?.arguments ?? {}) as unknown;
      if (!callId || !toolName) return { ack: true };

      const handler = lookupTool(toolName);
      if (!handler) {
        log.warn('sw', `tool '${toolName}' not in registry — passing`, data);
        return { ack: true };
      }

      const meta = runs.get(chunk.runId);
      const ctx: ToolContext = {
        conversationId: meta?.conversationId ?? null,
        runId: chunk.runId,
        callId,
        agentName: meta?.agentName ?? null,
        permissionMode: meta?.permissionMode ?? 'ask',
      };

      // Fire-and-forget — do not block the chunk listener on this.
      void handleCall(handler, toolArgs, ctx, meta).catch((err) =>
        log.error('sw', `tool dispatch crashed for ${toolName}`, err),
      );
      return { ack: true };
    },
  );
}

async function handleCall(
  handler: AnyToolHandler,
  rawArgs: unknown,
  ctx: ToolContext,
  meta: RunMeta | undefined,
): Promise<void> {
  log.info('sw', `tool ${handler.name} call_id=${ctx.callId}`, rawArgs);
  broadcast(CHANNELS.TOOL_TIMELINE_EVENT, {
    callId: ctx.callId,
    toolName: handler.name,
    phase: 'started',
    args: rawArgs,
  });

  // Validate args.
  const parsed = handler.argsSchema.safeParse(rawArgs);
  if (!parsed.success) {
    return finishWithError(
      handler,
      ctx,
      `args failed schema: ${JSON.stringify(parsed.error.format())}`,
    );
  }

  // Optional-permission gate. Tools that depend on `debugger`, `cookies`, etc.
  // declare `required_optional_permissions`. If those aren't granted yet,
  // surface a structured error so the agent can ask the user to enable them.
  if (handler.required_optional_permissions?.length) {
    const granted = await hasOptionalPermissions(
      handler.required_optional_permissions as OptionalPermission[],
    );
    if (!granted) {
      return finishWithError(
        handler,
        ctx,
        `required optional permission(s) not granted: ${handler.required_optional_permissions.join(', ')}. The user must enable them in Settings → Advanced agent capabilities.`,
      );
    }
  }

  // Permission gate.
  const needsConfirm =
    handler.tier === 'privileged' || (handler.tier === 'action' && ctx.permissionMode === 'ask');
  if (needsConfirm) {
    const allowed = await requestConfirmation(handler, parsed.data, ctx, meta);
    if (!allowed.allow) {
      return finishWithError(handler, ctx, allowed.reason ?? 'User denied this action');
    }
  }

  // Run.
  let result: unknown;
  try {
    result = await handler.run(parsed.data as never, ctx);
  } catch (err) {
    return finishWithError(handler, ctx, (err as Error)?.message ?? String(err));
  }

  await postResult(handler, ctx, result);
  broadcast(CHANNELS.TOOL_TIMELINE_EVENT, {
    callId: ctx.callId,
    toolName: handler.name,
    phase: 'completed',
    output: result,
  });
}

async function finishWithError(
  handler: AnyToolHandler,
  ctx: ToolContext,
  message: string,
): Promise<void> {
  log.error('sw', `tool ${handler.name} error`, message);
  await postResult(handler, ctx, null, true, message);
  broadcast(CHANNELS.TOOL_TIMELINE_EVENT, {
    callId: ctx.callId,
    toolName: handler.name,
    phase: 'error',
    message,
  });
}

async function postResult(
  handler: AnyToolHandler,
  ctx: ToolContext,
  output: unknown,
  isError = false,
  errorMessage: string | null = null,
): Promise<void> {
  if (!ctx.conversationId) {
    log.warn('sw', `cannot POST tool_results for ${handler.name} — no conversation_id yet`);
    return;
  }
  await postToolResults(ctx.conversationId, [
    {
      call_id: ctx.callId,
      tool_name: handler.name,
      output,
      is_error: isError,
      error_message: errorMessage,
    },
  ]);
}

interface ConfirmResult {
  allow: boolean;
  reason?: string;
}

function requestConfirmation(
  handler: AnyToolHandler,
  args: unknown,
  ctx: ToolContext,
  meta: RunMeta | undefined,
): Promise<ConfirmResult> {
  // Auto-allow if user has trusted this domain for the conversation.
  // (Domain trust is opportunistic — only meaningful if args has a `url`.)
  const url =
    typeof (args as { url?: unknown })?.url === 'string'
      ? ((args as { url?: string }).url as string)
      : null;
  if (url && meta) {
    try {
      const host = new URL(url).host;
      if (meta.trustedThisConversation.has(host)) {
        return Promise.resolve({ allow: true });
      }
    } catch {
      /* not a URL we can parse, fall through */
    }
  }

  return new Promise<ConfirmResult>((resolve) => {
    let resolved = false;
    const finish = (out: ConfirmResult) => {
      if (resolved) return;
      resolved = true;
      off();
      clearTimeout(timer);
      resolve(out);
    };
    const off = on<ConfirmResponse, { ack: true }>(CHANNELS.TOOL_CONFIRM_RESPONSE, (payload) => {
      if (payload.callId !== ctx.callId) return { ack: true };
      if (payload.decision === 'allow' && payload.rememberFor === 'conversation' && url && meta) {
        try {
          meta.trustedThisConversation.add(new URL(url).host);
        } catch {
          /* */
        }
      }
      finish({
        allow: payload.decision === 'allow',
        reason: payload.decision === 'deny' ? 'User denied this action' : undefined,
      });
      return { ack: true };
    });
    const timer = setTimeout(
      () => finish({ allow: false, reason: 'Approval timed out' }),
      5 * 60_000,
    );

    const req: PendingConfirmRequest = {
      callId: ctx.callId,
      toolName: handler.name,
      description: handler.description,
      args,
      tier: handler.tier,
    };
    broadcast(CHANNELS.TOOL_CONFIRM_REQUEST, req);
  });
}
